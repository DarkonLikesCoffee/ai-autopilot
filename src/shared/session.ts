// Continuation state machine. Pure: (state, event) -> { state, effects }.
// The background service worker is the only caller. It persists the state
// before carrying out effects, so a restart never repeats an action.
//
// One continuation per finished response, guaranteed by:
// - a completion only counts after a generation was observed since the
//   session started or since the last continuation (rerenders, navigation
//   back, or an already-finished page never count);
// - the response's key is recorded in answeredKeys *before* the attempt to
//   send (write-ahead), and a key in answeredKeys is never answered again;
// - an attempt whose outcome is unknown pauses instead of retrying.

import type { HaltReason, LogEntry, PageObservation, ResponseStatus, RunState, SessionPhase, SessionState, Settings } from './types.ts';
import { isUnlimited } from './settings.ts';

export const MAX_ANSWERED_KEYS = 200;
export const MAX_LOG_ENTRIES = 40;
/** A submission still unresolved after this long (for example the worker was stopped) is treated as uncertain. */
export const SUBMIT_TIMEOUT_MS = 60_000;
/** A due time this close is treated as reached (timers can fire a little early). */
export const DUE_TOLERANCE_MS = 250;

export type PrecheckFailure =
  | 'generating'
  | 'response_changed'
  | 'not_complete'
  | 'composer_has_text'
  | 'conversation_changed'
  | 'tab_unreachable'
  | 'usage_limit'
  | 'auth_required';

export type SubmitOutcome = 'submitted' | 'not_submitted' | 'uncertain';

type Timing = Pick<Settings, 'delaySeconds' | 'maxCycles'>;

export type SessionEvent =
  | { type: 'START'; tabId: number; observation: PageObservation; now: number }
  | { type: 'OBSERVATION'; tabId: number; observation: PageObservation; settings: Timing; now: number }
  | { type: 'DUE'; now: number }
  | { type: 'PRECHECK_FAILED'; key: string; reason: PrecheckFailure; now: number }
  | { type: 'SUBMIT_BEGIN'; key: string; now: number }
  /** The page refused at its own last check, before typing anything. */
  | { type: 'SUBMIT_REFUSED'; key: string; reason: PrecheckFailure; now: number }
  | { type: 'SUBMIT_RESULT'; key: string; outcome: SubmitOutcome; detail: string | null; sawGenerating: boolean; now: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; tabId: number | null; observation: PageObservation | null; settings: Timing; now: number }
  | { type: 'STOP'; now: number }
  | { type: 'TAB_CLOSED'; tabId: number; now: number }
  | { type: 'BROWSER_STARTUP'; now: number }
  | { type: 'WAKE'; now: number };

export type SessionEffect =
  | { type: 'schedule'; dueAt: number }
  | { type: 'cancel_schedule' }
  /** The delay ended: the controller checks the live page and either begins submitting or reports a failed precheck. */
  | { type: 'attempt'; key: string }
  | { type: 'notify'; id: string; title: string; message: string };

export interface TransitionResult {
  state: SessionState;
  effects: SessionEffect[];
  /** Set when the event was refused; the state is unchanged. */
  rejected?: string;
}

export function initialSession(): SessionState {
  return {
    schemaVersion: 2,
    run: 'stopped',
    phase: 'watching',
    reason: null,
    detail: null,
    tabId: null,
    conversation: null,
    cycles: 0,
    generationSeen: false,
    pendingKey: null,
    dueAt: null,
    submitStartedAt: null,
    answeredKeys: [],
    lastStatus: 'unknown',
    lastContinuationAt: null,
    startedAt: null,
    updatedAt: null,
    log: [],
  };
}

// ---- Helpers ----------------------------------------------------------------

export function conversationPath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** A path that names a saved conversation (as opposed to a new, unsaved chat). */
export function isSavedConversation(path: string | null): boolean {
  return !!path && /\/c\/[^/]+/.test(path);
}

