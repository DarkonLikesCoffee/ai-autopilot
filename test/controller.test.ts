// The continuation workflow end to end through the background controller,
// with the real state machine and storage, a fake ChatGPT tab and a
// controllable clock. Numbers in test names refer to the required scenarios.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, type NotifyRequest, type TabAccess } from '../src/background/controller.ts';
import type { SubmitRequest, SubmitResult } from '../src/content/composer.ts';
import { createLogger } from '../src/shared/logger.ts';
import type { UiResponse } from '../src/shared/messages.ts';
import { SESSION_KEY } from '../src/shared/storage.ts';
import type { PageObservation, SessionState, Settings } from '../src/shared/types.ts';
import { CONVO, MemoryStorage, obs, testSettings } from './helpers/fixtures.ts';

const quiet = createLogger('test', { info() {}, warn() {}, error() {} });
const TAB = 7;

interface Page {
  open: boolean;
  active: boolean;
  reachable: boolean;
  observation: PageObservation;
  /** What the page does when asked to send; defaults to a successful send. */
  onSubmit: (request: SubmitRequest) => SubmitResult | null;
}

function harness(storage = new MemoryStorage(), settings: Partial<Settings> = {}) {
  const clock = { now: 1_000_000 };
  const submits: { key: string; request: SubmitRequest }[] = [];
  const scheduled: number[] = [];
  const notifications: NotifyRequest[] = [];
  let cancels = 0;
  const page: Page = {
    open: true,
    active: true,
    reachable: true,
    observation: obs('idle', null),
    onSubmit: () => ({ outcome: 'submitted', sawGenerating: true }),
  };
  const info = () => ({ tabId: TAB, title: 'Demo conversation', conversation: new URL(page.observation.url).pathname });
  const tabs: TabAccess = {
    activeChatgptTab: async () => (page.open && page.active ? info() : null),
    tabInfo: async (id) => (id === TAB && page.open ? info() : null),
    findConversationTab: async (path) => (page.open && new URL(page.observation.url).pathname === path ? TAB : null),
    getObservation: async (id) => (id === TAB && page.open && page.reachable ? page.observation : null),
    submit: async (id, key, request) => {
      submits.push({ key, request });
      return id === TAB ? page.onSubmit(request) : null;
    },
    schedulePing: async () => undefined,
  };
  const make = () => createController({
    storage,
    tabs,
    scheduler: { schedule: (dueAt) => void scheduled.push(dueAt), cancel: () => void (cancels += 1) },
    notify: async (n) => void notifications.push(n),
    now: () => clock.now,
    log: quiet,
  });
  let controller = make();
  storage.data['autopilot.settings.v2'] = testSettings(settings);

  const h = {
    storage, clock, page, submits, scheduled, notifications,
    get cancels() { return cancels; },
    get controller() { return controller; },
    /** A new controller over the same storage, as after a service-worker restart. */
    restartWorker() { controller = make(); },
    ui: (type: 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'GET_SNAPSHOT') => controller.handleUi({ type }),
    async see(observation: PageObservation, tabId = TAB) {
      if (tabId === TAB) page.observation = observation;
      await controller.handleContent(tabId, { type: 'PAGE_OBSERVATION', observation });
    },
    async advance(ms: number) {
      clock.now += ms;
      await controller.handleDue();
    },
    async session(): Promise<SessionState> {
      return (await controller.handleUi({ type: 'GET_SNAPSHOT' }) as Extract<UiResponse, { ok: true }>).snapshot.session;
    },
    /** ChatGPT generates and finishes a response with this message id. */
    async respond(id: string, url = CONVO) {
      await h.see(obs('generating', `${new URL(url).pathname}|id:${id}`, url));
      await h.see(obs('complete', `${new URL(url).pathname}|id:${id}`, url));
    },
  };
  // After a successful send, the page shows ChatGPT generating the next response.
  page.onSubmit = () => {
    page.observation = obs('generating', page.observation.responseKey, page.observation.url);
    return { outcome: 'submitted', sawGenerating: true };
  };
  return h;
}

