// Reads observable page state into a small, text-free observation.
// Written against minimal interfaces so tests can supply a fake document.

import { ERROR_PATTERNS, USAGE_LIMIT_PATTERNS, type SelectorConfig } from './selectors.ts';
import type { PageObservation, PageSignals, ReportedStatus, ResponseStatus } from '../shared/types.ts';

export interface ElementLike {
  textContent: string | null;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
  checkVisibility?: () => boolean;
}

export interface QueryRoot {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/** Notice texts longer than this are not notices; they are not inspected. */
const MAX_NOTICE_LENGTH = 600;

/** Only this many characters at the end of the latest reply are looked at, and only for the status line. */
const STATUS_TAIL_LENGTH = 300;

// The status must be the last thing in the reply (Markdown emphasis and a full stop are tolerated),
// so an echo of the instruction ("CONTINUE, MILESTONE COMPLETE or BLOCKED") never counts.
const STATUS_LINE_RE = /AUTOPILOT STATUS\s*:?[\s*_`]*(CONTINUE|MILESTONE COMPLETE|BLOCKED)[\s*_`.!]*$/i;

/**
 * Maps the end of a reply to a status. The text is inspected in memory and
 * discarded; only the resulting value leaves this function.
 */
export function readReportedStatus(replyText: string): ReportedStatus {
  const tail = replyText.slice(-STATUS_TAIL_LENGTH).replace(/\u00a0/g, ' ').trimEnd();
  const match = STATUS_LINE_RE.exec(tail);
  if (!match) return 'missing';
  const value = (match[1] ?? '').toUpperCase().replace(/\s+/g, ' ');
  return value === 'CONTINUE' ? 'continue' : value === 'BLOCKED' ? 'blocked' : 'milestone_complete';
}

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

export function readSignals(root: QueryRoot, selectors: SelectorConfig): { signals: PageSignals; lastMessageId: string | null; reportedStatus: ReportedStatus | null } {
  const assistants = findVisible(root, selectors.assistantMessage);
  const last = assistants[assistants.length - 1];
  return {
    signals: {
      composerFound: findVisible(root, selectors.composer).length > 0,
      stopControlFound: findVisible(root, selectors.stopControl).length > 0,
      sendControlFound: findVisible(root, selectors.sendControl).length > 0,
      streamingMarkerFound: findVisible(root, selectors.streamingMarker).length > 0,
      assistantMessageCount: assistants.length,
      errorNoticeFound: noticeMatches(root, selectors, ERROR_PATTERNS),
      usageLimitNoticeFound: noticeMatches(root, selectors, USAGE_LIMIT_PATTERNS),
    },
    lastMessageId: last?.getAttribute(selectors.messageIdAttribute) ?? null,
    reportedStatus: last ? readReportedStatus(last.textContent ?? '') : null,
  };
}

/**
 * Maps signals to a status. Order matters: a usage-limit notice wins, then any
 * sign of generation, then errors. Without a composer the page is not in a
 * recognizable state, so the answer is "unknown".
 */
export function classify(signals: PageSignals): ResponseStatus {
  if (signals.usageLimitNoticeFound) return 'usage_limit';
  if (signals.stopControlFound || signals.streamingMarkerFound) return 'generating';
  if (signals.errorNoticeFound) return 'error';
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

export function observePage(root: QueryRoot, url: string, selectors: SelectorConfig): PageObservation {
  const { signals, lastMessageId, reportedStatus } = readSignals(root, selectors);
  return { status: classify(signals), responseKey: responseKey(url, signals, lastMessageId), url, reportedStatus, signals };
}