export const REASON_TEXT: Record<HaltReason, string> = {
  user: 'Stopped by you',
  max_cycles: 'Maximum number of continuations reached',
  usage_limit: 'ChatGPT shows a usage limit',
  auth_required: 'ChatGPT asks you to log in',
  page_error: 'ChatGPT shows an error',
  conversation_changed: 'The tab switched to a different conversation',
  tab_closed: 'The ChatGPT tab was closed',
  browser_restarted: 'The browser or the extension restarted',
  composer_has_text: 'The message box already contains text',
  submit_failed: 'The continuation could not be sent',
  submission_uncertain: 'It is unclear whether the last continuation was sent',
  tab_unreachable: 'The ChatGPT tab did not respond',
};

const PAUSE_REASONS = new Set<HaltReason>(['user', 'conversation_changed', 'tab_closed', 'browser_restarted', 'composer_has_text', 'submission_uncertain']);

function log(state: SessionState, now: number, message: string): SessionState {
  const entry: LogEntry = { at: now, message };
  return { ...state, log: [...state.log, entry].slice(-MAX_LOG_ENTRIES), updatedAt: now };
}

const reject = (state: SessionState, reason: string): TransitionResult => ({ state, effects: [], rejected: reason });

/** Leaves "running" for paused/error/stopped; the pending delay is dropped. */
function halt(state: SessionState, run: Exclude<RunState, 'running'>, reason: HaltReason, now: number, detail: string | null = null): TransitionResult {
  const keepPending = run === 'paused' && state.phase === 'delay';
  const next: SessionState = {
    ...state,
    run,
    reason,
    detail,
    // A paused delay keeps its response, so Resume can continue it with a fresh delay.
    phase: keepPending ? 'delay' : state.phase === 'submitting' ? 'submitting' : 'watching',
    pendingKey: keepPending || state.phase === 'submitting' ? state.pendingKey : null,
    dueAt: null,
  };
  const label = run === 'stopped' ? 'Stopped' : run === 'paused' ? 'Paused' : 'Error';
  const effects: SessionEffect[] = [{ type: 'cancel_schedule' }];
  if (reason !== 'user') {
    effects.push({
      type: 'notify',
      id: `halt:${run}:${reason}:${now}`,
      title: `Autopilot ${label.toLowerCase()}`,
      message: detail ? `${REASON_TEXT[reason]}: ${detail}` : `${REASON_TEXT[reason]}.`,
    });
  }
  return { state: log(next, now, `${label}: ${REASON_TEXT[reason]}${detail ? ` (${detail})` : ''}.`), effects };
}

function limitReached(state: SessionState, settings: Timing): boolean {
  return !isUnlimited(settings) && state.cycles >= settings.maxCycles;
}

function schedule(state: SessionState, key: string, settings: Timing, now: number): TransitionResult {
  const dueAt = now + settings.delaySeconds * 1000;
  const next: SessionState = { ...state, phase: 'delay', pendingKey: key, dueAt, generationSeen: false };
  return {
    state: log(next, now, `Response complete. Continuation ${state.cycles + 1} in ${settings.delaySeconds}s.`),
    effects: [{ type: 'schedule', dueAt }],
  };
}

// ---- Observations -----------------------------------------------------------

function observe(state: SessionState, event: Extract<SessionEvent, { type: 'OBSERVATION' }>): TransitionResult {
  const { observation, tabId, settings, now } = event;
  if (state.run === 'stopped' || tabId !== state.tabId) return { state, effects: [] };

  const path = conversationPath(observation.url);
  let next: SessionState = state;
  if (state.conversation !== path) {
    // A new chat gets its conversation path when the first message is sent: same tab, same session.
    if (!isSavedConversation(state.conversation) && isSavedConversation(path)) {
      next = log({ ...next, conversation: path }, now, 'The new chat was saved as a conversation; following it.');
    } else {
      if (state.run !== 'running') return { state, effects: [] };
      return halt(state, 'paused', 'conversation_changed', now);
    }
  }

  const status = observation.status;
  next = { ...next, lastStatus: status, updatedAt: now };
  if (state.run !== 'running') {
    // Remembered while paused, so a response that finishes during the pause is continued after Resume.
    if (status === 'generating') next.generationSeen = true;
    return { state: next, effects: [] };
  }

  switch (status) {
    case 'usage_limit':
      return halt(next, 'error', 'usage_limit', now, 'Nothing will be sent until you resume.');
    case 'error':
      return observation.signals.authRequired ? halt(next, 'error', 'auth_required', now) : halt(next, 'error', 'page_error', now);
    case 'generating':
      next.generationSeen = true;
      if (state.phase === 'delay') {
        // A new response started before the delay ended (for example you sent a message): nothing is sent for the old one.
        next = log({ ...next, phase: 'watching', pendingKey: null, dueAt: null }, now, 'ChatGPT started generating again; the pending continuation was cancelled.');
        return { state: next, effects: [{ type: 'cancel_schedule' }] };
      }
      return { state: next, effects: [] };
    case 'complete': {
      const key = observation.responseKey;
      if (state.phase !== 'watching' || !state.generationSeen || key === null || state.answeredKeys.includes(key)) {
        return { state: next, effects: [] };
      }
      if (limitReached(state, settings)) return halt(next, 'stopped', 'max_cycles', now, `${settings.maxCycles} sent`);
      return schedule(next, key, settings, now);
    }
    case 'idle':
    case 'unknown':
      return { state: next, effects: [] };
  }
}