function ok(response: UiResponse): Extract<UiResponse, { ok: true }> {
  assert.ok(response.ok, response.ok ? '' : response.error);
  return response;
}

const key = (id: string) => `/c/abc|id:${id}`;

test('1-8: start, wait for completion and the delay, send the prompt, and repeat without any user action', async () => {
  const h = harness(undefined, { delaySeconds: 5, prompt: 'Continue per AUTOPILOT.md.' });
  const started = ok(await h.ui('START'));
  assert.equal(started.snapshot.session.run, 'running', '1: started');
  assert.equal(started.snapshot.session.conversation, '/c/abc');

  await h.see(obs('generating', key('m1')));
  assert.equal((await h.session()).lastStatus, 'generating', '2: generation observed');
  await h.see(obs('complete', key('m1')));
  let session = await h.session();
  assert.equal(session.phase, 'delay', '3: completion detected');
  assert.equal(session.dueAt, h.clock.now + 5000);
  assert.deepEqual(h.scheduled, [h.clock.now + 5000]);

  await h.advance(4000);
  assert.equal(h.submits.length, 0, '4: nothing before the delay ends');
  await h.advance(1000);
  assert.equal(h.submits.length, 1, '5-6: sent when the delay ends');
  assert.deepEqual(h.submits[0], { key: key('m1'), request: { text: 'Continue per AUTOPILOT.md.', expectedPath: '/c/abc', expectedKey: key('m1') } });
  session = await h.session();
  assert.equal(session.cycles, 1);
  assert.equal(session.phase, 'watching');
  assert.equal(session.generationSeen, true, '7: the next generation is detected');

  for (const id of ['m2', 'm3', 'm4']) {
    await h.see(obs('complete', key(id)));
    await h.advance(5000);
  }
  assert.equal(h.submits.length, 4, '8: one continuation per finished response, no manual steps');
  assert.deepEqual(h.submits.map((s) => s.key), [key('m1'), key('m2'), key('m3'), key('m4')]);
  assert.equal((await h.session()).cycles, 4);
});

test('9: duplicate completion events, rerenders and repeated timers never send twice', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.see(obs('generating', key('m1')));
  for (let i = 0; i < 5; i++) await h.see(obs('complete', key('m1')));
  assert.equal(h.scheduled.length, 1, 'one delay for one response');
  await h.advance(5000);
  await h.advance(10);
  await h.controller.handleDue();
  await h.controller.handleContent(TAB, { type: 'DUE_PING' });
  // The page re-renders the same finished response after the send.
  await h.see(obs('complete', key('m1')));
  assert.equal((await h.session()).phase, 'watching', 'an answered response does not even start a delay');
  assert.equal(h.scheduled.length, 1);
  await h.advance(5000);
  // A late duplicate report of the outcome is ignored.
  await h.controller.handleContent(TAB, { type: 'SUBMIT_REPORT', key: key('m1'), result: { outcome: 'submitted', sawGenerating: true } });
  assert.equal(h.submits.length, 1);
  assert.equal((await h.session()).cycles, 1);
});

test('a completion that was not preceded by a generation never triggers (already-finished page, navigation back)', async () => {
  const h = harness();
  h.page.observation = obs('complete', key('old'));
  ok(await h.ui('START'));
  for (let i = 0; i < 3; i++) await h.see(obs('complete', key('old')));
  await h.advance(60_000);
  assert.equal(h.scheduled.length, 0, 'no delay is even scheduled');
  assert.equal(h.submits.length, 0);
  assert.equal((await h.session()).phase, 'watching');
});

test('10: pause prevents the pending continuation; resume continues it with a fresh delay', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  ok(await h.ui('PAUSE'));
  await h.advance(60_000);
  await h.controller.handleContent(TAB, { type: 'DUE_PING' });
  assert.equal(h.submits.length, 0, 'nothing is sent while paused');
  const resumed = ok(await h.ui('RESUME'));
  assert.equal(resumed.snapshot.session.phase, 'delay');
  assert.equal(resumed.snapshot.session.dueAt, h.clock.now + 5000, 'a fresh delay after resuming');
  await h.advance(5000);
  assert.equal(h.submits.length, 1);
});

