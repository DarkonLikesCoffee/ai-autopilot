// Workflow state machine. Pure: (state, event) -> { state, effects }.
// The background service worker is the only caller; it persists the state and
// carries out the effects (notifications). Nothing here submits messages: with
// auto-continue on, the state only records *when* the next send is due
// (autoSendDueAt); the background performs the send after re-checking the page.

import type {
  CyclePhase,
  MonitoringState,
  PageObservation,
  ReportedStatus,
  ResponseStatus,
  ReviewOutcome,
  StopReason,
  WorkflowLogEntry,
  WorkflowState,
} from './types.ts';

export const MAX_NOTIFIED_KEYS = 50;
export const MAX_LOG_ENTRIES = 30;

export type HandoffMethod = 'copy' | 'insert' | 'auto';

export type WorkflowEvent =
  | { type: 'START_SESSION'; projectId: string; autoContinue: boolean; autoDelayMs: number; now: number }
  | { type: 'PROMPT_HANDED_OFF'; method: HandoffMethod; tabId: number | null; currentResponseKey: string | null; maxCycles: number; now: number }
  | { type: 'OBSERVATION'; tabId: number; observation: PageObservation; maxCycles: number; now: number }
  | { type: 'TAB_CLOSED'; tabId: number; now: number }
  | { type: 'MARK_REVIEWED'; outcome: ReviewOutcome; maxCycles: number; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'STOP'; reason: StopReason; detail?: string; now: number }
  | { type: 'SET_AUTO_CONTINUE'; enabled: boolean; delayMs: number; now: number }
  /** The background is about to send the scheduled prompt; clears the schedule so it can never fire twice. */
  | { type: 'AUTO_SEND_BEGIN'; now: number }
  | { type: 'SELECT_PROJECT'; projectId: string | null; now: number }
  | { type: 'BROWSER_STARTUP'; now: number }
  | { type: 'RESET'; now: number };

export type NotificationKind = 'response_complete' | 'usage_limit' | 'error' | 'session_ended';

export interface NotifyEffect {
  type: 'notify';
  kind: NotificationKind;
  /** Stable id: the same id is never shown twice. */
  id: string;
  title: string;
  message: string;
}

export type WorkflowEffect = NotifyEffect;

export interface TransitionResult {
  state: WorkflowState;
  effects: WorkflowEffect[];
  /** Set when the event was refused; the state is then unchanged. */
  rejected?: string;
  /** Informational note for the UI when the event was accepted without a state change. */
  note?: string;
}

export function initialWorkflowState(): WorkflowState {
  return {
    schemaVersion: 1,
    projectId: null,
    monitoring: 'inactive',
    pauseReason: null,
    phase: 'ready',
    cycle: 0,
    responseStatus: 'unknown',
    lastResponseKey: null,
    responseKeyAtHandoff: null,
    generationSeenSinceHandoff: false,
    notifiedResponseKeys: [],
    latestReviewed: true,
    promptPrepared: false,
    trackedTabId: null,
    conversationUrl: null,
    lastEventAt: null,
    lastContinuationAt: null,
    lastReviewOutcome: null,
    stopReason: null,
    recoveredFromCorruption: false,
    autoContinue: false,
    autoDelayMs: 60_000,
    autoSendDueAt: null,
    lastReportedStatus: null,
    log: [],
  };
}

/** A response key is "<conversation path>|<message marker>". */
export function conversationOfKey(key: string | null): string | null {
  if (!key) return null;
  const index = key.indexOf('|');
  return index === -1 ? key : key.slice(0, index);
}

export function conversationOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function withLog(state: WorkflowState, now: number, source: WorkflowLogEntry['source'], message: string): WorkflowState {
  const log = [...state.log, { at: now, source, message }];
  return { ...state, log: log.slice(-MAX_LOG_ENTRIES) };
}

const reject = (state: WorkflowState, reason: string): TransitionResult => ({ state, effects: [], rejected: reason });

export const STOP_REASON_TEXT: Record<StopReason, string> = {
  user_stopped: 'Stopped by you',
  max_cycles_reached: 'Maximum continuation cycles reached',
  milestone_reported: 'ChatGPT reported the milestone as met (not verified by the extension)',
  blocker_reported: 'ChatGPT reported a blocker needing your input',
  project_changed: 'Active project changed',
  usage_limit: 'ChatGPT showed a usage-limit message',
  page_error: 'ChatGPT showed an error',
  status_line_missing: 'The reply did not end with an AUTOPILOT STATUS line',
  auto_send_failed: 'Auto-continue could not send the next prompt safely',
};