// ---- Transitions ------------------------------------------------------------

export function transition(state: SessionState, event: SessionEvent): TransitionResult {
  const { now } = event;
  switch (event.type) {
    case 'START': {
      if (state.run !== 'stopped') return reject(state, 'Autopilot is already active. Stop it before starting a new session.');
      const conversation = conversationPath(event.observation.url);
      const status = event.observation.status;
      if (status === 'usage_limit') return reject(state, 'ChatGPT is showing a usage limit. Start Autopilot once it is lifted.');
      if (event.observation.signals.authRequired) return reject(state, 'ChatGPT asks you to log in first.');
      if (!event.observation.signals.composerFound) return reject(state, 'The ChatGPT message box was not found in this tab.');
      const next: SessionState = {
        ...initialSession(),
        run: 'running',
        tabId: event.tabId,
        conversation,
        generationSeen: status === 'generating',
        answeredKeys: state.answeredKeys,
        lastStatus: status,
        startedAt: now,
        log: state.log,
      };
      return { state: log(next, now, 'Autopilot started. Waiting for ChatGPT to finish a response.'), effects: [] };
    }

    case 'OBSERVATION':
      return observe(state, event);

    case 'DUE':
      if (state.run !== 'running' || state.phase !== 'delay' || state.pendingKey === null || state.dueAt === null) return { state, effects: [] };
      if (now < state.dueAt - DUE_TOLERANCE_MS) return { state, effects: [] };
      return { state, effects: [{ type: 'attempt', key: state.pendingKey }] };

    case 'PRECHECK_FAILED': {
      if (state.run !== 'running' || state.phase !== 'delay' || state.pendingKey !== event.key) return { state, effects: [] };
      const toWatching = (message: string, generationSeen: boolean): TransitionResult => ({
        state: log({ ...state, phase: 'watching', pendingKey: null, dueAt: null, generationSeen }, now, message),
        effects: [{ type: 'cancel_schedule' }],
      });
      switch (event.reason) {
        case 'generating':
          return toWatching('ChatGPT is generating again; nothing was sent.', true);
        case 'response_changed':
          return toWatching('A different response is now the latest; nothing was sent.', false);
        case 'not_complete':
          return halt(state, 'paused', 'submission_uncertain', now, 'the page state could not be confirmed, so nothing was sent');
        case 'composer_has_text':
          return halt(state, 'paused', 'composer_has_text', now, 'nothing was sent so your text is kept');
        case 'conversation_changed':
          return halt(state, 'paused', 'conversation_changed', now);
        case 'tab_unreachable':
          return halt(state, 'error', 'tab_unreachable', now);
        case 'usage_limit':
          return halt(state, 'error', 'usage_limit', now, 'Nothing will be sent until you resume.');
        case 'auth_required':
          return halt(state, 'error', 'auth_required', now);
      }
      return { state, effects: [] };
    }

    case 'SUBMIT_BEGIN': {
      if (state.run !== 'running' || state.phase !== 'delay' || state.pendingKey !== event.key) {
        return reject(state, 'The continuation is no longer pending.');
      }
      if (state.answeredKeys.includes(event.key)) return reject(state, 'A continuation was already sent for this response.');
      const next: SessionState = {
        ...state,
        phase: 'submitting',
        dueAt: null,
        submitStartedAt: now,
        answeredKeys: [...state.answeredKeys, event.key].slice(-MAX_ANSWERED_KEYS),
      };
      return { state: log(next, now, `Sending continuation ${state.cycles + 1}.`), effects: [] };
    }

    case 'SUBMIT_REFUSED': {
      if (state.phase !== 'submitting' || state.pendingKey !== event.key) return { state, effects: [] };
      // Nothing was typed, so the response may be answered later after all; handle it like a failed precheck.
      const pending: SessionState = {
        ...state,
        phase: 'delay',
        submitStartedAt: null,
        answeredKeys: state.answeredKeys.filter((key) => key !== event.key),
      };
      if (state.run !== 'running') {
        // Paused or stopped during the attempt: just drop it.
        return { state: log({ ...pending, phase: 'watching', pendingKey: null }, now, 'The page refused the continuation; nothing was sent.'), effects: [] };
      }
      return transition(pending, { type: 'PRECHECK_FAILED', key: event.key, reason: event.reason, now });
    }

    case 'SUBMIT_RESULT': {
      // Accepted while paused too: a pause during an attempt does not undo what the page did.
      if (state.phase !== 'submitting' || state.pendingKey !== event.key) return { state, effects: [] };
      if (event.outcome === 'submitted') {
        const next: SessionState = {
          ...state,
          phase: 'watching',
          pendingKey: null,
          submitStartedAt: null,
          cycles: state.cycles + 1,
          generationSeen: event.sawGenerating,
          lastContinuationAt: now,
        };
        return { state: log(next, now, `Continuation ${next.cycles} sent.`), effects: [] };
      }
      const base: SessionState = { ...state, phase: 'watching', pendingKey: null, submitStartedAt: null };
      if (event.outcome === 'not_submitted') return halt(base, 'error', 'submit_failed', now, event.detail);
      return halt(base, 'paused', 'submission_uncertain', now, event.detail);
    }

    case 'PAUSE':
      if (state.run !== 'running') return reject(state, 'Only a running session can be paused.');
      return halt(state, 'paused', 'user', now);

    case 'RESUME': {
      if (state.run !== 'paused' && state.run !== 'error') return reject(state, 'Only a paused or stopped-by-error session can be resumed.');
      const tabId = state.tabId ?? event.tabId;
      if (tabId === null || event.observation === null) {
        return reject(state, 'Open the conversation this session belongs to, then resume.');
      }
      const path = conversationPath(event.observation.url);
      if (state.conversation !== null && path !== state.conversation && isSavedConversation(state.conversation)) {
        return reject(state, 'This tab shows a different conversation. Go back to the session\'s conversation, or stop and start a new session.');
      }
      if (event.observation.status === 'usage_limit') return reject(state, 'ChatGPT still shows a usage limit.');
      let next: SessionState = { ...state, run: 'running', reason: null, detail: null, tabId };
      const effects: SessionEffect[] = [];
      if (next.phase === 'submitting') {
        // The outcome of that attempt is unknown; its response stays answered, so it is never sent twice.
        next = { ...next, phase: 'watching', pendingKey: null, submitStartedAt: null };
      }
      next = log(next, now, 'Resumed.');
      if (next.phase === 'delay' && next.pendingKey !== null) {
        if (event.observation.status === 'complete' && event.observation.responseKey === next.pendingKey) {
          const scheduled = schedule({ ...next, phase: 'watching' }, next.pendingKey, event.settings, now);
          return { state: scheduled.state, effects: [...effects, ...scheduled.effects] };
        }
        next = { ...next, phase: 'watching', pendingKey: null };
      }
      // Apply the fresh observation: a response that finished while paused is continued now.
      const observed = observe(next, { type: 'OBSERVATION', tabId, observation: event.observation, settings: event.settings, now });
      return { state: observed.state, effects: [...effects, ...observed.effects] };
    }

    case 'STOP':
      if (state.run === 'stopped') return reject(state, 'Autopilot is not active.');
      return halt(state, 'stopped', 'user', now);

    case 'TAB_CLOSED': {
      if (state.run === 'stopped' || event.tabId !== state.tabId) return { state, effects: [] };
      const next: SessionState = { ...state, tabId: null };
      if (state.run !== 'running') return { state: log(next, now, 'The ChatGPT tab was closed.'), effects: [] };
      return halt(next, 'paused', 'tab_closed', now);
    }

    case 'BROWSER_STARTUP': {
      if (state.run === 'stopped') return { state, effects: [] };
      const next: SessionState = { ...state, tabId: null };
      if (state.run !== 'running') return { state: log(next, now, 'The browser restarted.'), effects: [] };
      if (state.phase === 'submitting') return halt(next, 'paused', 'submission_uncertain', now, 'the browser restarted during an attempt');
      return halt(next, 'paused', 'browser_restarted', now);
    }

    case 'WAKE': {
      // The service worker restarted: timers are gone, but the persisted state remains.
      if (state.run !== 'running') return { state, effects: [] };
      if (state.phase === 'submitting' && state.submitStartedAt !== null && now - state.submitStartedAt > SUBMIT_TIMEOUT_MS) {
        return halt(state, 'paused', 'submission_uncertain', now, 'no result was received for the last attempt');
      }
      if (state.phase === 'delay' && state.dueAt !== null) {
        if (now >= state.dueAt - DUE_TOLERANCE_MS && state.pendingKey !== null) return { state, effects: [{ type: 'attempt', key: state.pendingKey }] };
        return { state, effects: [{ type: 'schedule', dueAt: state.dueAt }] };
      }
      return { state, effects: [] };
    }
  }
}

