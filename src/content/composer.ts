// Sends the continuation prompt through ChatGPT's own interface: it types the
// prompt into the message box, checks that exactly that text is there, clicks
// the send button, and then confirms on the page that the message was sent.
// It never overwrites text that is already in the message box.

import type { SelectorConfig } from './selectors.ts';
import { isVisible, observePage } from './page.ts';
import type { PageSignals } from '../shared/types.ts';
import type { PrecheckFailure } from '../shared/session.ts';

export interface SubmitRequest {
  text: string;
  /** The session's conversation path; nothing is sent anywhere else. */
  expectedPath: string;
  /** The response being continued; if a different one is now the latest, nothing is sent. */
  expectedKey: string;
}

export type SubmitFailure = 'no_composer' | 'composer_disabled' | 'insert_failed' | 'send_unavailable' | 'tab_suspended' | 'not_sent';

export type SubmitResult =
  /** Checks failed before anything was typed; the page is untouched. */
  | { outcome: 'refused'; reason: PrecheckFailure }
  | { outcome: 'submitted'; sawGenerating: boolean }
  | { outcome: 'not_submitted'; reason: SubmitFailure; detail: string }
  | { outcome: 'uncertain'; detail: string };

export interface SubmitTiming {
  /** How long to wait for the send button to become usable after typing. */
  sendReadyMs: number;
  /** How long to wait for evidence that the message was sent. */
  confirmMs: number;
  pollMs: number;
  /**
   * Extra time allowed on top of sendReadyMs before the click. If the attempt
   * took longer than that, the tab was frozen or heavily throttled (a hidden
   * tab): the background may already have given up on the reply, so the click
   * is not made.
   */
  lateMarginMs: number;
  sleep(ms: number): Promise<void>;
  /** Wall-clock time. The waits are measured with it, not by counting polls, because timers in hidden tabs can run minutes late. */
  now(): number;
}

export const DEFAULT_SUBMIT_TIMING: Omit<SubmitTiming, 'sleep' | 'now'> = { sendReadyMs: 3000, confirmMs: 10000, pollMs: 100, lateMarginMs: 2000 };

const normalize = (text: string) => text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function findComposer(doc: Document, selectors: SelectorConfig): HTMLElement | null {
  return findFirstVisible(doc, selectors.composer);
}

function findFirstVisible(doc: Document, list: string[]): HTMLElement | null {
  for (const selector of list) {
    let candidates: HTMLElement[];
    try {
      candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }
    const match = candidates.find((el) => isVisible(el));
    if (match) return match;
  }
  return null;
}

function isTextArea(el: HTMLElement): el is HTMLTextAreaElement {
  return el.tagName === 'TEXTAREA';
}

export function composerText(el: HTMLElement): string {
  return isTextArea(el) ? el.value : el.innerText ?? el.textContent ?? '';
}

function setTextAreaValue(el: HTMLTextAreaElement, text: string): void {
  // Use the native setter so frameworks that track the value notice the change.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectAll(doc: Document, el: HTMLElement): void {
  el.focus();
  const selection = doc.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertIntoEditable(doc: Document, el: HTMLElement, text: string): void {
  selectAll(doc, el);
  // execCommand('insertText') goes through the editor's own input handling
  // (ProseMirror), which keeps its internal state consistent.
  let inserted = false;
  try {
    inserted = doc.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted || normalize(composerText(el)) !== normalize(text)) {
    // Fallback: a synthetic paste, which editors handle as user input.
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }
}

/**
 * Removes the prompt this module typed, but only while the box still holds
 * exactly that prompt: if you typed anything meanwhile, the box is left alone.
 * Returns whether the box holds the prompt no more.
 */
function removePrompt(doc: Document, el: HTMLElement, text: string): boolean {
  if (normalize(composerText(el)) !== normalize(text)) return false;
  clearComposer(doc, el);
  return normalize(composerText(el)) === '';
}

/** Removes text this module typed (only ever called when the box was empty before). */
function clearComposer(doc: Document, el: HTMLElement): void {
  if (isTextArea(el)) {
    setTextAreaValue(el, '');
    return;
  }
  selectAll(doc, el);
  try {
    doc.execCommand('delete', false);
  } catch {
    // Leave it; the result reports what happened.
  }
}

function isUsable(button: HTMLElement): boolean {
  return !(button as HTMLButtonElement).disabled && button.getAttribute('aria-disabled') !== 'true';
}

/**
 * Evidence that the message was sent: the prompt has left the message box, and
 * a new user message is in the thread or ChatGPT started generating. Neither
 * alone is enough: an emptied box can be a re-render, and more user messages
 * can be older ones loading in while the prompt still waits in the box.
 */
export function submissionEvidence(userCountBefore: number, signals: PageSignals, promptInBox: boolean): { sent: boolean; generating: boolean } {
  const generating = signals.stopControlFound || signals.streamingMarkerFound;
  return { sent: !promptInBox && (signals.userMessageCount > userCountBefore || generating), generating };
}

/** Checks the live page, in the tab, right before anything is typed. */
export function precheck(doc: Document, url: string, selectors: SelectorConfig, request: SubmitRequest): PrecheckFailure | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return 'conversation_changed';
  }
  if (path !== request.expectedPath) return 'conversation_changed';
  const observation = observePage(doc, url, selectors);
  if (observation.status === 'usage_limit') return 'usage_limit';
  if (observation.signals.authRequired) return 'auth_required';
  if (observation.status === 'generating') return 'generating';
  if (observation.signals.composerHasText) return 'composer_has_text';
  if (observation.status !== 'complete') return 'not_complete';
  if (observation.responseKey !== request.expectedKey) return 'response_changed';
  return null;
}

