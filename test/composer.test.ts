// The send step in the tab, against a small fake DOM (a textarea composer and a
// send button). Covers the window between typing the prompt and clicking send,
// and what is cleaned up afterwards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { submitContinuation, type SubmitRequest, type SubmitResult } from '../src/content/composer.ts';
import type { SendDiagnostic } from '../src/content/sendDiagnostics.ts';
import { DEFAULT_SELECTORS } from '../src/content/selectors.ts';

const PROMPT = 'Continue working on the project.';
const URL_A = 'https://chatgpt.com/c/abc';

interface FakeBox { tagName: 'TEXTAREA'; value: string; disabled: boolean; textContent: string; focus(): void; dispatchEvent(): boolean; getAttribute(n: string): string | null; closest(): null; checkVisibility(): boolean }

function box(value = ''): FakeBox {
  return { tagName: 'TEXTAREA', value, disabled: false, textContent: '', focus() {}, dispatchEvent: () => true, getAttribute: () => null, closest: () => null, checkVisibility: () => true };
}

function page() {
  const state = {
    url: URL_A,
    composer: box() as FakeBox | null,
    sendUsable: true,
    generating: false,
    userMessages: 1,
    assistantIds: ['m1'],
    clicks: 0,
    /** What a click does; default: sends the box's text. */
    onClick: () => {
      state.clicks += 1;
      if (state.composer && state.composer.value.trim()) {
        state.composer.value = '';
        state.userMessages += 1;
        state.generating = true;
      }
    },
  };
  const el = (attrs: Record<string, string> = {}, extra: object = {}) => ({
    tagName: 'BUTTON', textContent: '', getAttribute: (n: string) => attrs[n] ?? null, closest: () => null, checkVisibility: () => true, ...extra,
  });
  const doc = {
    querySelectorAll(selector: string) {
      if (selector === DEFAULT_SELECTORS.composer[0]) return state.composer ? [state.composer] : [];
      if (selector === DEFAULT_SELECTORS.sendControl[0]) {
        return [el(state.sendUsable ? {} : { 'aria-disabled': 'true' }, { disabled: !state.sendUsable, click: () => state.onClick() })];
      }
      if (selector === DEFAULT_SELECTORS.stopControl[0]) return state.generating ? [el()] : [];
      if (selector === '[data-message-author-role="assistant"]') return state.assistantIds.map((id) => el({ 'data-message-id': id }));
      if (selector === '[data-message-author-role="user"]') return Array.from({ length: state.userMessages }, () => el());
      return [];
    },
  };
  return { state, doc: doc as unknown as Document };
}

const request: SubmitRequest = { text: PROMPT, expectedPath: '/c/abc', expectedKey: '/c/abc|id:m1' };

/** Runs a submission; `duringWait(poll)` may change the page while the prompt waits for the send button. */
function run(p: ReturnType<typeof page>, duringWait?: (poll: number) => void, sendReadyMs = 300): Promise<SubmitResult> {
  let polls = 0;
  let clock = 0;
  return submitContinuation(p.doc, () => p.state.url, DEFAULT_SELECTORS, request, {
    sendReadyMs, confirmMs: 300, pollMs: 100, lateMarginMs: 2000,
    sleep: async (ms) => { clock += ms; polls += 1; duringWait?.(polls); },
    now: () => clock,
  });
}

test('the normal case: typed, clicked once, confirmed', async () => {
  const p = page();
  const result = await run(p);
  assert.deepEqual(result, { outcome: 'submitted', sawGenerating: true });
  assert.equal(p.state.clicks, 1);
  assert.equal(p.state.composer!.value, '');
});

test('text you add while the prompt waits for the send button is never sent or removed', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await run(p, (poll) => {
    if (poll === 1) { p.state.composer!.value = PROMPT + ' and my note'; p.state.sendUsable = true; }
  });
  assert.deepEqual(result, { outcome: 'refused', reason: 'composer_has_text' });
  assert.equal(p.state.clicks, 0, 'send was not clicked');
  assert.equal(p.state.composer!.value, PROMPT + ' and my note', 'the box is untouched');
});

test('when the send button never becomes available, your text typed meanwhile is not deleted', async () => {
  const p = page();
  p.state.sendUsable = false;
  // You type on the last poll, after the per-poll check but before giving up.
  let checks = 0;
  const realBox = p.state.composer!;
  Object.defineProperty(realBox, 'value', {
    get() { checks += 1; return checks > 6 ? PROMPT + ' mine' : (this as { _v?: string })._v ?? ''; },
    set(v: string) { (this as { _v?: string })._v = v; },
    configurable: true,
  });
  const result = await run(p);
  assert.equal(p.state.clicks, 0);
  assert.equal(realBox.value, PROMPT + ' mine', 'not cleared');
  assert.ok(result.outcome === 'refused' || result.outcome === 'not_submitted');
  if (result.outcome === 'refused') assert.equal(result.reason, 'composer_has_text');
});

