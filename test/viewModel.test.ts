import test from 'node:test';
import assert from 'node:assert/strict';
import type { UiSnapshot } from '../src/shared/messages.ts';
import { initialSession } from '../src/shared/session.ts';
import { buildView, formatRemaining } from '../src/ui/viewModel.ts';
import { testSettings } from './helpers/fixtures.ts';

const tab = { tabId: 1, title: 'Build the app', conversation: '/c/abc' };
function snap(session: Partial<UiSnapshot['session']>, extra: Partial<UiSnapshot> = {}): UiSnapshot {
  return { settings: testSettings({ maxCycles: 10 }), session: { ...initialSession(), ...session }, sessionTab: null, activeTab: tab, now: 1000, ...extra };
}

test('each state maps to its label and controls', () => {
  const stopped = buildView(snap({}), 1000);
  assert.equal(stopped.statusLabel, 'Stopped');
  assert.ok(stopped.canStart && !stopped.canPause && !stopped.canStop);
  const watching = buildView(snap({ run: 'running', phase: 'watching' }, { sessionTab: tab }), 1000);
  assert.equal(watching.statusLabel, 'Waiting for ChatGPT');
  assert.ok(watching.canPause && watching.canStop && !watching.canResume && !watching.canStart);
  assert.equal(buildView(snap({ run: 'running', phase: 'delay', dueAt: 6000, pendingKey: 'k' }), 1000).statusLabel, 'Waiting before continuation');
  assert.equal(buildView(snap({ run: 'running', phase: 'submitting', pendingKey: 'k' }), 1000).statusLabel, 'Running');
  const paused = buildView(snap({ run: 'paused', reason: 'composer_has_text' }), 1000);
  assert.ok(paused.canResume && paused.canStop && !paused.canPause);
  assert.match(paused.detail, /message box already contains text/);
  const error = buildView(snap({ run: 'error', reason: 'usage_limit', detail: 'Nothing will be sent until you resume.' }), 1000);
  assert.equal(error.statusLabel, 'Error');
  assert.match(error.lastError, /usage limit: Nothing will be sent/);
});

test('session facts: cycles with limit or ∞, countdown, conversation', () => {
  const view = buildView(snap({ run: 'running', phase: 'delay', dueAt: 8500, pendingKey: 'k', cycles: 3 }, { sessionTab: tab }), 1000);
  assert.equal(view.cycles, '3 / 10');
  assert.equal(view.countdown, '8s');
  assert.equal(view.conversation, 'Build the app');
  const unlimited = buildView({ ...snap({ cycles: 7 }), settings: testSettings({ maxCycles: 0 }) }, 0);
  assert.equal(unlimited.cycles, '7 / ∞');
  assert.equal(formatRemaining(125_000), '2m 05s');
});

test('Start explains what is missing when no ChatGPT tab is active', () => {
  const view = buildView(snap({}, { activeTab: null }), 0);
  assert.equal(view.canStart, false);
  assert.match(view.startHint ?? '', /Open a ChatGPT conversation/);
});
