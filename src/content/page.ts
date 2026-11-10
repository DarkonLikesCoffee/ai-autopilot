// Reads observable page state into a small, text-free observation.
// Written against minimal interfaces so tests can supply a fake document.

import { AUTH_PATTERNS, ERROR_PATTERNS, USAGE_LIMIT_PATTERNS, type SelectorConfig } from './selectors.ts';
import type { PageObservation, PageSignals, ResponseStatus } from '../shared/types.ts';
import { readStatusMarker, type MarkerNode } from './statusMarker.ts';

export interface ElementLike {
  textContent: string | null;
  /** Present on textareas; contenteditable composers use textContent. */
  value?: string;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
  checkVisibility?: () => boolean;
  /** Present on real elements; used to skip visually hidden (1px) screen-reader regions. */
  getBoundingClientRect?: () => { width: number; height: number };
  /** Present on real elements; used only to find a message id on a nested element. */
  querySelectorAll?(selector: string): ArrayLike<ElementLike>;
}

export interface QueryRoot {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/** Notice texts longer than this are not notices; they are not inspected. */
const MAX_NOTICE_LENGTH = 600;

function safeQueryAll(root: QueryRoot, selector: string): ElementLike[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    // An invalid selector must not break detection; it simply matches nothing.
    return [];
  }
}

export function isVisible(element: ElementLike): boolean {
  if (typeof element.checkVisibility === 'function') {
    try {
      return element.checkVisibility();
    } catch {
      return true;
    }
  }
  return true;
}

function findVisible(root: QueryRoot, selectors: string[]): ElementLike[] {
  const found: ElementLike[] = [];
  for (const selector of selectors) {
    for (const element of safeQueryAll(root, selector)) {
      if (!found.includes(element) && isVisible(element)) found.push(element);
    }
  }
  return found;
}

function noticeMatches(root: QueryRoot, selectors: SelectorConfig, patterns: RegExp[]): boolean {
  for (const element of findVisible(root, selectors.noticeRegion)) {
    if (element.closest(selectors.messageContainer)) continue;
    const text = element.textContent ?? '';
    if (!text || text.length > MAX_NOTICE_LENGTH) continue;
    if (patterns.some((re) => re.test(text))) return true;
  }
  return false;
}

/**
 * The rendered messages of one kind. The first selector that matches any
 * visible element defines the list, so a page that carries both a new and an
 * old marker (often nested, one inside the other) is not counted twice, and
 * the list stays in document order.
 */
export function findMessages(root: QueryRoot, selectors: string[]): ElementLike[] {
  for (const selector of selectors) {
    const visible = safeQueryAll(root, selector).filter(isVisible);
    if (visible.length > 0) return visible;
  }
  return [];
}

function asElement(value: unknown): ElementLike | null {
  return value && typeof (value as ElementLike).getAttribute === 'function' ? (value as ElementLike) : null;
}

/**
 * The stable id of a message: on the element itself, else on the last nested
 * element that has one (a turn wrapper around the message), else on an
 * enclosing element. Null when there is none; never guessed.
 */
export function messageId(element: ElementLike | undefined, attributes: string | readonly string[]): string | null {
  for (const attribute of typeof attributes === 'string' ? [attributes] : attributes) {
    const id = messageIdFor(element, attribute);
    if (id) return id;
  }
  return null;
}

function messageIdFor(element: ElementLike | undefined, attribute: string): string | null {
  if (!element) return null;
  const own = element.getAttribute(attribute);
  if (own) return own;
  const selector = `[${attribute}]`;
  if (typeof element.querySelectorAll === 'function') {
    try {
      const nested = Array.from(element.querySelectorAll(selector));
      const id = nested[nested.length - 1]?.getAttribute(attribute);
      if (id) return id;
    } catch {
      // Fall through to the enclosing element.
    }
  }
  try {
    return asElement(element.closest(selector))?.getAttribute(attribute) || null;
  } catch {
    return null;
  }
}

/** Rendered on screen: visible and larger than the 1px boxes used for screen-reader-only text. */
function isRendered(element: ElementLike): boolean {
  if (!isVisible(element)) return false;
  if (typeof element.getBoundingClientRect !== 'function') return true;
  try {
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  } catch {
    return true;
  }
}

const KNOWN_NOTICE_PATTERNS = (): RegExp[] => [...USAGE_LIMIT_PATTERNS, ...AUTH_PATTERNS, ...ERROR_PATTERNS];