test('when the send button never becomes available, the untouched prompt is removed again', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await run(p);
  assert.equal(result.outcome, 'not_submitted');
  assert.equal(p.state.clicks, 0);
  assert.equal(p.state.composer!.value, '');
});

test('switching conversation while the prompt waits: nothing is clicked and the prompt is removed', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await run(p, (poll) => {
    if (poll === 1) { p.state.url = 'https://chatgpt.com/c/other'; p.state.sendUsable = true; }
  });
  assert.deepEqual(result, { outcome: 'refused', reason: 'conversation_changed' });
  assert.equal(p.state.clicks, 0);
  assert.equal(p.state.composer!.value, '');
});

test('ChatGPT starting to generate while the prompt waits: nothing is clicked', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await run(p, (poll) => {
    if (poll === 1) { p.state.generating = true; p.state.sendUsable = true; }
  });
  assert.deepEqual(result, { outcome: 'refused', reason: 'generating' });
  assert.equal(p.state.clicks, 0);
  assert.equal(p.state.composer!.value, '');
});

test('the prompt vanishing from the box before the click (Enter pressed) is uncertain, never retried', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await run(p, (poll) => {
    if (poll === 1) { p.state.composer!.value = ''; p.state.userMessages += 1; p.state.sendUsable = true; }
  });
  assert.equal(result.outcome, 'uncertain');
  assert.equal(p.state.clicks, 0);
});

test('a re-rendered message box: the prompt carried over is removed and nothing is clicked', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await run(p, (poll) => {
    if (poll === 1) { p.state.composer = box(PROMPT); p.state.sendUsable = true; }
  });
  assert.deepEqual(result, { outcome: 'refused', reason: 'not_complete' });
  assert.equal(p.state.clicks, 0);
  assert.equal(p.state.composer!.value, '');
});

test('a re-rendered message box that is empty is uncertain; one with your text is left alone', async () => {
  const empty = page();
  empty.state.sendUsable = false;
  const r1 = await run(empty, (poll) => { if (poll === 1) { empty.state.composer = box(''); empty.state.sendUsable = true; } });
  assert.equal(r1.outcome, 'uncertain');
  assert.equal(empty.state.clicks, 0);

  const yours = page();
  yours.state.sendUsable = false;
  const r2 = await run(yours, (poll) => { if (poll === 1) { yours.state.composer = box('my draft'); yours.state.sendUsable = true; } });
  assert.deepEqual(r2, { outcome: 'refused', reason: 'composer_has_text' });
  assert.equal(yours.state.composer!.value, 'my draft');
});

test('a click that does not send: the prompt is removed, unless you typed into the box meanwhile', async () => {
  const p = page();
  p.state.onClick = () => { p.state.clicks += 1; };
  const r1 = await run(p);
  assert.equal(r1.outcome, 'not_submitted');
  assert.equal(p.state.clicks, 1, 'clicked once, never again');
  assert.equal(p.state.composer!.value, '');

  const q = page();
  q.state.onClick = () => { q.state.clicks += 1; q.state.composer!.value = 'typed after the click'; };
  const r2 = await run(q);
  assert.equal(r2.outcome, 'uncertain');
  assert.equal(q.state.composer!.value, 'typed after the click');
});

// --- After the click ---

test('more user messages appearing while the prompt is still in the box is not taken as sent', async () => {
  const p = page();
  // The click does nothing, but older messages load in (or the thread re-renders) meanwhile.
  p.state.onClick = () => { p.state.clicks += 1; p.state.userMessages += 3; };
  const result = await run(p);
  assert.equal(result.outcome, 'not_submitted', 'the prompt never left the box');
  assert.equal(p.state.clicks, 1);
  assert.equal(p.state.composer!.value, '');
});

test('a send that clears the box a moment after the click is still confirmed', async () => {
  const p = page();
  let polls = 0;
  let clock = 0;
  p.state.onClick = () => { p.state.clicks += 1; p.state.userMessages += 1; };
  const result = await submitContinuation(p.doc, () => p.state.url, DEFAULT_SELECTORS, request, {
    sendReadyMs: 300, confirmMs: 1000, pollMs: 100, lateMarginMs: 2000,
    sleep: async (ms) => { clock += ms; polls += 1; if (polls === 3) p.state.composer!.value = ''; },
    now: () => clock,
  });
  assert.equal(result.outcome, 'submitted');
  assert.equal(p.state.clicks, 1);
});

test('generation starting while the prompt is still in the box is not taken as sent', async () => {
  const p = page();
  p.state.onClick = () => { p.state.clicks += 1; p.state.generating = true; };
  const result = await run(p);
  assert.notEqual(result.outcome, 'submitted');
  assert.equal(p.state.clicks, 1);
});

