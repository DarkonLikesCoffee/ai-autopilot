import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../src/content/detector.ts';
import type { PageObservation } from '../src/shared/types.ts';
import { FakeTimers, obs } from './helpers/fixtures.ts';

function setup(settleMs = 1000) {
  const timers = new FakeTimers();
  let page: PageObservation = obs('idle');
  const emitted: PageObservation[] = [];
  const detector = createDetector({ read: () => page, emit: (o) => emitted.push(o), timers, settleMs, coalesceMs: 100 });
  return { timers, detector, emitted, set: (o: PageObservation) => { page = o; } };
}

const statuses = (list: PageObservation[]) => list.map((o) => o.status);

test('reports the first state and only changes afterwards', () => {
  const { detector, emitted, set } = setup();
  detector.evaluate();
  detector.evaluate();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  detector.evaluate();
  assert.deepEqual(statuses(emitted), ['idle', 'generating']);
});

test('the end of generation is reported only after the page stays finished', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  assert.deepEqual(statuses(emitted), ['generating'], 'not reported yet');
  timers.advance(999);
  assert.deepEqual(statuses(emitted), ['generating']);
  timers.advance(1);
  assert.deepEqual(statuses(emitted), ['generating', 'complete']);
});

test('a brief gap in streaming does not produce a completion', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  timers.advance(500);
  set(obs('generating', 'k|1'));
  detector.evaluate();
  timers.advance(5000);
  assert.deepEqual(statuses(emitted), ['generating']);
});

test('the settle timer reports a fresh read, not the stale one', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  set(obs('error', 'k|1'));
  timers.advance(1000);
  assert.deepEqual(statuses(emitted), ['generating', 'error']);
});

test('usage-limit notices are reported immediately', () => {
  const { detector, emitted, set } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('usage_limit', 'k|1'));
  detector.evaluate();
  assert.deepEqual(statuses(emitted), ['generating', 'usage_limit']);
});

test('navigation to another conversation is reported without waiting', () => {
  const { detector, emitted, set } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', '/c/other|id:1', 'https://chatgpt.com/c/other'));
  detector.evaluate();
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1]!.url, 'https://chatgpt.com/c/other');
});

test('bursts of mutations are coalesced into one read', () => {
  const timers = new FakeTimers();
  let reads = 0;
  const detector = createDetector({ read: () => { reads += 1; return obs('idle'); }, emit: () => {}, timers, coalesceMs: 100 });
  for (let i = 0; i < 50; i += 1) detector.schedule();
  timers.advance(100);
  assert.equal(reads, 1);
});

test('reset makes the next evaluation report again; dispose stops everything', () => {
  const { detector, emitted, set, timers } = setup();
  detector.evaluate();
  detector.resetReported();
  detector.evaluate();
  assert.equal(emitted.length, 2);
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  detector.dispose();
  timers.advance(5000);
  detector.schedule();
  timers.advance(5000);
  assert.equal(emitted.length, 3);
  assert.equal(timers.size, 0);
});

// --- T2 edge cases ---

test('a DOM replacement during the confirmation window (page briefly unrecognizable) gives one completion, after the window', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  timers.advance(300);
  set(obs('unknown', null));
  detector.evaluate();
  timers.advance(300);
  set(obs('complete', 'k|1'));
  detector.evaluate();
  timers.advance(399);
  assert.deepEqual(statuses(emitted), ['generating']);
  timers.advance(1);
  assert.deepEqual(statuses(emitted), ['generating', 'complete']);
  timers.advance(10_000);
  assert.equal(emitted.length, 2);
});

test('streaming that resumes after a pause restarts the window; the completion comes a full window after the real end', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  for (let i = 0; i < 3; i += 1) {
    set(obs('complete', 'k|1'));
    detector.evaluate();
    timers.advance(900);
    set(obs('generating', 'k|1'));
    detector.evaluate();
  }
  set(obs('complete', 'k|1'));
  detector.evaluate();
  timers.advance(999);
  assert.deepEqual(statuses(emitted), ['generating']);
  timers.advance(1);
  assert.deepEqual(statuses(emitted), ['generating', 'complete']);
});

test('a response id that changes after the completion was reported is reported again', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|tmp'));
  detector.evaluate();
  set(obs('complete', 'k|tmp'));
  detector.evaluate();
  timers.advance(1000);
  set(obs('complete', 'k|final'));
  detector.evaluate();
  assert.deepEqual(emitted.map((o) => o.responseKey), ['k|tmp', 'k|tmp', 'k|final']);
});

test('the completion carries the key the page shows when the window ends', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|tmp'));
  detector.evaluate();
  set(obs('complete', 'k|tmp'));
  detector.evaluate();
  set(obs('complete', 'k|final'));
  timers.advance(1000);
  assert.deepEqual(emitted.map((o) => o.responseKey), ['k|tmp', 'k|final']);
});

test('navigating away and back while the window is open does not skip the window for the original conversation', () => {
  const { detector, emitted, set, timers } = setup();
  set(obs('generating', 'k|1'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  set(obs('complete', '/c/other|id:9', 'https://chatgpt.com/c/other'));
  detector.evaluate();
  set(obs('complete', 'k|1'));
  detector.evaluate();
  // Reported at once (no longer leaving a generation), and only once.
  timers.advance(10_000);
  assert.deepEqual(emitted.map((o) => o.url), [obs('idle').url, 'https://chatgpt.com/c/other', obs('idle').url]);
});
