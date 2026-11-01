// Shared data shapes. Everything here is plain JSON so it can be persisted in
// chrome.storage and passed through extension messaging unchanged.

export interface Settings {
  schemaVersion: 2;
  /** Sent unchanged after every completed response. */
  prompt: string;
  /** Wait between a confirmed completion and sending the continuation. */
  delaySeconds: number;
  /** How long the page must stay finished before a response counts as complete. */
  confirmSeconds: number;
  /** Maximum continuations per session; 0 means no extension-imposed limit. */
  maxCycles: number;
  notifications: boolean;
}

/**
 * What the content script observed on the ChatGPT page. "unknown" means the
 * page did not expose enough information; it is never upgraded to a guess.
 */
export type ResponseStatus = 'unknown' | 'idle' | 'generating' | 'complete' | 'error' | 'usage_limit';

/** Observation sent by a content script. Never contains message text. */
export interface PageObservation {
  status: ResponseStatus;
  /** "<conversation path>|<last assistant message marker>", or null without an assistant message. */
  responseKey: string | null;
  url: string;
  signals: PageSignals;
}

export interface PageSignals {
  composerFound: boolean;
  /** The composer contains text (never the text itself). */
  composerHasText: boolean;
  stopControlFound: boolean;
  sendControlFound: boolean;
  streamingMarkerFound: boolean;
  assistantMessageCount: number;
  userMessageCount: number;
  errorNoticeFound: boolean;
  usageLimitNoticeFound: boolean;
  /** Login screen or session-expired notice. */
  authRequired: boolean;
}

/**
 * stopped – no session
 * running – a session is active (see SessionPhase)
 * paused  – the user paused, or a safeguard paused because something needs a look
 * error   – a condition that must not be retried automatically (usage limit, failed submission)
 */
export type RunState = 'stopped' | 'running' | 'paused' | 'error';

/**
 * watching   – waiting for ChatGPT to generate and finish a response
 * delay      – a response finished; the continuation is sent when the delay ends
 * submitting – the continuation is being inserted and sent (recorded before the attempt)
 */
export type SessionPhase = 'watching' | 'delay' | 'submitting';

export type HaltReason =
  | 'user'
  | 'max_cycles'
  | 'usage_limit'
  | 'auth_required'
  | 'page_error'
  | 'conversation_changed'
  | 'tab_closed'
  | 'browser_restarted'
  | 'composer_has_text'
  | 'submit_failed'
  | 'submission_uncertain'
  | 'tab_unreachable';

export interface SessionState {
  schemaVersion: 2;
  run: RunState;
  phase: SessionPhase;
  /** Why the session is paused, in error, or stopped (null while running). */
  reason: HaltReason | null;
  /** Detail for the reason (shown to the user; never page text). */
  detail: string | null;
  /** The tab this session sends to. Tab ids do not survive a browser restart. */
  tabId: number | null;
  /** Path of the conversation this session belongs to. */
  conversation: string | null;
  /** Continuations sent in this session. */
  cycles: number;
  /** A generation was observed since the session started or the last continuation. */
  generationSeen: boolean;
  /** Response the pending continuation answers (phase delay/submitting). */
  pendingKey: string | null;
  /** When the delay ends (phase delay). */
  dueAt: number | null;
  /** When the current submission attempt started (phase submitting). */
  submitStartedAt: number | null;
  /** Responses a continuation was sent (or attempted) for. Never submitted for again. Bounded. */
  answeredKeys: string[];
  lastStatus: ResponseStatus;
  lastContinuationAt: number | null;
  startedAt: number | null;
  updatedAt: number | null;
  log: LogEntry[];
}

export interface LogEntry {
  at: number;
  message: string;
}
