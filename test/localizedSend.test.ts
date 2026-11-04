// Regression for the live es-ES failure (2026-11-04): the only send control was
// <button aria-label="Enviar" type="submit">, so every send selector matched
// nothing and each continuation stopped with "the send button did not become
// available", although the prompt was inserted correctly. The fake DOM below
// reproduces that structure and runs the real selectors through a small
// selector matcher, so selector changes are exercised, not hard-coded.

import test from 'node:test';
import assert from 'node:assert/strict';
import { submitContinuation, type SubmitResult } from '../src/content/composer.ts';
import { observePage } from '../src/content/page.ts';
import { DEFAULT_SELECTORS, LOCALIZED_LABELS } from '../src/content/selectors.ts';
import { findSendButton } from '../src/content/sendButton.ts';
import { collectSendDiagnostic, type SendDiagnostic } from '../src/content/sendDiagnostics.ts';

const PROMPT = 'Continue working on the project.\n\nRead the repository\'s AUTOPILOT.md.';
const URL_A = 'https://chatgpt.com/c/abc';
const KEY = '/c/abc|id:m1';

class Node {
  tagName: string;
  attrs: Record<string, string>;
  children: Node[] = [];
  parent: Node | null = null;
  innerText = '';
  disabled = false;
  hidden = false;
  onclick: (() => void) | null = null;
  constructor(tag: string, attrs: Record<string, string> = {}) { this.tagName = tag.toUpperCase(); this.attrs = attrs; }
  get textContent() { return this.innerText; }
  get id() { return this.attrs.id ?? ''; }
  get parentElement() { return this.parent; }
  get classList() { return { contains: (c: string) => (this.attrs.class ?? '').split(/\s+/).includes(c) }; }
  append(...nodes: Node[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } return this; }
  getAttribute(name: string) { return name === 'disabled' ? (this.disabled ? '' : null) : this.attrs[name] ?? null; }
  hasAttribute(name: string) { return this.getAttribute(name) !== null; }
  checkVisibility() { for (let n: Node | null = this; n; n = n.parent) if (n.hidden) return false; return true; }
  contains(other: unknown): boolean { for (let n = other as Node | null; n; n = n.parent) if (n === this) return true; return false; }
  closest(selector: string): Node | null { for (let n: Node | null = this; n; n = n.parent) if (matchesAny(n, selector)) return n; return null; }
  descendants(): Node[] { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  querySelectorAll(selector: string): Node[] { return this.descendants().filter((n) => matchesAny(n, selector)); }
  focus() {}
  dispatchEvent() { return true; }
  click() { if (!this.disabled) this.onclick?.(); }
}

/** Supports what the selector lists use: tag, #id, .class, [attr], [attr="v"]; descendant/other syntax matches nothing. */
function matches(node: Node, selector: string): boolean {
  const m = selector.trim().match(/^([a-z]+)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i);
  if (!m) return false;
  if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2]!.match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) ?? []) {
    if (part.startsWith('#') && node.attrs.id !== part.slice(1)) return false;
    if (part.startsWith('.') && !node.classList.contains(part.slice(1))) return false;
    if (part.startsWith('[')) {
      const [, name, value] = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)!;
      const actual = node.getAttribute(name!);
      if (actual === null || (value !== undefined && actual !== value)) return false;
    }
  }
  return true;
}
const matchesAny = (node: Node, selector: string) => selector.split(',').some((s) => matches(node, s));

interface LivePage { doc: Document; composer: Node; send: Node; form: Node; sent: string[]; root: Node }

