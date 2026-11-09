import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSendDiagnostic } from '../src/content/sendDiagnostics.ts';
import { DEFAULT_SELECTORS } from '../src/content/selectors.ts';

const PROMPT = 'SECRET-PROMPT continue working';

interface Spec { tag: string; attrs?: Record<string, string>; disabled?: boolean; visible?: boolean; text?: string; value?: string; classes?: string[]; children?: FakeEl[] }
interface FakeEl { contains?(other: unknown): boolean; tagName: string; disabled?: boolean; value?: string; innerText: string; textContent: string; classList: { contains(c: string): boolean }; getAttribute(n: string): string | null; checkVisibility(): boolean; closest(sel: string): FakeEl | null; querySelectorAll(sel: string): FakeEl[]; parentElement: FakeEl | null }

function el(spec: Spec): FakeEl {
  const node: FakeEl = {
    tagName: spec.tag.toUpperCase(),
    disabled: spec.disabled,
    value: spec.value,
    innerText: spec.text ?? '',
    textContent: spec.text ?? '',
    classList: { contains: (c) => (spec.classes ?? []).includes(c) },
    getAttribute: (n) => spec.attrs?.[n] ?? null,
    checkVisibility: () => spec.visible !== false,
    closest: () => null,
    querySelectorAll: (sel) => (sel === 'button' ? (spec.children ?? []).filter((c) => c.tagName === 'BUTTON') : sel === 'p' ? (spec.children ?? []).filter((c) => c.tagName === 'P') : []),
    parentElement: null,
  };
  return node;
}

function setup(opts: { sendDisabled: boolean; extraHiddenSend?: boolean; hiddenTextareaValue?: string }) {
  const send = el({ tag: 'button', attrs: { 'data-testid': 'send-button', id: 'composer-submit-button', 'aria-label': 'Send prompt', title: 'SECRET-TITLE' }, disabled: opts.sendDisabled, text: 'SECRET-BUTTON-TEXT' });
  const speech = el({ tag: 'button', attrs: { 'data-testid': 'composer-speech-button', 'aria-label': 'Start voice mode' } });
  const stale = el({ tag: 'button', attrs: { 'data-testid': 'send-button' }, disabled: true, visible: false });
  const composer = el({ tag: 'div', attrs: { id: 'prompt-textarea', contenteditable: 'true' }, classes: ['ProseMirror'], text: PROMPT, children: [el({ tag: 'p', text: PROMPT })] });
  const form = el({ tag: 'form', children: [send, speech] });
  form.contains = (other) => other === send || other === speech || other === composer;
  composer.closest = (sel) => (sel === 'form' ? form : null);
  const hidden = opts.hiddenTextareaValue === undefined ? [] : [el({ tag: 'textarea', value: opts.hiddenTextareaValue, attrs: { name: 'prompt-textarea' } })];
  const doc = {
    activeElement: composer,
    querySelectorAll(sel: string) {
      if (sel === 'button[data-testid="send-button"]') return opts.extraHiddenSend ? [stale, send] : [send];
      if (sel === '#composer-submit-button') return [send];
      if (sel === 'textarea[name="prompt-textarea"]') return hidden;
      return [];
    },
  };
  return { doc: doc as unknown as Document, composer: composer as unknown as Element };
}

test('a send diagnostic never contains the prompt, the box text, button text or titles', () => {
  const { doc, composer } = setup({ sendDisabled: true, hiddenTextareaValue: PROMPT });
  const d = collectSendDiagnostic(doc, DEFAULT_SELECTORS, composer, PROMPT, 'waiting_for_send_button', 1200, { method: 'execCommand', execCommandReturned: true });
  const json = JSON.stringify(d);
  assert.ok(!json.includes('SECRET'), json);
});

test('it shows what each send selector matches, which button would be used, and whether it is usable', () => {
  const { doc, composer } = setup({ sendDisabled: true, extraHiddenSend: true });
  const d = collectSendDiagnostic(doc, DEFAULT_SELECTORS, composer, PROMPT, 'send_button_unavailable', 3000, null);
  const first = d.sendSelectors[0]!;
  assert.equal(first.selector, 'button[data-testid="send-button"]');
  assert.equal(first.total, 2);
  assert.deepEqual(first.matches.map((m) => [m.visible, m.disabled]), [[false, true], [true, true]]);
  assert.deepEqual(d.chosen, { selector: 'button[data-testid="send-button"]', index: 1, usable: false, inComposerForm: true });
  assert.equal(d.sendSelectors[2]!.total, 0, 'aria-label selectors that match nothing are shown as such');
  assert.deepEqual(d.nearbyButtons.map((b) => b.attributes['data-testid']), ['send-button', 'composer-speech-button']);
  assert.equal(d.nearbyButtons[1]!.attributes['aria-label'], 'Start voice mode');
});

test('it describes the message box and whether the page\'s hidden textarea saw the prompt', () => {
  const synced = setup({ sendDisabled: false, hiddenTextareaValue: PROMPT });
  const a = collectSendDiagnostic(synced.doc, DEFAULT_SELECTORS, synced.composer, PROMPT, 'typed', 0, { method: 'execCommand', execCommandReturned: true });
  assert.equal(a.composer!.proseMirror, true);
  assert.equal(a.composer!.holdsPrompt, true);
  assert.equal(a.composer!.textLength, PROMPT.length);
  assert.equal(a.composer!.focused, true);
  assert.equal(a.composer!.paragraphs, 1);
  assert.deepEqual(a.composer!.hiddenTextarea, { found: true, valueLength: PROMPT.length, holdsPrompt: true });
  assert.deepEqual(a.chosen, { selector: 'button[data-testid="send-button"]', index: 0, usable: true, inComposerForm: true });

  const stale = setup({ sendDisabled: true, hiddenTextareaValue: '' });
  const b = collectSendDiagnostic(stale.doc, DEFAULT_SELECTORS, stale.composer, PROMPT, 'typed', 0, null);
  assert.deepEqual(b.composer!.hiddenTextarea, { found: true, valueLength: 0, holdsPrompt: false });
});

test('the console probe in docs/ uses the same send and composer selectors as the extension', async () => {
  const { readFile } = await import('node:fs/promises');
  const probe = await readFile(new URL('../docs/send-probe.js', import.meta.url), 'utf8');
  // The lists are plain array literals of string literals: evaluate just that literal.
  const list = (name: string) => new Function(`return ${probe.match(new RegExp(`^\\s*const ${name} = (\\[.*\\]);\\s*$`, 'm'))![1]}`)() as string[];
  assert.deepEqual(list('SEND'), DEFAULT_SELECTORS.sendControl);
  assert.deepEqual(list('COMPOSER'), DEFAULT_SELECTORS.composer);
});

test('the answer-structure probe in docs/ finds the latest answer with the same selectors as the extension', async () => {
  const { readFile } = await import('node:fs/promises');
  const probe = await readFile(new URL('../docs/answer-structure-probe.js', import.meta.url), 'utf8');
  const list = new Function(`return ${probe.match(/^\s*const ASSISTANT = (\[.*\]);\s*$/m)![1]}`)() as string[];
  assert.deepEqual(list, DEFAULT_SELECTORS.assistantMessage);
});