// --- Hidden, throttled or frozen tabs (T4) ---

/** A clock where each sleep takes `sleepTakesMs` of wall time, as when Chrome throttles or freezes the tab. */
function slowRun(p: ReturnType<typeof page>, sleepTakesMs: (poll: number) => number, confirmMs = 10_000): Promise<SubmitResult> {
  let clock = 0;
  let polls = 0;
  return submitContinuation(p.doc, () => p.state.url, DEFAULT_SELECTORS, request, {
    sendReadyMs: 3000, confirmMs, pollMs: 100, lateMarginMs: 2000,
    sleep: async () => { polls += 1; clock += sleepTakesMs(polls); },
    now: () => clock,
  });
}

test('a tab frozen while the prompt waits for the send button never clicks after it wakes up', async () => {
  const p = page();
  p.state.sendUsable = false;
  // Frozen for 15 s on the first wait; when it wakes, the button is ready.
  const result = await slowRun(p, (poll) => { if (poll === 1) p.state.sendUsable = true; return poll === 1 ? 15_000 : 100; });
  assert.equal(result.outcome, 'not_submitted');
  assert.equal(result.outcome === 'not_submitted' && result.reason, 'tab_suspended');
  assert.equal(p.state.clicks, 0, 'no late click');
  assert.equal(p.state.composer!.value, '', 'the prompt is removed');
});

test('under heavy timer throttling the waits end by wall-clock time, not after a fixed number of polls', async () => {
  const p = page();
  p.state.sendUsable = false;
  let sleeps = 0;
  // Hidden-tab intensive throttling: each timer fires about a minute late.
  const result = await slowRun(p, () => { sleeps += 1; return 60_000; });
  assert.equal(sleeps, 1, 'one late timer is enough to stop, instead of 30 minute-long polls');
  assert.equal(result.outcome, 'not_submitted');
  assert.equal(p.state.clicks, 0);
});

test('the confirmation after the click ends by wall-clock time too', async () => {
  const p = page();
  p.state.onClick = () => { p.state.clicks += 1; };
  let sleeps = 0;
  const result = await slowRun(p, () => { sleeps += 1; return 60_000; });
  assert.equal(p.state.clicks, 1);
  assert.equal(sleeps, 1, 'not 100 polls of a minute each');
  assert.equal(result.outcome, 'not_submitted');
});

test('your text typed while the frozen tab slept is kept when the late attempt is dropped', async () => {
  const p = page();
  p.state.sendUsable = false;
  const result = await slowRun(p, (poll) => { if (poll === 1) p.state.composer!.value = PROMPT + ' plus mine'; return 15_000; });
  assert.deepEqual(result, { outcome: 'refused', reason: 'composer_has_text' });
  assert.equal(p.state.composer!.value, PROMPT + ' plus mine');
  assert.equal(p.state.clicks, 0);
});

// --- Send-step diagnostics (opt-in) ---

function runWithDiagnostics(p: ReturnType<typeof page>, diagnose: (d: SendDiagnostic) => void, duringWait?: (poll: number) => void): Promise<SubmitResult> {
  let clock = 0;
  let polls = 0;
  return submitContinuation(p.doc, () => p.state.url, DEFAULT_SELECTORS, request, {
    sendReadyMs: 300, confirmMs: 300, pollMs: 100, lateMarginMs: 2000,
    sleep: async (ms) => { clock += ms; polls += 1; duringWait?.(polls); },
    now: () => clock,
    diagnose,
  });
}

test('with diagnostics on, a send button that never becomes usable is described at each stage, without the prompt', async () => {
  const p = page();
  p.state.sendUsable = false;
  const seen: SendDiagnostic[] = [];
  const result = await runWithDiagnostics(p, (d) => seen.push(d));
  assert.equal(result.outcome, 'not_submitted');
  const stages = seen.map((d) => d.stage);
  assert.equal(stages[0], 'typed');
  assert.ok(stages.includes('waiting_for_send_button'));
  assert.equal(stages.at(-1), 'send_button_unavailable');
  const last = seen.at(-1)!;
  assert.equal(last.insertion?.method, 'textarea');
  assert.equal(last.composer?.holdsPrompt, true, 'described before the prompt is removed');
  assert.equal(last.chosen?.selector, DEFAULT_SELECTORS.sendControl[0]);
  assert.equal(last.chosen?.usable, false);
  assert.equal(last.chosen?.inComposerForm, false, 'the fake textarea is not in a form');
  assert.ok(!JSON.stringify(seen).includes(PROMPT));
});

test('diagnostics never change the outcome, even when they fail', async () => {
  const plain = page();
  const r1 = await run(plain);
  const traced = page();
  const r2 = await runWithDiagnostics(traced, () => { throw new Error('diagnostics broke'); });
  assert.deepEqual(r2, r1);
  assert.equal(traced.state.clicks, 1);
});
