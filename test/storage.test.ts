import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue, loadSession, loadSettings, saveSession, saveSettings, SESSION_KEY, SETTINGS_KEY } from '../src/shared/storage.ts';
import { defaultSettings } from '../src/shared/settings.ts';
import { initialSession } from '../src/shared/session.ts';
import { MemoryStorage, testSettings } from './helpers/fixtures.ts';

test('settings and session round-trip through storage (they persist across restarts)', async () => {
  const storage = new MemoryStorage();
  const settings = testSettings({ prompt: 'Keep going.', delaySeconds: 42, maxCycles: 7, notifications: false });
  await saveSettings(storage, settings);
  const session = { ...initialSession(), run: 'paused' as const, reason: 'user' as const, tabId: 3, conversation: '/c/x', cycles: 2 };
  await saveSession(storage, session);
  // A fresh load, as after a browser or service-worker restart.
  assert.deepEqual(await loadSettings(storage), settings);
  assert.deepEqual(await loadSession(storage), session);
});

test('empty or corrupt storage loads safe defaults', async () => {
  const storage = new MemoryStorage();
  assert.deepEqual(await loadSettings(storage), defaultSettings());
  assert.deepEqual(await loadSession(storage), initialSession());
  storage.data[SETTINGS_KEY] = 'garbage';
  storage.data[SESSION_KEY] = { schemaVersion: 2, run: 'running', phase: 'nonsense', answeredKeys: ['/c/x|id:1'] };
  assert.deepEqual(await loadSettings(storage), defaultSettings());
  const session = await loadSession(storage);
  assert.equal(session.run, 'stopped', 'unreadable state never resumes sending');
  assert.deepEqual(session.answeredKeys, ['/c/x|id:1'], 'answered responses are remembered even then');
});

test('the serial queue runs tasks in order and survives failures', async () => {
  const queue = createSerialQueue();
  const order: number[] = [];
  const slow = queue(async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); });
  const failing = queue(async () => { order.push(2); throw new Error('boom'); });
  const fast = queue(async () => { order.push(3); return 'done'; });
  await slow;
  await assert.rejects(failing, /boom/);
  assert.equal(await fast, 'done');
  assert.deepEqual(order, [1, 2, 3]);
});