export const REPORTED_STATUS_TEXT: Record<ReportedStatus, string> = {
  continue: 'CONTINUE',
  milestone_complete: 'MILESTONE COMPLETE',
  blocked: 'BLOCKED',
  missing: 'No status line found',
};

export const STATUS_TEXT: Record<ResponseStatus, string> = {
  unknown: 'Unknown',
  idle: 'Idle (no response on page)',
  generating: 'Generating',
  complete: 'Response appears complete',
  error: 'Error shown on page',
  usage_limit: 'Usage limit message shown',
};

function stop(state: WorkflowState, reason: StopReason, now: number, source: WorkflowLogEntry['source'], detail?: string): WorkflowState {
  return withLog(
    { ...state, monitoring: 'stopped', pauseReason: null, stopReason: reason, promptPrepared: false, autoSendDueAt: null, lastEventAt: now },
    now,
    source,
    `Session stopped: ${STOP_REASON_TEXT[reason]}${detail ? ` — ${detail}` : ''}.`,
  );
}

function sessionEndedNotice(reason: StopReason, now: number, detail?: string): NotifyEffect {
  return {
    type: 'notify',
    kind: 'session_ended',
    id: `session_ended:${reason}:${now}`,
    title: 'Autopilot session stopped',
    message: `${STOP_REASON_TEXT[reason]}${detail ? ` — ${detail}` : ''}. Nothing more will be sent.`,
  };
}

/**
 * Auto-continue decision for a completed reply. Anything other than an
 * explicit CONTINUE status line ends the session; nothing is guessed.
 */
function autoContinueAfter(next: WorkflowState, state: WorkflowState, status: ReportedStatus, maxCycles: number, now: number): TransitionResult {
  const end = (reason: StopReason, detail?: string): TransitionResult => ({
    state: stop(next, reason, now, 'observed', detail),
    effects: [sessionEndedNotice(reason, now, detail)],
  });
  if (status === 'milestone_complete') return end('milestone_reported');
  if (status === 'blocked') return end('blocker_reported');
  if (status !== 'continue') return end('status_line_missing', 'review the reply yourself');
  if (state.cycle >= maxCycles) return end('max_cycles_reached', `${maxCycles} cycles`);
  const due = now + state.autoDelayMs;
  const ready: WorkflowState = { ...next, phase: 'ready', promptPrepared: true, latestReviewed: true, lastReviewOutcome: 'continue', autoSendDueAt: due };
  return {
    state: withLog(ready, now, 'system', `Cycle ${state.cycle}: ChatGPT reported CONTINUE. Prompt ${state.cycle + 1} will be sent automatically in ${Math.round(state.autoDelayMs / 1000)} s.`),
    effects: [],
  };
}

function sessionOpen(monitoring: MonitoringState): boolean {
  return monitoring === 'active' || monitoring === 'paused';
}

/** Decides whether an observation comes from the tab this session follows. */
export function isTrackedObservation(state: WorkflowState, tabId: number, observation: PageObservation): boolean {
  if (state.trackedTabId !== null) return state.trackedTabId === tabId;
  if (state.conversationUrl === null) return true;
  return conversationOfUrl(state.conversationUrl) === conversationOfUrl(observation.url);
}

/**
 * A completion belongs to the current cycle only if generation was seen after
 * the hand-off, or the latest response in the same conversation changed since
 * the hand-off. An already-finished response on the page never counts.
 */
function completionBelongsToCycle(state: WorkflowState, key: string | null): boolean {
  if (state.generationSeenSinceHandoff) return true;
  if (key === null || state.responseKeyAtHandoff === null) return false;
  return key !== state.responseKeyAtHandoff && conversationOfKey(key) === conversationOfKey(state.responseKeyAtHandoff);
}

