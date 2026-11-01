// Persistence over chrome.storage.local. The storage area is injected so the
// logic can be tested without a browser.

import { normalizeSession } from './session.ts';
import { normalizeSettings } from './settings.ts';
import type { SessionState, Settings } from './types.ts';

export const SETTINGS_KEY = 'autopilot.settings.v2';
export const SESSION_KEY = 'autopilot.session.v2';

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function loadSettings(area: StorageAreaLike): Promise<Settings> {
  const data = await area.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(area: StorageAreaLike, settings: Settings): Promise<void> {
  await area.set({ [SETTINGS_KEY]: settings });
}

export async function loadSession(area: StorageAreaLike): Promise<SessionState> {
  const data = await area.get(SESSION_KEY);
  return normalizeSession(data[SESSION_KEY]);
}

export async function saveSession(area: StorageAreaLike, state: SessionState): Promise<void> {
  await area.set({ [SESSION_KEY]: state });
}

/**
 * Runs read-modify-write operations one at a time. The service worker can
 * receive several messages at once (observations, timers, UI clicks); without
 * this two of them could read the same state and one update would be lost.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
