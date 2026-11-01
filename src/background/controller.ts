// Background logic, independent of the chrome.* APIs so it can be tested.
// It is the only writer of settings and session state. Every operation runs
// one at a time and starts from persisted state, because Chrome may stop the
// service worker between events. State is saved before effects are carried
// out, so a restart can never repeat a submission.

import type { ContentReport, SubmitRequest, SubmitResult, TabInfo, UiRequest, UiResponse, UiSnapshot } from '../shared/messages.ts';
import type { Logger } from '../shared/logger.ts';
import { conversationPath, transition, type PrecheckFailure, type SessionEffect, type SessionEvent, type TransitionResult } from '../shared/session.ts';
import { defaultSettings, normalizeSettings, validateSettings } from '../shared/settings.ts';
import { createSerialQueue, loadSession, loadSettings, saveSession, saveSettings, type StorageAreaLike } from '../shared/storage.ts';
import type { PageObservation, SessionState, Settings } from '../shared/types.ts';

export interface TabAccess {
  /** The active tab of the focused window, if it shows ChatGPT. */
  activeChatgptTab(): Promise<TabInfo | null>;
  /** Information about a tab, or null if it is gone or no longer shows ChatGPT. */
  tabInfo(tabId: number): Promise<TabInfo | null>;
  /** A tab that shows this conversation, if exactly one does. */
  findConversationTab(path: string): Promise<number | null>;
  /** Asks the content script for a fresh observation; null if it does not answer. */
  getObservation(tabId: number): Promise<PageObservation | null>;
  /** Asks the content script to send the continuation; null if it does not answer. */
  submit(tabId: number, key: string, request: SubmitRequest): Promise<SubmitResult | null>;
  /** Asks the content script to ping back when the delay ends (a backup for the worker's own timers). */
  schedulePing(tabId: number, dueAt: number, now: number): Promise<void>;
}

export interface Scheduler {
  schedule(dueAt: number): Promise<void> | void;
  cancel(): Promise<void> | void;
}

export interface NotifyRequest {
  id: string;
  title: string;
  message: string;
}

export interface ControllerDeps {
  storage: StorageAreaLike;
  tabs: TabAccess;
  scheduler: Scheduler;
  notify(request: NotifyRequest): Promise<void>;
  onStateChange?(state: SessionState): Promise<void> | void;
  now(): number;
  log: Logger;
}

export interface Controller {
  handleUi(request: UiRequest): Promise<UiResponse>;
  handleContent(tabId: number, report: ContentReport): Promise<void>;
  /** A timer, alarm or page ping says the delay may have ended. */
  handleDue(): Promise<void>;
  handleTabRemoved(tabId: number): Promise<void>;
  handleStartup(): Promise<void>;
  /** The service worker started (after being stopped by Chrome). */
  handleWake(): Promise<void>;
}

class UserError extends Error {}

/** The background's own check of the live page before it records an attempt. */
export function precheckObservation(state: SessionState, observation: PageObservation, key: string): PrecheckFailure | null {
  if (conversationPath(observation.url) !== state.conversation) return 'conversation_changed';
  if (observation.status === 'usage_limit') return 'usage_limit';
  if (observation.signals.authRequired) return 'auth_required';
  if (observation.status === 'generating') return 'generating';
  if (observation.signals.composerHasText) return 'composer_has_text';
  if (observation.status !== 'complete') return 'not_complete';
  if (observation.responseKey !== key) return 'response_changed';
  return null;
}