/**
 * A rendered alert-type notice outside the conversation that matches no known
 * text. Unknown notices (any language) must never let a continuation go out.
 * The text is only tested and discarded, never kept.
 */
export function unrecognizedNotice(root: QueryRoot, selectors: SelectorConfig): boolean {
  const known = KNOWN_NOTICE_PATTERNS();
  for (const element of findVisible(root, selectors.alertRegion)) {
    if (!isRendered(element) || element.closest(selectors.messageContainer)) continue;
    const text = (element.textContent ?? '').trim();
    if (!text) continue;
    // A long text is not a recognizable notice, but it is still an alert: unknown.
    if (text.length <= MAX_NOTICE_LENGTH && known.some((re) => re.test(text))) continue;
    return true;
  }
  return false;
}

/** Whether an element has text, without keeping the text. */
export function hasText(element: ElementLike | undefined): boolean {
  if (!element) return false;
  const text = typeof element.value === 'string' ? element.value : element.textContent ?? '';
  return text.replace(/\u00a0/g, ' ').trim().length > 0;
}

export function readSignals(root: QueryRoot, selectors: SelectorConfig): { signals: PageSignals; lastMessageId: string | null; lastMessage: ElementLike | undefined } {
  const assistants = findMessages(root, selectors.assistantMessage);
  const last = assistants[assistants.length - 1];
  const composers = findVisible(root, selectors.composer);
  return {
    signals: {
      composerFound: composers.length > 0,
      composerHasText: hasText(composers[0]),
      stopControlFound: findVisible(root, selectors.stopControl).length > 0,
      sendControlFound: findVisible(root, selectors.sendControl).length > 0,
      streamingMarkerFound: findVisible(root, selectors.streamingMarker).length > 0,
      assistantMessageCount: assistants.length,
      userMessageCount: findMessages(root, selectors.userMessage).length,
      errorNoticeFound: noticeMatches(root, selectors, ERROR_PATTERNS),
      usageLimitNoticeFound: noticeMatches(root, selectors, USAGE_LIMIT_PATTERNS),
      authRequired: noticeMatches(root, selectors, AUTH_PATTERNS) || (composers.length === 0 && findVisible(root, selectors.loginControl).length > 0),
      unrecognizedNoticeFound: unrecognizedNotice(root, selectors),
      statusMarker: 'none',
      answerContentElements: 0,
    },
    lastMessageId: messageId(last, selectors.messageIdAttributes),
    lastMessage: last,
  };
}

/**
 * Maps signals to a status. Order matters: a usage-limit notice wins, then any
 * sign of generation, then errors (including a login prompt). Without a
 * composer the page is not in a recognizable state, so the answer is "unknown".
 */
export function classify(signals: PageSignals): ResponseStatus {
  if (signals.usageLimitNoticeFound) return 'usage_limit';
  if (signals.stopControlFound || signals.streamingMarkerFound) return 'generating';
  if (signals.errorNoticeFound || signals.authRequired) return 'error';
  if (!signals.composerFound) return 'unknown';
  return signals.assistantMessageCount > 0 ? 'complete' : 'idle';
}

export function conversationPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function responseKey(url: string, signals: PageSignals, lastMessageId: string | null): string | null {
  if (signals.assistantMessageCount === 0) return null;
  const marker = lastMessageId ? `id:${lastMessageId}` : `n:${signals.assistantMessageCount}`;
  return `${conversationPath(url)}|${marker}`;
}

export interface ObserveOptions {
  /** M3: read the latest finished answer's status marker. Only when the setting is on. */
  readMarker?: boolean;
}

export function observePage(root: QueryRoot, url: string, selectors: SelectorConfig, options: ObserveOptions = {}): PageObservation {
  const { signals, lastMessageId, lastMessage } = readSignals(root, selectors);
  const status = classify(signals);
  // The answer is read only when the setting is on and it is a finished answer (R1, design rules 1-3).
  if (options.readMarker === true && status === 'complete' && lastMessage) {
    const reading = readStatusMarker(lastMessage as unknown as MarkerNode, selectors.answerContent);
    signals.statusMarker = reading.marker;
    signals.answerContentElements = reading.contentElements;
  }
  return { status, responseKey: responseKey(url, signals, lastMessageId), url, signals };
}