/** The live es-ES structure: a ProseMirror composer and the "Enviar" submit button in the composer form. */
function spanishPage(sendAttrs: Record<string, string> = { 'aria-label': 'Enviar', type: 'submit' }): LivePage {
  const root = new Node('html', { lang: 'es-ES' });
  const body = new Node('body');
  const answer = new Node('div', { 'data-message-author-role': 'assistant', 'data-message-id': 'm1' });
  answer.innerText = 'respuesta anterior';
  const form = new Node('form');
  const composer = new Node('div', { id: 'prompt-textarea', contenteditable: 'true', class: 'ProseMirror' });
  const send = new Node('button', sendAttrs);
  form.append(composer, send);
  body.append(answer, form);
  root.append(body);
  const sent: string[] = [];
  send.onclick = () => {
    // A submit button: the form submits what the editor holds.
    if (!composer.innerText.trim()) return;
    sent.push(composer.innerText);
    composer.innerText = '';
    body.append(new Node('div', { 'data-message-author-role': 'user' }));
  };
  const doc = {
    documentElement: root,
    activeElement: composer,
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(command: string, _ui: boolean, value?: string) {
      // The live diagnostics showed execCommandReturned: true and holdsPrompt: true.
      if (command === 'insertText') composer.innerText = value ?? '';
      if (command === 'delete') composer.innerText = '';
      return true;
    },
  };
  return { doc: doc as unknown as Document, composer, send, form, sent, root };
}

function submit(p: LivePage, diagnose?: (d: SendDiagnostic) => void): Promise<SubmitResult> {
  let clock = 0;
  return submitContinuation(p.doc, () => URL_A, DEFAULT_SELECTORS, { text: PROMPT, expectedPath: '/c/abc', expectedKey: KEY }, {
    sendReadyMs: 3000, confirmMs: 3000, pollMs: 100, lateMarginMs: 2000,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    diagnose,
  });
}

test('live es-ES page: the "Enviar" submit button is found and the prompt is sent exactly once', async () => {
  const p = spanishPage();
  assert.equal(observePage(p.doc as never, URL_A, DEFAULT_SELECTORS).status, 'complete');
  const result = await submit(p);
  assert.equal(result.outcome, 'submitted');
  assert.deepEqual(p.sent, [PROMPT]);
  assert.equal(p.composer.innerText, '');
});

test('live es-ES page: the diagnostics now report "Enviar" as the chosen, usable button in the composer form', async () => {
  const p = spanishPage();
  const seen: SendDiagnostic[] = [];
  await submit(p, (d) => seen.push(d));
  const clicking = seen.find((d) => d.stage === 'clicking_send')!;
  assert.deepEqual(clicking.chosen, { selector: 'button[aria-label="Enviar"]', index: 0, usable: true, inComposerForm: true });
  assert.equal(clicking.composer?.holdsPrompt, true);
  assert.equal(clicking.insertion?.method, 'execCommand');
  assert.equal(clicking.sendSelectors.filter((s) => s.total > 0).length, 1, 'only the Spanish label matches, as observed live');
  assert.ok(!JSON.stringify(seen).includes('Continue working'));
});

test('a disabled "Enviar" button is never clicked; the untouched prompt is removed', async () => {
  const p = spanishPage();
  p.send.disabled = true;
  const result = await submit(p);
  assert.equal(result.outcome, 'not_submitted');
  assert.deepEqual(p.sent, []);
  assert.equal(p.composer.innerText, '');
});

test('a hidden "Enviar" button is never clicked', async () => {
  const p = spanishPage();
  p.send.hidden = true;
  const result = await submit(p);
  assert.equal(result.outcome, 'not_submitted');
  assert.deepEqual(p.sent, []);
});

test('a submit button without a recognized send label is not taken for Send (no broad type="submit" selector)', async () => {
  const p = spanishPage({ type: 'submit' });
  const result = await submit(p);
  assert.equal(result.outcome, 'not_submitted');
  assert.equal(result.outcome === 'not_submitted' && result.reason, 'send_unavailable');
  assert.deepEqual(p.sent, []);
});

test('an "Enviar" button elsewhere on the page is ignored when the composer form has its own', async () => {
  const p = spanishPage();
  p.send.disabled = true; // the real send button is not ready
  const elsewhere = new Node('button', { 'aria-label': 'Enviar' }); // e.g. a feedback dialog
  let clickedElsewhere = 0;
  elsewhere.onclick = () => { clickedElsewhere += 1; };
  p.root.children[0]!.append(new Node('dialog').append(elsewhere));
  const choice = findSendButton(p.doc, DEFAULT_SELECTORS.sendControl, p.composer as never);
  assert.equal(choice?.element, p.send as never);
  assert.equal(choice?.inComposerForm, true);
  const result = await submit(p);
  assert.equal(result.outcome, 'not_submitted');
  assert.equal(clickedElsewhere, 0);
});