export function createController(deps: ControllerDeps): Controller {
  const { storage, tabs, log } = deps;
  const enqueue = createSerialQueue();

  async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
    try {
      return await promise;
    } catch {
      return fallback;
    }
  }

  /** Applies an event: persists the new state first, then carries out its effects. */
  async function apply(state: SessionState, event: SessionEvent, settings: Settings): Promise<TransitionResult> {
    const result = transition(state, event);
    if (result.state !== state) {
      await saveSession(storage, result.state);
      await deps.onStateChange?.(result.state);
    }
    let current = result.state;
    for (const effect of result.effects) current = await runEffect(current, effect, settings);
    return { ...result, state: current };
  }

  async function runEffect(state: SessionState, effect: SessionEffect, settings: Settings): Promise<SessionState> {
    switch (effect.type) {
      case 'schedule':
        await safe(Promise.resolve(deps.scheduler.schedule(effect.dueAt)), undefined);
        if (state.tabId !== null) await safe(tabs.schedulePing(state.tabId, effect.dueAt, deps.now()), undefined);
        return state;
      case 'cancel_schedule':
        await safe(Promise.resolve(deps.scheduler.cancel()), undefined);
        return state;
      case 'notify':
        if (settings.notifications) {
          try {
            await deps.notify({ id: effect.id, title: effect.title, message: effect.message });
          } catch (error) {
            log.warn('Notification failed', error);
          }
        }
        return state;
      case 'attempt':
        return attempt(state, effect.key, settings);
    }
  }

  /** The delay ended: check the live page, record the attempt, then send. */
  async function attempt(state: SessionState, key: string, settings: Settings): Promise<SessionState> {
    const tabId = state.tabId;
    const observation = tabId === null ? null : await safe(tabs.getObservation(tabId), null);
    const now = deps.now();
    if (tabId === null || observation === null) {
      return (await apply(state, { type: 'PRECHECK_FAILED', key, reason: 'tab_unreachable', now }, settings)).state;
    }
    const failure = precheckObservation(state, observation, key);
    if (failure) return (await apply(state, { type: 'PRECHECK_FAILED', key, reason: failure, now }, settings)).state;

    // Write-ahead: the response is recorded as answered before anything is sent.
    const begun = await apply(state, { type: 'SUBMIT_BEGIN', key, now }, settings);
    if (begun.rejected) return begun.state;

    const request: SubmitRequest = { text: settings.prompt, expectedPath: state.conversation ?? '', expectedKey: key };
    const result = await safe(tabs.submit(tabId, key, request), null);
    return applyResult(begun.state, key, result, settings);
  }

  async function applyResult(state: SessionState, key: string, result: SubmitResult | null, settings: Settings): Promise<SessionState> {
    const now = deps.now();
    let event: SessionEvent;
    if (result === null) {
      event = { type: 'SUBMIT_RESULT', key, outcome: 'uncertain', detail: 'the ChatGPT tab did not answer', sawGenerating: false, now };
    } else if (result.outcome === 'refused') {
      event = { type: 'SUBMIT_REFUSED', key, reason: result.reason, now };
    } else if (result.outcome === 'submitted') {
      event = { type: 'SUBMIT_RESULT', key, outcome: 'submitted', detail: null, sawGenerating: result.sawGenerating, now };
    } else {
      event = { type: 'SUBMIT_RESULT', key, outcome: result.outcome, detail: result.detail, sawGenerating: false, now };
    }
    return (await apply(state, event, settings)).state;
  }

  async function load(): Promise<{ settings: Settings; session: SessionState }> {
    const [settings, session] = await Promise.all([loadSettings(storage), loadSession(storage)]);
    return { settings, session };
  }

  async function snapshot(settings: Settings, session: SessionState): Promise<UiSnapshot> {
    const [sessionTab, activeTab] = await Promise.all([
      session.tabId === null ? Promise.resolve(null) : safe(tabs.tabInfo(session.tabId), null),
      safe(tabs.activeChatgptTab(), null),
    ]);
    return { settings, session, sessionTab, activeTab, now: deps.now() };
  }

  /** The tab to resume in: the session's tab if it still exists, otherwise one showing the conversation. */
  async function resumeTab(session: SessionState): Promise<number | null> {
    if (session.tabId !== null && (await safe(tabs.tabInfo(session.tabId), null))) return session.tabId;
    if (session.conversation && /\/c\//.test(session.conversation)) {
      const found = await safe(tabs.findConversationTab(session.conversation), null);
      if (found !== null) return found;
    }
    const active = await safe(tabs.activeChatgptTab(), null);
    return active?.tabId ?? null;
  }

  async function handle(request: UiRequest): Promise<UiResponse> {
    let { settings, session } = await load();
    let note: string | undefined;
    const now = deps.now();

    const run = async (event: SessionEvent) => {
      const result = await apply(session, event, settings);
      if (result.rejected) throw new UserError(result.rejected);
      session = result.state;
    };

    switch (request.type) {
      case 'GET_SNAPSHOT':
        break;

      case 'START': {
        const issues = validateSettings(settings);
        if (issues.length) throw new UserError(`Fix the settings first: ${issues.map((i) => i.message).join(' ')}`);
        const tab = await safe(tabs.activeChatgptTab(), null);
        if (!tab) throw new UserError('Open your ChatGPT conversation in this window and make it the active tab, then start Autopilot.');
        const observation = await safe(tabs.getObservation(tab.tabId), null);
        if (!observation) {
          throw new UserError('Autopilot is not connected to that tab yet (it was open before the extension was installed or updated). Reload the ChatGPT tab, then start again.');
        }
        await run({ type: 'START', tabId: tab.tabId, observation, now });
        note = observation.status === 'generating'
          ? 'Autopilot started. It continues once ChatGPT finishes this response.'
          : 'Autopilot started. Send your first message; Autopilot continues each time ChatGPT finishes.';
        break;
      }

      case 'PAUSE':
        await run({ type: 'PAUSE', now });
        break;

      case 'RESUME': {
        const tabId = await resumeTab(session);
        const observation = tabId === null ? null : await safe(tabs.getObservation(tabId), null);
        await run({ type: 'RESUME', tabId, observation, settings, now });
        break;
      }

      case 'STOP':
        await run({ type: 'STOP', now });
        break;

      case 'SAVE_SETTINGS': {
        const candidate = { ...request.settings, schemaVersion: 2 as const };
        const issues = validateSettings(candidate);
        if (issues.length) throw new UserError(issues.map((i) => i.message).join(' '));
        settings = normalizeSettings(candidate);
        await saveSettings(storage, settings);
        note = 'Settings saved.';
        break;
      }

      case 'RESET_SETTINGS':
        settings = defaultSettings();
        await saveSettings(storage, settings);
        note = 'Settings reset to the defaults.';
        break;
    }

    return { ok: true, snapshot: await snapshot(settings, session), ...(note ? { note } : {}) };
  }

  const guarded = (label: string, task: () => Promise<void>) =>
    enqueue(async () => {
      try {
        await task();
      } catch (error) {
        log.error(`${label} failed`, error);
      }
    });

  async function due(): Promise<void> {
    const { settings, session } = await load();
    await apply(session, { type: 'DUE', now: deps.now() }, settings);
  }

  return {
    handleUi(request) {
      return enqueue(async () => {
        try {
          return await handle(request);
        } catch (error) {
          const loaded = await load().catch(() => null);
          const snap = loaded ? await snapshot(loaded.settings, loaded.session) : undefined;
          if (error instanceof UserError) return { ok: false, error: error.message, ...(snap ? { snapshot: snap } : {}) };
          log.error(`Request ${request.type} failed`, error);
          return { ok: false, error: 'Something went wrong in the extension. Details are in the service worker console.', ...(snap ? { snapshot: snap } : {}) };
        }
      });
    },

    handleContent(tabId, report) {
      return guarded('Content report', async () => {
        if (report.type === 'DUE_PING') return due();
        const { settings, session } = await load();
        if (report.type === 'SUBMIT_REPORT') {
          // Normally already applied from the direct answer; this matters after a worker restart.
          if (tabId === session.tabId) await applyResult(session, report.key, report.result, settings);
          return;
        }
        await apply(session, { type: 'OBSERVATION', tabId, observation: report.observation, settings, now: deps.now() }, settings);
      });
    },

    handleDue() {
      return guarded('Due check', due);
    },

    handleTabRemoved(tabId) {
      return guarded('Closed tab', async () => {
        const { settings, session } = await load();
        await apply(session, { type: 'TAB_CLOSED', tabId, now: deps.now() }, settings);
      });
    },

    handleStartup() {
      return guarded('Browser startup', async () => {
        const { settings, session } = await load();
        await apply(session, { type: 'BROWSER_STARTUP', now: deps.now() }, settings);
      });
    },

    handleWake() {
      return guarded('Worker wake', async () => {
        const { settings, session } = await load();
        await apply(session, { type: 'WAKE', now: deps.now() }, settings);
      });
    },
  };
}
