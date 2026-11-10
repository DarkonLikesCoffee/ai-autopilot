// Message contracts between the UI, the background service worker and the
// content script. Every message is validated on receipt.

import type { SubmitRequest, SubmitResult } from '../content/composer.ts';
import type { PageObservation, PageSignals, SessionState, Settings } from './types.ts';

/** UI -> background */
export type UiRequest =
  | { type: 'GET_SNAPSHOT' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'SAVE_SETTINGS'; settings: Settings }
  | { type: 'RESET_SETTINGS' }
  /** "Don't show again" on the Getting started card. */
  | { type: 'DISMISS_GETTING_STARTED' }
  /** A text-free diagnostic report (see report.ts), returned in UiResponse.report. */
  | { type: 'GET_REPORT' };

export interface TabInfo {
  tabId: number;
  title: string;
  conversation: string | null;
}

export interface UiSnapshot {
  settings: Settings;
  session: SessionState;
  /** The tab the session sends to, if it still exists. */
  sessionTab: TabInfo | null;
  /** The active ChatGPT tab in the current window (where Start would bind), if any. */
  activeTab: TabInfo | null;
  /**
   * Whether the active ChatGPT tab's content script answers (it does not in a tab
   * that was open before Autopilot was installed or updated). Checked only while
   * stopped; null when not checked or there is no such tab.
   */
  activeTabConnected: boolean | null;
  /**
   * M5 C-8: structure signals of the tab Autopilot works in (the session's tab,
   * or before Start the active ChatGPT tab), for the panel's Page line; null when
   * that tab does not answer. Counts and booleans only, never text.
   */
  page: Pick<PageSignals, 'composerFound' | 'composerHasText' | 'sendControlFound' | 'stopControlFound' | 'assistantMessageCount' | 'interfaceLanguage'> | null;
  /** Show the Getting started card (a fresh install, until dismissed). */
  gettingStarted: boolean;
  /** Background clock, so the UI can show the countdown without clock skew issues. */
  now: number;
}

export type UiResponse =
  | { ok: true; snapshot: UiSnapshot; note?: string; report?: string }
  | { ok: false; error: string; snapshot?: UiSnapshot };

/** content -> background */
export type ContentReport =
  | { type: 'PAGE_OBSERVATION'; observation: PageObservation }
  | { type: 'CONTENT_READY'; observation: PageObservation }
  /** The page-side timer for the delay fired; the background checks whether it is really due. */
  | { type: 'DUE_PING' }
  /** Sent after every submission attempt, so a restarted worker still learns the outcome. */
  | { type: 'SUBMIT_REPORT'; key: string; result: SubmitResult };

/** background -> content */
export type ContentCommand =
  | { type: 'GET_OBSERVATION' }
  | { type: 'SUBMIT'; key: string; request: SubmitRequest }
  | { type: 'SCHEDULE_PING'; dueAt: number; now: number }
  /** The content script's text-free record of its last send attempt, or null. */
  | { type: 'GET_SEND_DIAGNOSTIC' };

export type { SubmitRequest, SubmitResult };

const UI_TYPES = new Set<UiRequest['type']>(['GET_SNAPSHOT', 'START', 'PAUSE', 'RESUME', 'STOP', 'SAVE_SETTINGS', 'RESET_SETTINGS', 'DISMISS_GETTING_STARTED', 'GET_REPORT']);

export function isUiRequest(value: unknown): value is UiRequest {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !UI_TYPES.has(type as UiRequest['type'])) return false;
  if (type === 'SAVE_SETTINGS') return !!(value as { settings?: unknown }).settings && typeof (value as { settings?: unknown }).settings === 'object';
  return true;
}

const STATUS_VALUES = new Set(['unknown', 'idle', 'generating', 'complete', 'error', 'usage_limit']);
const MARKER_VALUES = new Set(['none', 'continue', 'complete', 'blocked', 'unclear']);

/** A BCP 47-shaped language tag (letters, digits, hyphens; at most 35 characters). */
export function isLanguageTag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 35 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(value);
}

export function isPageObservation(value: unknown): value is PageObservation {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.status === 'string' && STATUS_VALUES.has(o.status) &&
    (o.responseKey === null || typeof o.responseKey === 'string') &&
    typeof o.url === 'string' &&
    !!o.signals && typeof o.signals === 'object' &&
    // M3: only the comparison result may cross; anything else (such as text) is rejected.
    MARKER_VALUES.has((o.signals as Record<string, unknown>).statusMarker as string) &&
    // M5 C-8: the interface language crosses only as a language tag (absent from older content scripts).
    validLanguage((o.signals as Record<string, unknown>).interfaceLanguage)
  );
}

function validLanguage(value: unknown): boolean {
  return value === undefined || value === null || isLanguageTag(value);
}

const OUTCOMES = new Set(['refused', 'submitted', 'not_submitted', 'uncertain']);

export function isSubmitResult(value: unknown): value is SubmitResult {
  return !!value && typeof value === 'object' && OUTCOMES.has((value as { outcome?: unknown }).outcome as string);
}

export function isContentReport(value: unknown): value is ContentReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  switch (r.type) {
    case 'PAGE_OBSERVATION':
    case 'CONTENT_READY':
      return isPageObservation(r.observation);
    case 'DUE_PING':
      return true;
    case 'SUBMIT_REPORT':
      return typeof r.key === 'string' && isSubmitResult(r.result);
    default:
      return false;
  }
}