function observe(state: WorkflowState, event: Extract<WorkflowEvent, { type: 'OBSERVATION' }>): TransitionResult {
  const { observation, tabId, now } = event;
  if (!isTrackedObservation(state, tabId, observation)) {
    return { state, effects: [], note: 'Observation from a tab this session does not follow was ignored.' };
  }
  const previous = state.responseStatus;
  // A tab becomes tracked by a hand-off, or (after a browser restart) by matching the recorded conversation.
  // A copied prompt may not name a tab; then the first tab seen generating for the cycle becomes tracked.
  const rebind =
    state.trackedTabId === null &&
    ((state.conversationUrl !== null && state.monitoring !== 'inactive') ||
      (state.monitoring === 'active' && state.phase === 'awaiting_response' && observation.status === 'generating'));
  const trackedTabId = state.trackedTabId ?? (rebind ? tabId : null);
  let next: WorkflowState = {
    ...state,
    responseStatus: observation.status,
    lastResponseKey: observation.responseKey,
    lastEventAt: now,
    trackedTabId,
    conversationUrl: trackedTabId === tabId ? observation.url : state.conversationUrl,
  };
  const effects: WorkflowEffect[] = [];
  if (previous !== observation.status) {
    next = withLog(next, now, 'observed', `Page status: ${STATUS_TEXT[observation.status]}.`);
  }

  // Remembered even while paused, so a response that finishes during a pause is recognized on resume.
  if (observation.status === 'generating' && sessionOpen(state.monitoring) && state.phase === 'awaiting_response') {
    next.generationSeenSinceHandoff = true;
  }
  // While paused, inactive or stopped the status is still displayed, but nothing advances.
  if (state.monitoring !== 'active') return { state: next, effects };

  switch (observation.status) {
    case 'generating':
      break;
    case 'complete': {
      const key = observation.responseKey;
      if (state.phase !== 'awaiting_response' || !completionBelongsToCycle(state, key)) break;
      if (key !== null && state.notifiedResponseKeys.includes(key)) break;
      next.phase = 'needs_review';
      next.latestReviewed = false;
      next.promptPrepared = false;
      next.generationSeenSinceHandoff = false;
      next.lastReportedStatus = observation.reportedStatus;
      if (key !== null) next.notifiedResponseKeys = [...state.notifiedResponseKeys, key].slice(-MAX_NOTIFIED_KEYS);
      if (state.autoContinue) return autoContinueAfter(next, state, observation.reportedStatus ?? 'missing', event.maxCycles, now);
      next = withLog(next, now, 'observed', `Cycle ${state.cycle}: response appears complete. Waiting for your review.`);
      effects.push({
        type: 'notify',
        kind: 'response_complete',
        id: `complete:${key ?? `cycle-${state.cycle}-${now}`}`,
        title: 'ChatGPT response appears complete',
        message: `Cycle ${state.cycle}: review the reply, then mark the cycle reviewed. A finished response is not proof that the milestone is met.`,
      });
      break;
    }
    case 'usage_limit':
      if (state.autoContinue) {
        return { state: stop(next, 'usage_limit', now, 'observed', 'nothing will be resent'), effects: [sessionEndedNotice('usage_limit', now)] };
      }
      if (previous !== 'usage_limit') {
        next.monitoring = 'paused';
        next.pauseReason = 'usage_limit';
        next = withLog(next, now, 'observed', 'Usage-limit message detected. Monitoring paused; nothing will be resent.');
        effects.push({
          type: 'notify',
          kind: 'usage_limit',
          id: `usage_limit:${now}`,
          title: 'ChatGPT usage limit message',
          message: 'Monitoring is paused. Nothing will be resent or reloaded. Resume when you choose to continue.',
        });
      }
      break;
    case 'error':
      if (state.autoContinue) {
        return { state: stop(next, 'page_error', now, 'observed', 'nothing will be retried'), effects: [sessionEndedNotice('page_error', now)] };
      }
      if (previous !== 'error') {
        effects.push({
          type: 'notify',
          kind: 'error',
          id: `error:${now}`,
          title: 'ChatGPT shows an error',
          message: 'Review the conversation. The extension will not retry or resend anything.',
        });
      }
      break;
    case 'idle':
    case 'unknown':
      break;
  }
  return { state: next, effects };
}

