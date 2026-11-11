import test from 'node:test';
import assert from 'node:assert/strict';
import type { UiSnapshot } from '../src/shared/messages.ts';
import { initialSession } from '../src/shared/session.ts';
import { announcement, buildView, FOCUS_NEXT, formatRemaining } from '../src/ui/viewModel.ts';
import { testSettings } from './helpers/fixtures.ts';

const tab = { tabId: 1, title: 'Build the app', conversation: '/c/abc' };
function snap(session: Partial<UiSnapshot['session']>, extra: Partial<UiSnapshot> = {}): UiSnapshot {
  return { settings: testSettings({ maxCycles: 10 }), session: { ...initialSession(), ...session }, sessionTab: null, activeTab: tab, activeTabConnected: true, page: null, gettingStarted: false, now: 1000, ...extra };
}

test('each state maps to its label and controls', () => {
  const stopped = buildView(snap({}), 1000);
  assert.equal(stopped.statusLabel, 'Stopped');
  assert.ok(stopped.canStart && !stopped.canPause && !stopped.canStop);
  const watching = buildView(snap({ run: 'running', phase: 'watching' }, { sessionTab: tab }), 1000);
  assert.equal(watching.statusLabel, 'Waiting for ChatGPT');
  assert.ok(watching.canPause && watching.canStop && !watching.canResume && !watching.canStart);
  assert.equal(buildView(snap({ run: 'running', phase: 'delay', dueAt: 6000, pendingKey: 'k' }), 1000).statusLabel, 'Continuation in 5s', 'the countdown is part of the status');
  assert.equal(buildView(snap({ run: 'running', phase: 'delay', dueAt: null, pendingKey: 'k' }), 1000).statusLabel, 'Continuation in …');
  assert.equal(buildView(snap({ run: 'running', phase: 'submitting', pendingKey: 'k' }), 1000).statusLabel, 'Running');
  const paused = buildView(snap({ run: 'paused', reason: 'composer_has_text' }), 1000);
  assert.ok(paused.canResume && paused.canStop && !paused.canPause);
  assert.match(paused.detail, /message box already contained text/);
  const error = buildView(snap({ run: 'error', reason: 'usage_limit', detail: 'nothing is sent until you press Resume' }), 1000);
  assert.equal(error.statusLabel, 'Stopped by an error');
  assert.match(error.lastError, /^ChatGPT shows a usage limit: nothing is sent until you press Resume\.$/);
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

test('C-4: an unconnected ChatGPT tab shows the reload hint and Start is unavailable', () => {
  const unconnected = buildView(snap({}, { activeTabConnected: false }), 1000);
  assert.equal(unconnected.canStart, false);
  assert.equal(unconnected.startHint, 'Reload this ChatGPT tab so Autopilot can connect to it, then press Start.');
  const connected = buildView(snap({}, { activeTabConnected: true }), 1000);
  assert.ok(connected.canStart && connected.startHint === null);
  const noTab = buildView(snap({}, { activeTab: null, activeTabConnected: null }), 1000);
  assert.match(noTab.startHint ?? '', /^Open a ChatGPT conversation/);
  assert.equal(buildView(snap({ run: 'running' }, { activeTabConnected: false }), 1000).startHint, null, 'no hint while running');
});

test('C-7: only a change of status, reason or guidance is announced, never the countdown', () => {
  const at = (now: number, over: Parameters<typeof snap>[0]) => {
    const s = snap(over);
    return announcement(buildView(s, now), s.session);
  };
  const delay = { run: 'running' as const, phase: 'delay' as const, dueAt: 20_000, pendingKey: 'k' };
  const first = at(1000, delay);
  const later = at(5000, delay);
  assert.equal(first.key, later.key, 'the countdown ticking is not a change');
  assert.match(first.text, /^Continuation in 19s\. The answer is finished\./);
  const paused = at(1000, { run: 'paused', reason: 'composer_has_text' });
  assert.notEqual(paused.key, first.key);
  assert.equal(paused.text, 'Paused. The message box already contained text. Fix first: Send or clear your text, then press Resume. Your text was not changed.');
  assert.notEqual(at(1000, { run: 'paused', reason: 'user' }).key, paused.key, 'another reason is a change');
});

test('C-7: after a control action, focus moves to the control that replaces it', () => {
  assert.deepEqual(FOCUS_NEXT['btn-start'], ['btn-pause', 'btn-stop']);
  assert.deepEqual(FOCUS_NEXT['btn-pause'], ['btn-resume', 'btn-stop']);
  assert.deepEqual(FOCUS_NEXT['btn-resume'], ['btn-pause', 'btn-stop']);
  assert.deepEqual(FOCUS_NEXT['btn-stop'], ['btn-start']);
});