test('11: stop prevents the pending continuation, and later events do nothing', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  ok(await h.ui('STOP'));
  await h.advance(60_000);
  await h.respond('m2');
  await h.advance(60_000);
  assert.equal(h.submits.length, 0);
  assert.equal((await h.session()).run, 'stopped');
});

test('12: a usage limit stops automatic continuation and is never retried automatically', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  await h.see(obs('usage_limit', key('m1')));
  let session = await h.session();
  assert.equal(session.run, 'error');
  assert.equal(session.reason, 'usage_limit');
  assert.equal(h.notifications.length, 1);
  await h.advance(3_600_000);
  await h.see(obs('complete', key('m1')));
  await h.advance(60_000);
  assert.equal(h.submits.length, 0, 'nothing is sent after a usage limit');
  // Resuming while the limit is still shown is refused.
  h.page.observation = obs('usage_limit', key('m1'));
  assert.equal((await h.ui('RESUME')).ok, false);

  // Also when the limit appears only at the moment of sending.
  const g = harness();
  ok(await g.ui('START'));
  await g.respond('m1');
  g.page.observation = obs('usage_limit', key('m1'));
  await g.advance(5000);
  session = await g.session();
  assert.equal(g.submits.length, 0);
  assert.equal(session.reason, 'usage_limit');
});

test('13: text the user is typing is never overwritten; Autopilot pauses instead', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  h.page.observation = obs('complete', key('m1'), CONVO, { composerHasText: true });
  await h.advance(5000);
  assert.equal(h.submits.length, 0);
  const session = await h.session();
  assert.equal(session.run, 'paused');
  assert.equal(session.reason, 'composer_has_text');

  // The page's own last check refuses too, without typing anything; the response stays available.
  const g = harness();
  ok(await g.ui('START'));
  await g.respond('m1');
  g.page.onSubmit = () => ({ outcome: 'refused', reason: 'composer_has_text' });
  await g.advance(5000);
  const refused = await g.session();
  assert.equal(refused.reason, 'composer_has_text');
  assert.equal(refused.answeredKeys.includes(key('m1')), false, 'nothing was typed, so the response can still be continued');
});

test('14: navigating to another conversation prevents submission and pauses', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  await h.see(obs('complete', '/c/other|id:x', 'https://chatgpt.com/c/other'));
  await h.advance(60_000);
  assert.equal(h.submits.length, 0);
  const session = await h.session();
  assert.equal(session.run, 'paused');
  assert.equal(session.reason, 'conversation_changed');
  // Resume is refused while the tab shows the other conversation.
  assert.equal((await h.ui('RESUME')).ok, false);

  // Another tab's activity is ignored entirely.
  const g = harness();
  ok(await g.ui('START'));
  await g.see(obs('generating', '/c/zzz|id:1', 'https://chatgpt.com/c/zzz'), 99);
  await g.see(obs('complete', '/c/zzz|id:1', 'https://chatgpt.com/c/zzz'), 99);
  await g.advance(60_000);
  assert.equal(g.submits.length, 0);
  assert.equal((await g.session()).run, 'running');
});

test('a new chat is followed once ChatGPT saves it as a conversation', async () => {
  const h = harness();
  h.page.observation = obs('idle', null, 'https://chatgpt.com/');
  ok(await h.ui('START'));
  await h.respond('m1', 'https://chatgpt.com/c/new123');
  await h.advance(5000);
  assert.equal(h.submits.length, 1);
  assert.equal(h.submits[0]!.request.expectedPath, '/c/new123');
});

