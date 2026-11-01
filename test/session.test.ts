// Edge rules of the state machine that the controller tests do not reach directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSession, normalizeSession, transition, type SessionEvent } from '../src/shared/session.ts';
import type { SessionState } from '../src/shared/types.ts';
import { obs } from './helpers/fixtures.ts';

const timing = { delaySeconds: 5, maxCycles: 0 };
const K = '/c/abc|id:m1';

function run(state: SessionState, ...events: SessionEvent[]): SessionState {
  return events.reduce((s, e) => transition(s, e).state, state);
}

function inDelay(): SessionState {
  return run(
    initialSession(),
    { type: 'START', tabId: 1, observation: obs('idle'), now: 0 },
    { type: 'OBSERVATION', tabId: 1, observation: obs('generating', K), settings: timing, now: 1 },
    { type: 'OBSERVATION', tabId: 1, observation: obs('complete', K), settings: timing, now: 2 },
  );
}

test('start is refused on a page that cannot be continued', () => {
  const s = initialSession();
  assert.ok(transition(s, { type: 'START', tabId: 1, observation: obs('usage_limit'), now: 0 }).rejected);
  assert.ok(transition(s, { type: 'START', tabId: 1, observation: obs('error', null, undefined, { authRequired: true }), now: 0 }).rejected);
  assert.ok(transition(s, { type: 'START', tabId: 1, observation: obs('unknown', null, undefined, { composerFound: false }), now: 0 }).rejected);
});

test('the attempt is recorded before sending, and a recorded response is never attempted again', () => {
  let s = inDelay();
  assert.equal(s.phase, 'delay');
  assert.deepEqual(transition(s, { type: 'DUE', now: 4000 }).effects, [], 'not due yet');
  assert.deepEqual(transition(s, { type: 'DUE', now: 5002 }).effects, [{ type: 'attempt', key: K }]);
  s = run(s, { type: 'SUBMIT_BEGIN', key: K, now: 5003 });
  assert.equal(s.phase, 'submitting');
  assert.deepEqual(s.answeredKeys, [K]);
  assert.ok(transition(s, { type: 'SUBMIT_BEGIN', key: K, now: 5004 }).rejected, 'no second attempt');
});

test('a refusal while stopped or paused never revives the session', () => {
  const s = run(inDelay(), { type: 'SUBMIT_BEGIN', key: K, now: 5003 }, { type: 'STOP', now: 5004 });
  const after = run(s, { type: 'SUBMIT_REFUSED', key: K, reason: 'composer_has_text', now: 5005 });
  assert.equal(after.run, 'stopped');
  assert.equal(after.phase, 'watching');
});

test('a successful result that arrives after a pause still counts the continuation', () => {
  const s = run(inDelay(), { type: 'SUBMIT_BEGIN', key: K, now: 5003 }, { type: 'PAUSE', now: 5004 });
  const after = run(s, { type: 'SUBMIT_RESULT', key: K, outcome: 'submitted', detail: null, sawGenerating: true, now: 5005 });
  assert.equal(after.run, 'paused');
  assert.equal(after.cycles, 1);
});

test('a worker restart re-creates the schedule for a pending delay', () => {
  const s = inDelay();
  assert.deepEqual(transition(s, { type: 'WAKE', now: 100 }).effects, [{ type: 'schedule', dueAt: s.dueAt }]);
});

test('persisted state that does not add up is restored as paused, never as sending', () => {
  const broken = { ...inDelay(), pendingKey: null };
  const restored = normalizeSession(broken);
  assert.equal(restored.run, 'paused');
  assert.equal(restored.phase, 'watching');
  assert.equal(normalizeSession({ ...inDelay(), tabId: null }).run, 'paused');
  assert.equal(normalizeSession('nonsense').run, 'stopped');
});

test('the activity log and answered keys stay bounded', () => {
  let s = run(initialSession(), { type: 'START', tabId: 1, observation: obs('idle'), now: 0 });
  for (let i = 0; i < 300; i++) {
    const key = `/c/abc|id:${i}`;
    s = run(s,
      { type: 'OBSERVATION', tabId: 1, observation: obs('generating', key), settings: { delaySeconds: 0, maxCycles: 0 }, now: i * 10 + 1 },
      { type: 'OBSERVATION', tabId: 1, observation: obs('complete', key), settings: { delaySeconds: 0, maxCycles: 0 }, now: i * 10 + 2 },
      { type: 'SUBMIT_BEGIN', key, now: i * 10 + 3 },
      { type: 'SUBMIT_RESULT', key, outcome: 'submitted', detail: null, sawGenerating: false, now: i * 10 + 4 },
    );
  }
  assert.equal(s.cycles, 300);
  assert.equal(s.answeredKeys.length, 200);
  assert.equal(s.log.length, 40);
});