export function transition(state: WorkflowState, event: WorkflowEvent): TransitionResult {
  const { now } = event;
  switch (event.type) {
    case 'START_SESSION': {
      if (sessionOpen(state.monitoring)) return reject(state, 'A session is already running. Stop it before starting a new one.');
      const base = initialWorkflowState();
      const next: WorkflowState = {
        ...base,
        projectId: event.projectId,
        monitoring: 'active',
        phase: 'ready',
        promptPrepared: true,
        responseStatus: state.responseStatus,
        lastResponseKey: state.lastResponseKey,
        notifiedResponseKeys: state.notifiedResponseKeys,
        autoContinue: event.autoContinue,
        autoDelayMs: event.autoDelayMs,
        lastEventAt: now,
        log: state.log,
      };
      const mode = event.autoContinue ? ' Auto-continue is on: later prompts are sent automatically.' : '';
      return { state: withLog(next, now, 'user', `Session started. Continuation prompt 1 is prepared.${mode}`), effects: [] };
    }

    case 'PROMPT_HANDED_OFF': {
      if (state.monitoring === 'paused') return reject(state, 'Monitoring is paused. Resume before handing off the next prompt.');
      if (state.monitoring !== 'active') return reject(state, 'Start a session before handing off a continuation prompt.');
      if (state.phase === 'awaiting_response') {
        return { state, effects: [], note: `Cycle ${state.cycle} is already waiting for a response; this hand-off did not start a new cycle.` };
      }
      if (state.phase === 'needs_review') return reject(state, 'Mark the previous cycle reviewed before handing off the next prompt.');
      if (state.cycle >= event.maxCycles) {
        return { state: stop(state, 'max_cycles_reached', now, 'system'), effects: [], rejected: 'The maximum number of cycles for this session has been reached.' };
      }
      const cycle = state.cycle + 1;
      const next: WorkflowState = {
        ...state,
        cycle,
        phase: 'awaiting_response',
        promptPrepared: false,
        responseKeyAtHandoff: event.currentResponseKey,
        generationSeenSinceHandoff: false,
        trackedTabId: event.tabId ?? state.trackedTabId,
        autoSendDueAt: null,
        lastContinuationAt: now,
        lastEventAt: now,
      };
      if (event.method === 'auto') {
        return { state: withLog(next, now, 'system', `Cycle ${cycle}: prompt sent automatically (auto-continue).`), effects: [] };
      }
      const how = event.method === 'insert' ? 'inserted into the ChatGPT composer' : 'copied';
      return { state: withLog(next, now, 'user', `Cycle ${cycle}: prompt ${how}. You submit it yourself.`), effects: [] };
    }

    case 'OBSERVATION':
      return observe(state, event);

    case 'TAB_CLOSED': {
      if (state.trackedTabId !== event.tabId) return { state, effects: [] };
      const next = { ...state, trackedTabId: null, responseStatus: 'unknown' as const, lastEventAt: now };
      return { state: withLog(next, now, 'observed', 'The tracked ChatGPT tab was closed. Status is unknown.'), effects: [] };
    }

    case 'MARK_REVIEWED': {
      if (!sessionOpen(state.monitoring)) return reject(state, 'There is no running session to review.');
      if (state.phase === 'ready') return reject(state, 'There is no handed-off cycle to review yet.');
      const manual = state.phase === 'awaiting_response';
      let next: WorkflowState = {
        ...state,
        latestReviewed: true,
        lastReviewOutcome: event.outcome,
        generationSeenSinceHandoff: false,
        lastEventAt: now,
      };
      if (manual && state.lastResponseKey !== null) {
        next.notifiedResponseKeys = [...state.notifiedResponseKeys, state.lastResponseKey].slice(-MAX_NOTIFIED_KEYS);
      }
      next = withLog(next, now, 'user', `Cycle ${state.cycle} marked reviewed${manual ? ' (before completion was detected)' : ''}.`);
      const effects: WorkflowEffect[] = [];
      if (event.outcome === 'milestone_reported') {
        next = stop(next, 'milestone_reported', now, 'user');
      } else if (event.outcome === 'blocker_reported') {
        next = stop(next, 'blocker_reported', now, 'user');
      } else if (state.cycle >= event.maxCycles) {
        next = stop(next, 'max_cycles_reached', now, 'system');
        effects.push({
          type: 'notify',
          kind: 'session_ended',
          id: `session_ended:max:${now}`,
          title: 'Autopilot session finished',
          message: `The configured maximum of ${event.maxCycles} cycles was reached. Start a new session to continue.`,
        });
      } else {
        next = withLog({ ...next, phase: 'ready', promptPrepared: true }, now, 'system', `Continuation prompt ${state.cycle + 1} is prepared.`);
      }
      return { state: next, effects };
    }

    case 'PAUSE':
      if (state.monitoring !== 'active') return reject(state, 'Only an active session can be paused.');
      return {
        state: withLog({ ...state, monitoring: 'paused', pauseReason: 'user', autoSendDueAt: null, lastEventAt: now }, now, 'user', state.autoSendDueAt !== null ? 'Monitoring paused; the scheduled automatic send was cancelled.' : 'Monitoring paused.'),
        effects: [],
      };

    case 'RESUME': {
      if (state.monitoring !== 'paused') return reject(state, 'Only a paused session can be resumed.');
      // A send cancelled by the pause is rescheduled, and re-checked against the page when it fires.
      const reschedule = state.autoContinue && state.phase === 'ready' && state.cycle > 0 && state.lastReportedStatus === 'continue';
      const next: WorkflowState = { ...state, monitoring: 'active', pauseReason: null, autoSendDueAt: reschedule ? now + state.autoDelayMs : null, lastEventAt: now };
      return { state: withLog(next, now, 'user', reschedule ? 'Monitoring resumed; the next automatic send is rescheduled.' : 'Monitoring resumed.'), effects: [] };
    }

    case 'STOP':
      if (!sessionOpen(state.monitoring)) return reject(state, 'There is no running session to stop.');
      return {
        state: stop(state, event.reason, now, event.reason === 'user_stopped' ? 'user' : 'system', event.detail),
        effects: event.reason === 'user_stopped' ? [] : [sessionEndedNotice(event.reason, now, event.detail)],
      };

    case 'SET_AUTO_CONTINUE': {
      if (!sessionOpen(state.monitoring)) return { state, effects: [] };
      if (state.autoContinue === event.enabled && state.autoDelayMs === event.delayMs) return { state, effects: [] };
      // Turning it on takes effect from the next completed reply; it never sends right away.
      const next: WorkflowState = { ...state, autoContinue: event.enabled, autoDelayMs: event.delayMs, autoSendDueAt: event.enabled ? state.autoSendDueAt : null };
      const message = event.enabled ? 'Auto-continue turned on; it applies from the next completed reply.' : 'Auto-continue turned off; nothing will be sent automatically.';
      return { state: withLog(next, now, 'user', message), effects: [] };
    }

    case 'AUTO_SEND_BEGIN':
      if (state.monitoring !== 'active' || !state.autoContinue || state.phase !== 'ready' || state.autoSendDueAt === null) {
        return reject(state, 'No automatic send is due.');
      }
      return { state: { ...state, autoSendDueAt: null, lastEventAt: now }, effects: [] };

    case 'SELECT_PROJECT': {
      if (state.projectId === event.projectId) return { state, effects: [] };
      let next = sessionOpen(state.monitoring) ? stop(state, 'project_changed', now, 'system') : state;
      next = { ...next, projectId: event.projectId, monitoring: 'inactive', phase: 'ready', cycle: 0, promptPrepared: false, trackedTabId: null, conversationUrl: null };
      return { state: next, effects: [] };
    }

    case 'BROWSER_STARTUP': {
      // A send that was due across a browser restart is not attempted: the page must be re-checked by you.
      if (sessionOpen(state.monitoring) && state.autoSendDueAt !== null) {
        const detail = 'the browser restarted before the scheduled send';
        return { state: stop({ ...state, trackedTabId: null, responseStatus: 'unknown' }, 'auto_send_failed', now, 'system', detail), effects: [sessionEndedNotice('auto_send_failed', now, detail)] };
      }
      // Tab ids do not survive a browser restart; keep the conversation URL so the tab can be re-matched.
      const next = { ...state, trackedTabId: null, responseStatus: 'unknown' as const };
      return { state: withLog(next, now, 'system', 'Browser restarted. Waiting for the ChatGPT tab to report its status.'), effects: [] };
    }

    case 'RESET': {
      if (sessionOpen(state.monitoring)) return reject(state, 'Stop the running session before resetting.');
      const base = initialWorkflowState();
      return { state: { ...base, projectId: state.projectId, notifiedResponseKeys: state.notifiedResponseKeys, lastEventAt: now }, effects: [] };
    }
  }
}