test('15: a browser restart pauses the session and never sends a duplicate', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  // The browser restarts during the delay; when it comes back the due time has passed.
  h.clock.now += 60_000;
  h.restartWorker();
  await h.controller.handleStartup();
  await h.controller.handleDue();
  let session = await h.session();
  assert.equal(session.run, 'paused');
  assert.equal(session.reason, 'browser_restarted');
  assert.equal(session.tabId, null, 'old tab ids are not reused');
  assert.equal(h.submits.length, 0);

  // A restart in the middle of an attempt: unknown outcome, so it pauses; resuming never resends that response.
  const g = harness();
  ok(await g.ui('START'));
  await g.respond('m1');
  g.page.onSubmit = () => null;
  const stored = structuredClone(g.storage.data[SESSION_KEY]) as SessionState;
  g.storage.data[SESSION_KEY] = { ...stored, phase: 'submitting', submitStartedAt: g.clock.now, answeredKeys: [...stored.answeredKeys, key('m1')], dueAt: null };
  g.restartWorker();
  await g.controller.handleStartup();
  session = await g.session();
  assert.equal(session.reason, 'submission_uncertain');
  g.page.observation = obs('complete', key('m1'));
  ok(await g.ui('RESUME'));
  await g.advance(60_000);
  assert.equal(g.submits.length, 0, 'the response with an uncertain attempt is never sent again');
});

test('a worker restart (not a browser restart) keeps the pending delay', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  h.restartWorker();
  await h.controller.handleWake();
  await h.advance(5000);
  assert.equal(h.submits.length, 1);

  // A worker that died during an attempt and wakes long after: uncertain, paused, not resent.
  const g = harness();
  ok(await g.ui('START'));
  await g.respond('m1');
  const stored = structuredClone(g.storage.data[SESSION_KEY]) as SessionState;
  g.storage.data[SESSION_KEY] = { ...stored, phase: 'submitting', submitStartedAt: g.clock.now, answeredKeys: [key('m1')], dueAt: null };
  g.clock.now += 120_000;
  g.restartWorker();
  await g.controller.handleWake();
  assert.equal((await g.session()).reason, 'submission_uncertain');
  assert.equal(g.submits.length, 0);
});

test('16: a failed or unconfirmed submission is handled safely and not retried', async () => {
  const failing = harness();
  ok(await failing.ui('START'));
  await failing.respond('m1');
  failing.page.onSubmit = () => ({ outcome: 'not_submitted', reason: 'send_unavailable', detail: 'the send button did not become available' });
  await failing.advance(5000);
  let session = await failing.session();
  assert.equal(session.run, 'error');
  assert.equal(session.reason, 'submit_failed');
  assert.match(session.detail ?? '', /send button/);
  await failing.advance(60_000);
  assert.equal(failing.submits.length, 1, 'no automatic retry');

  const uncertain = harness();
  ok(await uncertain.ui('START'));
  await uncertain.respond('m1');
  uncertain.page.onSubmit = () => ({ outcome: 'uncertain', detail: 'no sent message appeared' });
  await uncertain.advance(5000);
  session = await uncertain.session();
  assert.equal(session.run, 'paused');
  assert.equal(session.reason, 'submission_uncertain');

  const silent = harness();
  ok(await silent.ui('START'));
  await silent.respond('m1');
  silent.page.onSubmit = () => null; // the tab never answers
  await silent.advance(5000);
  assert.equal((await silent.session()).reason, 'submission_uncertain');

  const unreachable = harness();
  ok(await unreachable.ui('START'));
  await unreachable.respond('m1');
  unreachable.page.reachable = false;
  await unreachable.advance(5000);
  session = await unreachable.session();
  assert.equal(unreachable.submits.length, 0);
  assert.equal(session.reason, 'tab_unreachable');
});

test('17: an unknown page state never triggers a submission', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.see(obs('generating', key('m1')));
  await h.see(obs('unknown', null));
  await h.advance(60_000);
  assert.equal(h.submits.length, 0, 'unknown is not a completion');
  // A completion followed by an unknown page at sending time: nothing is sent, it pauses.
  await h.see(obs('complete', key('m1')));
  h.page.observation = obs('unknown', null);
  await h.advance(5000);
  assert.equal(h.submits.length, 0);
  assert.equal((await h.session()).run, 'paused');
});

test('18: the maximum number of cycles is respected', async () => {
  const h = harness(undefined, { maxCycles: 2 });
  ok(await h.ui('START'));
  for (const id of ['m1', 'm2', 'm3', 'm4']) {
    await h.respond(id);
    await h.advance(5000);
  }
  assert.equal(h.submits.length, 2);
  const session = await h.session();
  assert.equal(session.run, 'stopped');
  assert.equal(session.reason, 'max_cycles');
  assert.ok(h.notifications.some((n) => /Maximum number of continuations/.test(n.message)));
});

