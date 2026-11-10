// M5 C-5: the user-visible texts follow the approved copy review
// (docs/design/m5-copy-review.md): no empty text, no internal codes or terms,
// one final period, and the approved owner edits stay in place.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HALT_GUIDANCE } from '../src/shared/guidance.ts';
import { HALT_LABEL, haltSentence, initialSession, REASON_TEXT } from '../src/shared/session.ts';
import { buildView, GENERATION_TEXT } from '../src/ui/viewModel.ts';
import type { HaltReason, SessionState } from '../src/shared/types.ts';
import type { UiSnapshot } from '../src/shared/messages.ts';
import { defaultSettings } from '../src/shared/settings.ts';

const REASONS = Object.keys(REASON_TEXT) as HaltReason[];

/** Internal codes and terms the copy review keeps out of the UI (they stay in code and the report). */
const INTERNAL: readonly RegExp[] = [
  /\b[a-z]+_[a-z_]+\b/, // snake_case codes such as marker_blocked or tab_suspended
  /composer/i,
  /\bmarker\b/i,
  /\bresponse\b/i,
  /\bplease\b/i,
];

function assertClean(text: string, where: string): void {
  assert.ok(text.trim().length > 0, `${where}: not empty`);
  for (const pattern of INTERNAL) assert.doesNotMatch(text, pattern, `${where}: no internal code or term`);
}

/** The detail strings passed to halts and send results, read from the source. */
function sourceDetails(): { text: string; where: string }[] {
  const found: { text: string; where: string }[] = [];
  for (const file of ['src/content/composer.ts', 'src/background/controller.ts']) {
    for (const m of readFileSync(file, 'utf8').matchAll(/detail: ['`]([^'`]+)['`]/g)) found.push({ text: m[1]!, where: file });
  }
  for (const m of readFileSync('src/shared/session.ts', 'utf8').matchAll(/halt\([^;]*?, now, ['`]([^'`]+)['`]\)/g)) {
    found.push({ text: m[1]!, where: 'src/shared/session.ts' });
  }
  return found;
}

test('C-5: every reason is one clean sentence stem, shown with exactly one final period', () => {
  for (const reason of REASONS) {
    const text = REASON_TEXT[reason];
    assertClean(text, reason);
    assert.ok(!text.endsWith('.'), `${reason}: the final period is added by haltSentence`);
    for (const detail of [null, '', 'the Send button was not available', 'nothing is sent until you press Resume.']) {
      const sentence = haltSentence(reason, detail);
      assert.ok(sentence.endsWith('.') && !sentence.endsWith('..'), `${reason} with ${JSON.stringify(detail)}: one final period`);
      assert.ok(sentence.startsWith(text), reason);
    }
  }
  assert.equal(haltSentence('submit_failed', 'the message box was disabled'), 'The continuation could not be sent: the message box was disabled.');
  assert.equal(haltSentence('tab_closed', null), 'The ChatGPT tab was closed.');
});

test('C-5: every guidance line is clean and ends with a period', () => {
  for (const reason of REASONS) {
    const { action } = HALT_GUIDANCE[reason];
    assertClean(action, `guidance ${reason}`);
    assert.ok(action.endsWith('.'), `guidance ${reason}: final period`);
  }
});

test('C-5: every send and halt detail is a clean lower-case clause without a final period', () => {
  const details = sourceDetails();
  assert.ok(details.length >= 15, `the source scan finds the details (found ${details.length})`);
  for (const { text: raw, where } of details) {
    const text = raw.replace(/\$\{[^}]+\}/g, '3');
    assertClean(text, `${where}: "${raw}"`);
    assert.doesNotMatch(text, /\bprompt\b/, `${where}: "${raw}" says continuation, not prompt`);
    assert.match(text, /^[a-z0-9]/, `${where}: "${raw}" follows the reason after a colon`);
    assert.ok(!text.endsWith('.'), `${where}: "${text}" gets its period from haltSentence`);
  }
});

test('C-5 owner edits: Running kept, Stopped by an error, Continuation in …, the safety clause, one override wording', () => {
  const snap = (over: Partial<SessionState>): UiSnapshot => ({
    session: { ...initialSession(), ...over },
    settings: defaultSettings(),
    sessionTab: null,
    activeTab: null,
    now: 1000,
  } as UiSnapshot);
  // 1. Running is kept.
  assert.equal(buildView(snap({ run: 'running', phase: 'submitting', pendingKey: 'k' }), 1000).statusLabel, 'Running');
  // 2. Stopped by an error: status, log line and notification title.
  assert.equal(buildView(snap({ run: 'error', reason: 'tab_unreachable' }), 1000).statusLabel, 'Stopped by an error');
  assert.equal(HALT_LABEL.error, 'Stopped by an error');
  // 3. Continuation in …, with the countdown.
  assert.equal(buildView(snap({ run: 'running', phase: 'delay', pendingKey: 'k', dueAt: 13_000 }), 1000).statusLabel, 'Continuation in 12s');
  // 4. The unrecognized notice says that nothing was sent.
  assert.match(haltSentence('unrecognized_notice', null), /Nothing was sent\.$/);
  // 6. Resume's one-time override is explained the same way for both status-line pauses.
  for (const reason of ['marker_blocked', 'marker_unclear'] as const) {
    const { action } = HALT_GUIDANCE[reason];
    assert.match(action, /press Resume[^.;]* to send the continuation to this answer once/i, reason);
    assert.match(action, /Later answers are checked again\.$/, reason);
  }
  assert.doesNotMatch(HALT_GUIDANCE.marker_blocked.action, /or send it a message yourself/, 'sending a message does not resume Autopilot');
});

test('C-5: panel details and the ChatGPT field use the approved terms', () => {
  for (const text of Object.values(GENERATION_TEXT)) assertClean(text, `ChatGPT field "${text}"`);
  const base = { settings: defaultSettings(), sessionTab: null, activeTab: null, now: 1000 };
  const states: Partial<SessionState>[] = [
    { run: 'stopped' },
    { run: 'running', phase: 'watching' },
    { run: 'running', phase: 'watching', generationSeen: true },
    { run: 'running', phase: 'delay', pendingKey: 'k', dueAt: 5000 },
    { run: 'running', phase: 'submitting', pendingKey: 'k' },
    { run: 'paused', reason: 'user' },
    ...REASONS.map((reason) => ({ run: 'paused' as const, reason })),
  ];
  for (const over of states) {
    const view = buildView({ ...base, session: { ...initialSession(), ...over } } as UiSnapshot, 1000);
    assertClean(view.detail, `detail for ${JSON.stringify(over)}`);
    assert.match(view.detail, /[.…]$/, `detail for ${JSON.stringify(over)}: final period`);
  }
});
