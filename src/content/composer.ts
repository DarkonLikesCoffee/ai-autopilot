// Puts text into the ChatGPT composer. insertPrompt never presses Enter or
// clicks Send: the user sends the message. submitPrompt is used only by the
// opt-in auto-continue mode; it clicks Send once and never retries.

import type { SelectorConfig } from './selectors.ts';
import { isVisible } from './page.ts';

export type InsertOutcome =
  | { ok: true; verified: boolean }
  | { ok: false; reason: 'no_composer' | 'composer_not_empty' | 'composer_disabled' | 'insert_failed' };

const normalize = (text: string) => text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function findComposer(doc: Document, selectors: SelectorConfig): HTMLElement | null {
  for (const selector of selectors.composer) {
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

function insertIntoEditable(doc: Document, el: HTMLElement, text: string): void {
  el.focus();
  const selection = doc.getSelection();
  if (selection) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }
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

export function insertPrompt(doc: Document, selectors: SelectorConfig, text: string, overwrite: boolean): InsertOutcome {
  const el = findComposer(doc, selectors);
  if (!el) return { ok: false, reason: 'no_composer' };
  if (el.getAttribute('aria-disabled') === 'true' || (isTextArea(el) && el.disabled)) return { ok: false, reason: 'composer_disabled' };
  if (normalize(composerText(el)) && !overwrite) return { ok: false, reason: 'composer_not_empty' };

  if (isTextArea(el)) {
    el.focus();
    setTextAreaValue(el, text);
  } else {
    insertIntoEditable(doc, el, text);
  }
  const verified = normalize(composerText(el)) === normalize(text);
  return verified ? { ok: true, verified } : { ok: false, reason: 'insert_failed' };
}

export const INSERT_FAILURE_TEXT: Record<Exclude<InsertOutcome, { ok: true }>['reason'], string> = {
  no_composer: 'The ChatGPT message box was not found on this page. Use Copy prompt and paste it yourself.',
  composer_not_empty: 'The ChatGPT message box already contains text.',
  composer_disabled: 'The ChatGPT message box is disabled right now.',
  insert_failed: 'The prompt could not be placed in the message box reliably. Use Copy prompt and paste it yourself.',
};

// ---- Auto-continue only ----------------------------------------------------------

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; reason: Exclude<InsertOutcome, { ok: true }>['reason'] | 'no_send_control' | 'submit_unverified' };

function findEnabledSend(doc: Document, selectors: SelectorConfig): HTMLButtonElement | null {
  for (const selector of selectors.sendControl) {
    let candidates: HTMLButtonElement[];
    try {
      candidates = Array.from(doc.querySelectorAll<HTMLButtonElement>(selector));
    } catch {
      continue;
    }
    const match = candidates.find((el) => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (match) return match;
  }
  return null;
}

function generationStarted(doc: Document, selectors: SelectorConfig): boolean {
  return selectors.stopControl.some((selector) => {
    try {
      return Array.from(doc.querySelectorAll<HTMLElement>(selector)).some((el) => isVisible(el));
    } catch {
      return false;
    }
  });
}

/**
 * Inserts the prompt into an empty composer and clicks Send exactly once.
 * Success means the page visibly accepted it (the composer emptied or a
 * response started). Anything else is reported as a failure, never retried.
 */
export async function submitPrompt(doc: Document, selectors: SelectorConfig, text: string, sleep: (ms: number) => Promise<void>): Promise<SubmitOutcome> {
  const inserted = insertPrompt(doc, selectors, text, false);
  if (!inserted.ok) return inserted;

  // The editor enables Send a moment after its content changes.
  let send: HTMLButtonElement | null = null;
  for (let i = 0; i < 30 && !send; i += 1) {
    send = findEnabledSend(doc, selectors);
    if (!send) await sleep(100);
  }
  if (!send) return { ok: false, reason: 'no_send_control' };
  send.click();

  for (let i = 0; i < 100; i += 1) {
    await sleep(100);
    const composer = findComposer(doc, selectors);
    if (generationStarted(doc, selectors) || (composer && !normalize(composerText(composer)))) return { ok: true };
  }
  return { ok: false, reason: 'submit_unverified' };
}

export const SUBMIT_FAILURE_TEXT: Record<Exclude<SubmitOutcome, { ok: true }>['reason'], string> = {
  ...INSERT_FAILURE_TEXT,
  composer_not_empty: 'The ChatGPT message box already contained text, so nothing was sent.',
  no_send_control: 'The Send button was not found or stayed disabled, so nothing was sent.',
  submit_unverified: 'Send was clicked but the page did not confirm the message was accepted. It will not be retried.',
};