test('19: unlimited mode imposes no cycle cap', async () => {
  const h = harness(undefined, { maxCycles: 0, delaySeconds: 0 });
  ok(await h.ui('START'));
  for (let i = 1; i <= 150; i++) {
    await h.respond(`m${i}`);
    await h.advance(0);
  }
  assert.equal(h.submits.length, 150);
  assert.equal((await h.session()).run, 'running');
});

test('20: settings persist across restarts and invalid settings are refused', async () => {
  const storage = new MemoryStorage();
  const h = harness(storage);
  const saved = ok(await h.controller.handleUi({ type: 'SAVE_SETTINGS', settings: testSettings({ prompt: 'Go on.', delaySeconds: 30, confirmSeconds: 4, maxCycles: 9, notifications: false }) }));
  assert.equal(saved.snapshot.settings.delaySeconds, 30);
  h.restartWorker();
  const reloaded = ok(await h.ui('GET_SNAPSHOT'));
  assert.deepEqual(reloaded.snapshot.settings, testSettings({ prompt: 'Go on.', delaySeconds: 30, confirmSeconds: 4, maxCycles: 9, notifications: false }));
  const bad = await h.controller.handleUi({ type: 'SAVE_SETTINGS', settings: testSettings({ prompt: '   ', delaySeconds: -1 }) });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.error, /prompt cannot be empty.*delay before sending/i);
  assert.equal(ok(await h.ui('GET_SNAPSHOT')).snapshot.settings.prompt, 'Go on.', 'a refused save changes nothing');
});

test('start is refused without a ChatGPT tab, an attached content script, or while already running', async () => {
  const h = harness();
  h.page.active = false;
  assert.match((await h.ui('START') as { error: string }).error, /Open your ChatGPT conversation/);
  h.page.active = true;
  h.page.reachable = false;
  assert.match((await h.ui('START') as { error: string }).error, /Reload the ChatGPT tab/);
  h.page.reachable = true;
  ok(await h.ui('START'));
  assert.equal((await h.ui('START')).ok, false);
});

test('a generation that starts during the delay (for example you sent a message) cancels the pending continuation', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  await h.see(obs('generating', key('m2')));
  await h.advance(5000);
  assert.equal(h.submits.length, 0, 'nothing is sent for the old response');
  await h.see(obs('complete', key('m2')));
  await h.advance(5000);
  assert.deepEqual(h.submits.map((s) => s.key), [key('m2')]);
});

test('closing the tab pauses; resuming finds the conversation in another tab', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.respond('m1');
  await h.controller.handleTabRemoved(TAB);
  let session = await h.session();
  assert.equal(session.reason, 'tab_closed');
  assert.equal(session.tabId, null);
  await h.advance(60_000);
  assert.equal(h.submits.length, 0);
  // The same conversation is open again (same id in this fake); resume continues the pending response.
  session = ok(await h.ui('RESUME')).snapshot.session;
  assert.equal(session.run, 'running');
  await h.advance(5000);
  assert.equal(h.submits.length, 1);
});

test('auth errors and page errors stop automatic continuation', async () => {
  const h = harness();
  ok(await h.ui('START'));
  await h.see(obs('generating', key('m1')));
  await h.see(obs('error', null, CONVO, { authRequired: true }));
  assert.equal((await h.session()).reason, 'auth_required');
  const g = harness();
  ok(await g.ui('START'));
  await g.see(obs('generating', key('m1')));
  await g.see(obs('error', key('m1')));
  assert.equal((await g.session()).reason, 'page_error');
  await g.advance(60_000);
  assert.equal(g.submits.length + h.submits.length, 0);
});

test('notifications follow the setting', async () => {
  const h = harness(undefined, { notifications: false });
  ok(await h.ui('START'));
  await h.respond('m1');
  await h.see(obs('usage_limit', key('m1')));
  assert.equal(h.notifications.length, 0);
});