export const isPauseReason = (reason: HaltReason): boolean => PAUSE_REASONS.has(reason);

// ---- Persistence recovery -------------------------------------------------

const RUN: readonly RunState[] = ['stopped', 'running', 'paused', 'error'];
const PHASES: readonly SessionPhase[] = ['watching', 'delay', 'submitting'];
const STATUSES: readonly ResponseStatus[] = ['unknown', 'idle', 'generating', 'complete', 'error', 'usage_limit'];
const REASONS = Object.keys(REASON_TEXT) as HaltReason[];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Restores persisted state. Unreadable data never yields a state that could
 * send something: it becomes "stopped", keeping only the answered keys.
 */
export function normalizeSession(raw: unknown): SessionState {
  const base = initialSession();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const answeredKeys = Array.isArray(r.answeredKeys) ? r.answeredKeys.filter((k): k is string => typeof k === 'string').slice(-MAX_ANSWERED_KEYS) : [];
  if (r.schemaVersion !== 2 || !oneOf(r.run, RUN) || !oneOf(r.phase, PHASES)) return { ...base, answeredKeys };
  const log = Array.isArray(r.log)
    ? r.log.filter((e): e is LogEntry => !!e && typeof e === 'object' && typeof (e as LogEntry).at === 'number' && typeof (e as LogEntry).message === 'string').slice(-MAX_LOG_ENTRIES)
    : [];
  const state: SessionState = {
    schemaVersion: 2,
    run: r.run,
    phase: r.phase,
    reason: oneOf(r.reason, REASONS) ? r.reason : null,
    detail: strOrNull(r.detail),
    tabId: numOrNull(r.tabId),
    conversation: strOrNull(r.conversation),
    cycles: typeof r.cycles === 'number' && Number.isInteger(r.cycles) && r.cycles >= 0 ? r.cycles : 0,
    generationSeen: r.generationSeen === true,
    pendingKey: strOrNull(r.pendingKey),
    dueAt: numOrNull(r.dueAt),
    submitStartedAt: numOrNull(r.submitStartedAt),
    answeredKeys,
    lastStatus: oneOf(r.lastStatus, STATUSES) ? r.lastStatus : 'unknown',
    lastContinuationAt: numOrNull(r.lastContinuationAt),
    startedAt: numOrNull(r.startedAt),
    updatedAt: numOrNull(r.updatedAt),
    log,
  };
  // Inconsistent combinations cannot be trusted to send anything.
  if ((state.phase !== 'watching' && state.pendingKey === null) || (state.run === 'running' && state.tabId === null)) {
    return { ...state, run: state.run === 'stopped' ? 'stopped' : 'paused', reason: state.run === 'stopped' ? state.reason : 'submission_uncertain', phase: 'watching', pendingKey: null, dueAt: null };
  }
  return state;
}
