// Every assumption about ChatGPT's page structure lives here. When ChatGPT
// changes its interface, this is the file to update. Each list is tried in
// order; for controls and markers any match counts. For message lists
// (assistantMessage, userMessage) the first selector that matches anything
// defines the list, so put the most specific current marker first. If none of the composer selectors match, the page
// status is reported as "unknown" rather than guessed.

export interface SelectorConfig {
  /** The message input. */
  composer: string[];
  /** The control that stops a response while it is generating. */
  stopControl: string[];
  /**
   * The send control. Clicked only to send the continuation, after its text was
   * verified. A match inside the message box's own form is preferred over one
   * elsewhere on the page (see findSendButton).
   */
  sendControl: string[];
  /** Markers that a response is still streaming. */
  streamingMarker: string[];
  /** Rendered assistant messages; the first matching selector wins. Only their count and id attribute are read, never their text. */
  assistantMessage: string[];
  /** Rendered user messages; the first matching selector wins. Only counted, to confirm that a continuation was sent. */
  userMessage: string[];
  /** Controls shown when ChatGPT wants you to log in. */
  loginControl: string[];
  /** Attribute holding a stable id on assistant messages. */
  messageIdAttribute: string;
  /** Regions where ChatGPT shows errors and limit notices. Text inside conversation messages is excluded. */
  noticeRegion: string[];
  /**
   * Alert-type regions: a visible one outside the conversation whose text matches
   * no known pattern is an unrecognized notice (Autopilot pauses). Narrower than
   * noticeRegion on purpose: role="status" and toasts are routine (e.g. "Copied").
   */
  alertRegion: string[];
  /** Any element matching this is a conversation message; notices inside it are ignored. */
  messageContainer: string;
}

/**
 * Localized button labels, by ChatGPT interface language. ChatGPT does not
 * always give its buttons a language-independent attribute (an es-ES page was
 * seen with only <button aria-label="Enviar" type="submit">), so the visible
 * label is sometimes the only way to recognize them.
 *
 * Add a language only from a live observation: run docs/send-probe.js in a
 * ChatGPT tab in that language (see docs/LIVE_VALIDATION.md) and copy the
 * button's aria-label exactly. Do not translate labels by guesswork: a wrong
 * label matches nothing, a too-generic one could match the wrong button.
 */
export const LOCALIZED_LABELS: Record<string, { send: string[]; stop: string[]; source: string }> = {
  en: { send: ['Send prompt', 'Send message'], stop: ['Stop streaming', 'Stop generating', 'Stop answering'], source: 'original selectors' },
  es: { send: ['Enviar'], stop: ['Detener'], source: 'owner live diagnostics, es-ES, 2026-11-04' },
};

const labelSelectors = (kind: 'send' | 'stop') =>
  Object.values(LOCALIZED_LABELS).flatMap((entry) => entry[kind].map((label) => `button[aria-label="${label}"]`));

export const DEFAULT_SELECTORS: SelectorConfig = {
  composer: [
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    'form [contenteditable="true"][role="textbox"]',
    'form textarea',
  ],
  // Language-independent attributes first, then the localized labels.
  stopControl: ['button[data-testid="stop-button"]', ...labelSelectors('stop')],
  sendControl: ['button[data-testid="send-button"]', '#composer-submit-button', ...labelSelectors('send')],
  streamingMarker: ['[data-talvt-turn-state="in_progress"]', '.result-streaming', '[data-testid="streaming-indicator"]'],
  assistantMessage: ['[data-conversation-role="assistant"]', '[data-message-author-role="assistant"]'],
  userMessage: ['[data-user-message-bubble]', '[data-conversation-role="user"]', '[data-message-author-role="user"]'],
  loginControl: ['button[data-testid="login-button"]', 'a[href*="/auth/login"]'],
  messageIdAttribute: 'data-message-id',
  noticeRegion: [
    '[role="alert"]',
    '[role="status"]',
    '[data-testid*="toast"]',
    '[data-testid*="error"]',
    '[data-testid*="limit"]',
    '.text-token-text-error',
    '[class*="border-token-surface-error"]',
  ],
  alertRegion: ['[role="alert"]', '.text-token-text-error', '[class*="border-token-surface-error"]', '[data-testid*="error"]'],
  messageContainer: '[data-conversation-role], [data-message-author-role], [data-user-message-bubble]',
};

// Patterns are matched against short notice texts only; the text is discarded right away.
export const USAGE_LIMIT_PATTERNS: RegExp[] = [
  /you(?:'|’)ve (?:hit|reached) (?:the|your|our)\b[^.]{0,80}\blimit/i,
  /\busage (?:limit|cap)\b/i,
  /\blimit (?:resets|will reset)\b/i,
  /\btoo many requests\b/i,
  /\brate limit/i,
  /\bmessage cap\b/i,
];

export const AUTH_PATTERNS: RegExp[] = [
  /\byour session has expired\b/i,
  /\bplease log ?in again\b/i,
  /\blog ?in to continue\b/i,
];

export const ERROR_PATTERNS: RegExp[] = [
  /\bsomething went wrong\b/i,
  /\bthere was an error\b/i,
  /\berror (?:generating|in message stream|occurred)\b/i,
  /\bnetwork error\b/i,
  /\bunable to (?:load|generate)\b/i,
  /\brequest failed\b/i,
  /\bconversation not found\b/i,
];