test('the English send controls still work: data-testid, the composer-submit id and the English labels', async () => {
  const variants: Record<string, string>[] = [
    { 'data-testid': 'send-button' },
    { id: 'composer-submit-button' },
    { 'aria-label': 'Send prompt' },
    { 'aria-label': 'Send message' },
  ];
  for (const attrs of variants) {
    const p = spanishPage(attrs);
    const result = await submit(p);
    assert.equal(result.outcome, 'submitted', JSON.stringify(attrs));
    assert.deepEqual(p.sent, [PROMPT]);
  }
});

test('the language-independent attribute is preferred over a label when both exist', () => {
  const p = spanishPage({ 'data-testid': 'send-button', 'aria-label': 'Enviar', type: 'submit' });
  assert.equal(findSendButton(p.doc, DEFAULT_SELECTORS.sendControl, p.composer as never)?.selector, 'button[data-testid="send-button"]');
});

test('the Spanish stop label still means generating', () => {
  const p = spanishPage();
  p.form.append(new Node('button', { 'aria-label': 'Detener' }));
  assert.equal(observePage(p.doc as never, URL_A, DEFAULT_SELECTORS).status, 'generating');
});

test('localized labels are well-formed, sourced and all reach the selector lists', () => {
  for (const [lang, entry] of Object.entries(LOCALIZED_LABELS)) {
    assert.ok(entry.source.length > 0, `${lang} has no source`);
    for (const label of [...entry.send, ...entry.stop]) {
      assert.ok(label.trim() === label && label.length > 0, `${lang}: "${label}"`);
      assert.ok(!/["\\]/.test(label), `${lang}: "${label}" would break the selector`);
    }
    for (const label of entry.send) assert.ok(DEFAULT_SELECTORS.sendControl.includes(`button[aria-label="${label}"]`));
    for (const label of entry.stop) assert.ok(DEFAULT_SELECTORS.stopControl.includes(`button[aria-label="${label}"]`));
  }
  const all = Object.values(LOCALIZED_LABELS).flatMap((e) => e.send);
  assert.equal(new Set(all).size, all.length, 'no label listed twice');
});

test('a diagnostic of the old failure would now show the button as matched', () => {
  const p = spanishPage();
  p.composer.innerText = PROMPT;
  const d = collectSendDiagnostic(p.doc, DEFAULT_SELECTORS, p.composer as never, PROMPT, 'waiting_for_send_button', 100, null);
  assert.equal(d.sendSelectors.find((s) => s.selector === 'button[aria-label="Enviar"]')?.total, 1);
  assert.equal(d.nearbyButtons[0]?.attributes['aria-label'], 'Enviar');
});

test('with the previous send selectors, this page reproduces the reported live failure', async () => {
  const previous = { ...DEFAULT_SELECTORS, sendControl: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]'] };
  const p = spanishPage();
  const seen: SendDiagnostic[] = [];
  let clock = 0;
  const result = await submitContinuation(p.doc, () => URL_A, previous, { text: PROMPT, expectedPath: '/c/abc', expectedKey: KEY }, {
    sendReadyMs: 3000, confirmMs: 3000, pollMs: 100, lateMarginMs: 2000,
    sleep: async (ms) => { clock += ms; }, now: () => clock, diagnose: (d) => seen.push(d),
  });
  assert.deepEqual(result, { outcome: 'not_submitted', reason: 'send_unavailable', detail: 'the send button did not become available' });
  const failed = seen.find((d) => d.stage === 'send_button_unavailable')!;
  // Exactly what the owner's diagnostics showed.
  assert.equal(failed.composer?.holdsPrompt, true);
  assert.equal(failed.composer?.proseMirror, true);
  assert.equal(failed.insertion?.execCommandReturned, true);
  assert.ok(failed.sendSelectors.every((s) => s.total === 0));
  assert.deepEqual(p.sent, []);
});
