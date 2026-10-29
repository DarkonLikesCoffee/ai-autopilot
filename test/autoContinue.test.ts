// Auto-continue: the state machine schedules, the controller re-checks and sends once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkflowState, normalizeWorkflowState, transition, type TransitionResult, type WorkflowEvent } from '../src/shared/workflow.ts';
import type { ReportedStatus, WorkflowState } from '../src/shared/types.ts';
import { obs } from './helpers/fixtures.ts';

const TAB = 7;
const MAX = 3;
const DELAY = 60_000;

function run(state: WorkflowState, ...events: WorkflowEvent[]): TransitionResult {
  let result: TransitionResult = { state, effects: [] };
  const effects = [];
  for (const event of events) {
    result = transition(result.state, event);
    effects.push(...result.effects);
  }
  return { ...result, effects };
}

const startAuto = (): WorkflowEvent => ({ type: 'START_SESSION', projectId: 'p1', autoContinue: true, autoDelayMs: DELAY, now: 1 });
const handoff = (now = 2, method: 'insert' | 'auto' = 'insert'): WorkflowEvent => ({ type: 'PROMPT_HANDED_OFF', method, tabId: TAB, currentResponseKey: null, maxCycles: MAX, now });
const see = (o: ReturnType<typeof obs>, now = 3): WorkflowEvent => ({ type: 'OBSERVATION', tabId: TAB, observation: o, maxCycles: MAX, now });
const reply = (id: string, status: ReportedStatus | null, now = 10) => [
  see(obs('generating', `/c/abc|id:${id}`), now - 1),
  see(obs('complete', `/c/abc|id:${id}`, undefined, status), now),
];

function waitingAuto(): WorkflowState {
  return run(initialWorkflowState(), startAuto(), handoff()).state;
}

test('a CONTINUE reply schedules the next send instead of asking for review', () => {
  const r = run(waitingAuto(), ...reply('a', 'continue', 100));
  assert.equal(r.state.phase, 'ready');
  assert.equal(r.state.promptPrepared, true);
  assert.equal(r.state.autoSendDueAt, 100 + DELAY);
  assert.equal(r.state.lastReportedStatus, 'continue');
  assert.equal(r.state.lastReviewOutcome, 'continue');
  assert.equal(r.effects.length, 0, 'no per-reply notification in auto mode');
});

for (const [status, reason] of [
  ['milestone_complete', 'milestone_reported'],
  ['blocked', 'blocker_reported'],
  ['missing', 'status_line_missing'],
  [null, 'status_line_missing'],
] as const) {
  test(`a reply with status ${status} stops the session (${reason}) and notifies`, () => {
    const r = run(waitingAuto(), ...reply('a', status));
    assert.equal(r.state.monitoring, 'stopped');
    assert.equal(r.state.stopReason, reason);
    assert.equal(r.state.autoSendDueAt, null);
    assert.deepEqual(r.effects.map((e) => e.kind), ['session_ended']);
  });
}

test('the cycle limit stops auto-continue instead of scheduling another send', () => {
  let s = waitingAuto();
  for (let cycle = 1; cycle < MAX; cycle += 1) {
    s = run(s, ...reply(String(cycle), 'continue', cycle * 100)).state;
    s = run(s, { type: 'AUTO_SEND_BEGIN', now: cycle * 100 + DELAY }, handoff(cycle * 100 + DELAY + 1, 'auto')).state;
  }
  assert.equal(s.cycle, MAX);
  const last = run(s, ...reply('last', 'continue', 10_000_000));
  assert.equal(last.state.stopReason, 'max_cycles_reached');
  assert.equal(last.state.autoSendDueAt, null);
});

test('usage-limit and error messages end an auto session; nothing is resent', () => {
  const limit = run(waitingAuto(), see(obs('usage_limit', null)));
  assert.equal(limit.state.monitoring, 'stopped');
  assert.equal(limit.state.stopReason, 'usage_limit');
  const error = run(waitingAuto(), see(obs('error', null)));
  assert.equal(error.state.stopReason, 'page_error');
  assert.equal(error.effects[0]?.kind, 'session_ended');
});

test('a send can begin only once', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  const first = transition(scheduled, { type: 'AUTO_SEND_BEGIN', now: 100 + DELAY });
  assert.equal(first.rejected, undefined);
  assert.equal(first.state.autoSendDueAt, null);
  assert.ok(transition(first.state, { type: 'AUTO_SEND_BEGIN', now: 100 + DELAY }).rejected);
});

test('pause cancels a scheduled send; resume reschedules it', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  const paused = transition(scheduled, { type: 'PAUSE', now: 200 }).state;
  assert.equal(paused.autoSendDueAt, null);
  assert.ok(transition(paused, { type: 'AUTO_SEND_BEGIN', now: 100 + DELAY }).rejected);
  const resumed = transition(paused, { type: 'RESUME', now: 300 }).state;
  assert.equal(resumed.autoSendDueAt, 300 + DELAY);
});

test('stop cancels a scheduled send', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  const stopped = transition(scheduled, { type: 'STOP', reason: 'user_stopped', now: 200 });
  assert.equal(stopped.state.autoSendDueAt, null);
  assert.equal(stopped.effects.length, 0, 'stopping yourself needs no notification');
});

test('turning auto-continue off cancels; turning it on never sends immediately', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  const off = transition(scheduled, { type: 'SET_AUTO_CONTINUE', enabled: false, delayMs: DELAY, now: 200 }).state;
  assert.equal(off.autoContinue, false);
  assert.equal(off.autoSendDueAt, null);
  const on = transition(off, { type: 'SET_AUTO_CONTINUE', enabled: true, delayMs: DELAY, now: 300 }).state;
  assert.equal(on.autoContinue, true);
  assert.equal(on.autoSendDueAt, null);
});

test('a manual hand-off while a send is scheduled replaces it', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  const manual = transition(scheduled, handoff(150)).state;
  assert.equal(manual.autoSendDueAt, null);
  assert.equal(manual.phase, 'awaiting_response');
});

test('a browser restart with a send pending stops the session instead of sending', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  const r = transition(scheduled, { type: 'BROWSER_STARTUP', now: 500 });
  assert.equal(r.state.monitoring, 'stopped');
  assert.equal(r.state.stopReason, 'auto_send_failed');
  assert.equal(r.effects[0]?.kind, 'session_ended');
});

test('without auto-continue the old review flow is unchanged', () => {
  const s = run(initialWorkflowState(), { type: 'START_SESSION', projectId: 'p1', autoContinue: false, autoDelayMs: DELAY, now: 1 }, handoff());
  const r = run(s.state, ...reply('a', 'continue'));
  assert.equal(r.state.phase, 'needs_review');
  assert.equal(r.state.autoSendDueAt, null);
  assert.equal(r.effects[0]?.kind, 'response_complete');
});

test('a stored pending send is dropped unless the session is still active and ready', () => {
  const scheduled = run(waitingAuto(), ...reply('a', 'continue', 100)).state;
  assert.equal(normalizeWorkflowState(JSON.parse(JSON.stringify(scheduled))).autoSendDueAt, 100 + DELAY);
  assert.equal(normalizeWorkflowState({ ...scheduled, monitoring: 'paused', pauseReason: 'user' }).autoSendDueAt, null);
  assert.equal(normalizeWorkflowState({ ...scheduled, autoContinue: false }).autoSendDueAt, null);
});
