// Opt-in diagnostics for the send step, to find out on the live ChatGPT site
// why a continuation could not be sent. Turned on with the same switch as the
// detection diagnostics (localStorage 'chatgpt-autopilot:debug' = '1').
//
// Recorded: which elements match each send-button selector, whether they are
// visible and enabled, a fixed list of their attributes, the buttons next to
// the message box (to find a send button the selectors miss), and the state of
// the message box as lengths and booleans. Never recorded: the prompt, the
// message box's text, any message text, or any button's text content.

import { isVisible } from './page.ts';
import type { SelectorConfig } from './selectors.ts';

/** Attribute values longer than this are cut; labels are short. */
const MAX_VALUE = 60;
const MAX_PER_SELECTOR = 5;
const MAX_NEARBY = 15;
/** Attributes that describe a button's role and state. */
const BUTTON_ATTRIBUTES = ['data-testid', 'id', 'aria-label', 'aria-disabled', 'type', 'data-state'] as const;

export interface ElementInfo {
  tag: string;
  visible: boolean;
  disabled: boolean;
  attributes: Record<string, string>;
}

export interface SendDiagnostic {
  stage: string;
  /** Milliseconds since the prompt was typed. */
  elapsedMs: number;
  insertion: InsertionInfo | null;
  composer: ComposerInfo | null;
  /** Per configured send selector: what it matches. */
  sendSelectors: { selector: string; matches: ElementInfo[]; total: number }[];
  /** The button findSend would use, as an index into the flattened matches, or null. */
  chosen: { selector: string; index: number; usable: boolean } | null;
  /** Buttons in the message box's form (or nearest container), whether or not a selector matches them. */
  nearbyButtons: ElementInfo[];
}

export interface InsertionInfo {
  method: 'textarea' | 'execCommand' | 'paste_fallback';
  execCommandReturned: boolean | null;
}

export interface ComposerInfo {
  tag: string;
  id: string | null;
  contentEditable: string | null;
  proseMirror: boolean;
  focused: boolean;
  textLength: number;
  /** The box holds exactly the prompt (compared after normalizing whitespace). */
  holdsPrompt: boolean;
  paragraphs: number;
  /** The editor shows its empty-state placeholder: its own state may consider the box empty. */
  placeholderShown: boolean;
  /** ChatGPT has kept a hidden textarea next to the editor; its value length shows whether the page's state saw the text. */
  hiddenTextarea: { found: boolean; valueLength: number | null; holdsPrompt: boolean | null };
}

const normalize = (text: string) => text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function short(value: string | null): string | null {
  return value === null ? null : value.slice(0, MAX_VALUE);
}

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

export function describeElement(el: Element): ElementInfo {
  const attributes: Record<string, string> = {};
  for (const name of BUTTON_ATTRIBUTES) {
    const value = short(el.getAttribute(name));
    if (value !== null) attributes[name] = value;
  }
  return { tag: el.tagName.toLowerCase(), visible: isVisible(el as unknown as Parameters<typeof isVisible>[0]), disabled: isDisabled(el), attributes };
}

function safeAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function textOf(el: Element): string {
  if (el.tagName === 'TEXTAREA') return (el as HTMLTextAreaElement).value;
  return (el as HTMLElement).innerText ?? el.textContent ?? '';
}

export function describeComposer(doc: Document, el: Element | null, prompt: string): ComposerInfo | null {
  if (!el) return null;
  const text = textOf(el);
  const hidden = safeAll(doc, 'textarea[name="prompt-textarea"]').find((t) => t !== el) as HTMLTextAreaElement | undefined;
  return {
    tag: el.tagName.toLowerCase(),
    id: short(el.getAttribute('id')),
    contentEditable: short(el.getAttribute('contenteditable')),
    proseMirror: el.classList?.contains('ProseMirror') ?? false,
    focused: doc.activeElement === el,
    textLength: text.length,
    holdsPrompt: normalize(text) === normalize(prompt),
    paragraphs: safeAll(el, 'p').length,
    placeholderShown: safeAll(el, '.placeholder, .is-empty, .is-editor-empty, [data-placeholder]').length > 0 && normalize(text) === '',
    hiddenTextarea: hidden
      ? { found: true, valueLength: hidden.value.length, holdsPrompt: normalize(hidden.value) === normalize(prompt) }
      : { found: false, valueLength: null, holdsPrompt: null },
  };
}

/** Buttons near the message box: in its form, else in the closest ancestor that has any buttons. */
function nearbyButtons(el: Element | null): Element[] {
  if (!el) return [];
  let container: Element | null = el.closest('form');
  if (!container) {
    container = el.parentElement;
    for (let depth = 0; container && depth < 6 && safeAll(container, 'button').length === 0; depth += 1) container = container.parentElement;
  }
  return container ? safeAll(container, 'button').slice(0, MAX_NEARBY) : [];
}

export function collectSendDiagnostic(
  doc: Document,
  selectors: SelectorConfig,
  composer: Element | null,
  prompt: string,
  stage: string,
  elapsedMs: number,
  insertion: InsertionInfo | null,
): SendDiagnostic {
  const sendSelectors = selectors.sendControl.map((selector) => {
    const all = safeAll(doc, selector);
    return { selector, matches: all.slice(0, MAX_PER_SELECTOR).map(describeElement), total: all.length };
  });
  let chosen: SendDiagnostic['chosen'] = null;
  for (const entry of sendSelectors) {
    const index = entry.matches.findIndex((m) => m.visible);
    if (index >= 0) {
      chosen = { selector: entry.selector, index, usable: !entry.matches[index]!.disabled };
      break;
    }
  }
  return {
    stage,
    elapsedMs,
    insertion,
    composer: describeComposer(doc, composer, prompt),
    sendSelectors,
    chosen,
    nearbyButtons: nearbyButtons(composer).map(describeElement),
  };
}
