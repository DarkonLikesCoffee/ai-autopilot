// Persistence over chrome.storage.local. The storage area is injected so the
// logic can be tested without a browser.

import { normalizeSession } from './session.ts';
import { normalizeSettings } from './settings.ts';
import type { SessionState, Settings } from './types.ts';

export const SETTINGS_KEY = 'autopilot.settings.v2';
export const SESSION_KEY = 'autopilot.session.v2';
/**
 * The Getting started card (M5 C-4): 'show' after a fresh install, 'dismissed'
 * once you choose "Don't show again". Absent (an update from an older version)
 * means not shown. Kept next to the settings, but not in them, so saving or
 * resetting the settings never brings the card back.
 */
export const GETTING_STARTED_KEY = 'autopilot.gettingStarted';

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

export async function loadGettingStarted(area: StorageAreaLike): Promise<boolean> {
  const data = await area.get(GETTING_STARTED_KEY);
  return data[GETTING_STARTED_KEY] === 'show';
}

export async function saveGettingStarted(area: StorageAreaLike, value: 'show' | 'dismissed'): Promise<void> {
  await area.set({ [GETTING_STARTED_KEY]: value });
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