/**
 * While the prompt sits in the box waiting for the send button, anything that
 * changes the page ends the attempt without a click. The prompt is removed
 * only if the box still holds exactly the prompt; your text is never touched.
 */
function pageChangedWhileWaiting(doc: Document, url: string, selectors: SelectorConfig, request: SubmitRequest, typedInto: HTMLElement): SubmitResult | null {
  const box = findComposer(doc, selectors);
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  const vanished: SubmitResult = { outcome: 'uncertain', detail: 'the prompt left the message box before Autopilot clicked send' };
  if (!box) return vanished;
  if (box !== typedInto) {
    // The box was re-rendered. If the prompt moved over, take it out: nothing was
    // sent. If the new box is empty, the prompt may have been sent (Enter): unknown.
    // Any other text is yours and stays.
    if (removePrompt(doc, box, request.text)) return { outcome: 'refused', reason: 'not_complete' };
    return normalize(composerText(box)) === '' ? vanished : { outcome: 'refused', reason: 'composer_has_text' };
  }
  const now = normalize(composerText(typedInto));
  if (now !== normalize(request.text)) {
    // Emptied: perhaps sent with Enter, so it is not retried. Changed: you typed,
    // and the box is left exactly as it is.
    return now === '' ? vanished : { outcome: 'refused', reason: 'composer_has_text' };
  }
  if (path !== request.expectedPath) {
    return removePrompt(doc, typedInto, request.text) ? { outcome: 'refused', reason: 'conversation_changed' } : { outcome: 'refused', reason: 'composer_has_text' };
  }
  const observation = observePage(doc, url, selectors);
  if (observation.status === 'generating' || observation.status === 'usage_limit') {
    if (!removePrompt(doc, typedInto, request.text)) return { outcome: 'refused', reason: 'composer_has_text' };
    return { outcome: 'refused', reason: observation.status === 'usage_limit' ? 'usage_limit' : 'generating' };
  }
  return null;
}

export async function submitContinuation(
  doc: Document,
  getUrl: () => string,
  selectors: SelectorConfig,
  request: SubmitRequest,
  timing: SubmitTiming,
): Promise<SubmitResult> {
  const refusal = precheck(doc, getUrl(), selectors, request);
  if (refusal) return { outcome: 'refused', reason: refusal };

  const el = findComposer(doc, selectors);
  if (!el) return { outcome: 'not_submitted', reason: 'no_composer', detail: 'the message box was not found' };
  if (el.getAttribute('aria-disabled') === 'true' || (isTextArea(el) && el.disabled)) {
    return { outcome: 'not_submitted', reason: 'composer_disabled', detail: 'the message box is disabled' };
  }

  // 1. Type the prompt and verify it is exactly what the box contains.
  if (isTextArea(el)) {
    el.focus();
    setTextAreaValue(el, request.text);
  } else {
    insertIntoEditable(doc, el, request.text);
  }
  if (normalize(composerText(el)) !== normalize(request.text)) {
    clearComposer(doc, el);
    return { outcome: 'not_submitted', reason: 'insert_failed', detail: 'the prompt could not be typed into the message box reliably' };
  }

  // 2. Wait for the send button to become usable, then click it once. Before
  // every look, and right before the click, the page must still be as checked:
  // same conversation, not generating, and the box holding exactly the prompt.
  const typedAt = timing.now();
  let button: HTMLElement | null = null;
  for (;;) {
    const elapsed = timing.now() - typedAt;
    if (elapsed > timing.sendReadyMs + timing.lateMarginMs) {
      // Suspended or throttled while waiting: never click this late.
      if (!removePrompt(doc, el, request.text)) return { outcome: 'refused', reason: 'composer_has_text' };
      return {
        outcome: 'not_submitted',
        reason: 'tab_suspended',
        detail: `the tab was suspended or throttled for ${Math.round(elapsed / 1000)}s while the prompt waited (a hidden or frozen tab), so send was not clicked`,
      };
    }
    const changed = pageChangedWhileWaiting(doc, getUrl(), selectors, request, el);
    if (changed) return changed;
    const candidate = findFirstVisible(doc, selectors.sendControl);
    if (candidate && isUsable(candidate)) {
      button = candidate;
      break;
    }
    if (elapsed >= timing.sendReadyMs) break;
    await timing.sleep(timing.pollMs);
  }
  if (!button) {
    if (!removePrompt(doc, el, request.text)) {
      return { outcome: 'refused', reason: 'composer_has_text' };
    }
    return { outcome: 'not_submitted', reason: 'send_unavailable', detail: 'the send button did not become available' };
  }
  const userCountBefore = observePage(doc, getUrl(), selectors).signals.userMessageCount;
  button.click();

  // 3. Confirm on the page that it was sent.
  const clickedAt = timing.now();
  for (;;) {
    const current = findComposer(doc, selectors);
    const promptInBox = !!current && normalize(composerText(current)) === normalize(request.text);
    const evidence = submissionEvidence(userCountBefore, observePage(doc, getUrl(), selectors).signals, promptInBox);
    if (evidence.sent) return { outcome: 'submitted', sawGenerating: evidence.generating };
    if (timing.now() - clickedAt >= timing.confirmMs) break;
    await timing.sleep(timing.pollMs);
  }
  const box = findComposer(doc, selectors);
  if (box && normalize(composerText(box)) === normalize(request.text)) {
    // The prompt is still sitting in the box: it was not sent. Remove it again.
    removePrompt(doc, box, request.text);
    return { outcome: 'not_submitted', reason: 'not_sent', detail: 'clicking send did not send the message' };
  }
  return { outcome: 'uncertain', detail: 'the message box was emptied but no sent message or response appeared' };
}