// ---- Persistence recovery -------------------------------------------------

const STATUSES: readonly ResponseStatus[] = ['unknown', 'idle', 'generating', 'complete', 'error', 'usage_limit'];
const MONITORING: readonly MonitoringState[] = ['inactive', 'active', 'paused', 'stopped'];
const PHASES: readonly CyclePhase[] = ['ready', 'awaiting_response', 'needs_review'];
const STOP_REASONS: readonly StopReason[] = [
  'user_stopped', 'max_cycles_reached', 'milestone_reported', 'blocker_reported', 'project_changed',
  'usage_limit', 'page_error', 'status_line_missing', 'auto_send_failed',
];
const REPORTED: readonly ReportedStatus[] = ['continue', 'milestone_complete', 'blocked', 'missing'];
const OUTCOMES: readonly ReviewOutcome[] = ['continue', 'milestone_reported', 'blocker_reported'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Restores a persisted state. Unreadable or inconsistent data falls back to a
 * safe state (never to one that would trigger an action) and is flagged.
 */
export function normalizeWorkflowState(raw: unknown): WorkflowState {
  const base = initialWorkflowState();
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ...base, recoveredFromCorruption: true };
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 1 || !oneOf(r.monitoring, MONITORING) || !oneOf(r.phase, PHASES)) {
    return { ...base, projectId: strOrNull(r.projectId), recoveredFromCorruption: true };
  }
  const cycle = typeof r.cycle === 'number' && Number.isInteger(r.cycle) && r.cycle >= 0 ? r.cycle : 0;
  const log = Array.isArray(r.log)
    ? r.log
        .filter((e): e is WorkflowLogEntry => !!e && typeof e === 'object' && typeof (e as WorkflowLogEntry).at === 'number' && typeof (e as WorkflowLogEntry).message === 'string' && oneOf((e as WorkflowLogEntry).source, ['observed', 'user', 'system'] as const))
        .slice(-MAX_LOG_ENTRIES)
    : [];
  return {
    schemaVersion: 1,
    projectId: strOrNull(r.projectId),
    monitoring: r.monitoring,
    pauseReason: r.monitoring === 'paused' ? (oneOf(r.pauseReason, ['user', 'usage_limit'] as const) ? r.pauseReason : 'user') : null,
    phase: r.phase,
    cycle,
    responseStatus: oneOf(r.responseStatus, STATUSES) ? r.responseStatus : 'unknown',
    lastResponseKey: strOrNull(r.lastResponseKey),
    responseKeyAtHandoff: strOrNull(r.responseKeyAtHandoff),
    generationSeenSinceHandoff: r.generationSeenSinceHandoff === true,
    notifiedResponseKeys: Array.isArray(r.notifiedResponseKeys) ? r.notifiedResponseKeys.filter((k): k is string => typeof k === 'string').slice(-MAX_NOTIFIED_KEYS) : [],
    latestReviewed: r.latestReviewed !== false,
    promptPrepared: r.promptPrepared === true,
    trackedTabId: numOrNull(r.trackedTabId),
    conversationUrl: strOrNull(r.conversationUrl),
    lastEventAt: numOrNull(r.lastEventAt),
    lastContinuationAt: numOrNull(r.lastContinuationAt),
    lastReviewOutcome: oneOf(r.lastReviewOutcome, OUTCOMES) ? r.lastReviewOutcome : null,
    stopReason: oneOf(r.stopReason, STOP_REASONS) ? r.stopReason : null,
    recoveredFromCorruption: r.recoveredFromCorruption === true,
    autoContinue: r.autoContinue === true,
    autoDelayMs: typeof r.autoDelayMs === 'number' && Number.isFinite(r.autoDelayMs) && r.autoDelayMs >= 30_000 ? r.autoDelayMs : base.autoDelayMs,
    // A pending send only survives if the session is still active and waiting for it.
    autoSendDueAt: r.monitoring === 'active' && r.phase === 'ready' && r.autoContinue === true ? numOrNull(r.autoSendDueAt) : null,
    lastReportedStatus: oneOf(r.lastReportedStatus, REPORTED) ? r.lastReportedStatus : null,
    log,
  };
}
