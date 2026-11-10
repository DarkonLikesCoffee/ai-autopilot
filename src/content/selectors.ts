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
  /**
   * Attributes holding a stable id on (or inside) an assistant message, tried in
   * order. The id makes the response key independent of how many turns ChatGPT
   * happens to render.
   */
  messageIdAttributes: string[];
  /** Regions where ChatGPT shows errors and limit notices. Text inside conversation messages is excluded. */
  noticeRegion: string[];
  /**
   * Alert-type regions: a visible one outside the conversation whose text matches
   * no known pattern is an unrecognized notice (Autopilot pauses). Narrower than
   * noticeRegion on purpose: role="status" and toasts are routine (e.g. "Copied").
   */
  alertRegion: string[];
  /**
   * The rendered answer content inside an assistant message (M3 status marker;
   * R9). The marker is read only if exactly one visible element matches inside
   * the latest answer; otherwise the result is "unclear" and nothing is read.
   * Live (probe v2, 2026-11-09): div[data-markdown-text-style="assistant-message"]
   * holds the rendered answer. `.markdown` (the earlier, unverified guess) does
   * not exist on the live page (M3-L0 FAIL) and is no longer used.
   */
  answerContent: string[];
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
  // Live structure (probe v2, owner, 2026-11-09): each assistant turn is a unit
  // div[data-content-search-unit-key="<turn>:<n>:assistant"] holding a visually
  // hidden heading h4.sr-only[data-conversation-role="assistant"] and the message.
  // The unit comes first; the heading alone is not the message (it was matched
  // before, so the message's id and answer content were never found).
  assistantMessage: ['[data-content-search-unit-key$=":assistant"]', '[data-conversation-role="assistant"]', '[data-message-author-role="assistant"]'],
  userMessage: ['[data-user-message-bubble]', '[data-conversation-role="user"]', '[data-message-author-role="user"]'],
  loginControl: ['button[data-testid="login-button"]', 'a[href*="/auth/login"]'],
  // Live: the message carries data-chatgpt-selection-message-id and its rendered
  // response data-dil-message-id (the same uuid); data-message-id is the older markup.
  messageIdAttributes: ['data-message-id', 'data-chatgpt-selection-message-id', 'data-dil-message-id'],
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
  answerContent: ['[data-markdown-text-style="assistant-message"]'],
  // The answer content itself is conversation text (never a notice); the rest of a live
  // assistant unit is not excluded, so an error ChatGPT shows inside the turn is still detected.
  messageContainer: '[data-markdown-text-style], [data-conversation-role], [data-message-author-role], [data-user-message-bubble]',
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
