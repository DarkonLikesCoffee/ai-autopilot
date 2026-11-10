// PRIVACY.md must stay in step with the code (M5 C-1, R-1): a new permission,
// storage key or stored field fails this test until it is documented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultSettings } from '../src/shared/settings.ts';
import { initialSession, MAX_ANSWERED_KEYS, MAX_LOG_ENTRIES } from '../src/shared/session.ts';
import { GETTING_STARTED_KEY, SESSION_KEY, SETTINGS_KEY } from '../src/shared/storage.ts';
import { DEBUG_STORAGE_KEY } from '../src/content/diagnostics.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const privacy = read('PRIVACY.md');
const manifest = JSON.parse(read('static/manifest.json')) as { permissions: string[]; host_permissions: string[]; optional_permissions?: string[] };

test('every manifest permission and host is listed in PRIVACY.md', () => {
  for (const p of [...manifest.permissions, ...(manifest.optional_permissions ?? []), ...manifest.host_permissions]) {
    assert.ok(privacy.includes(`\`${p}\``), `PRIVACY.md does not list ${p}`);
  }
});

test('every storage key is listed in PRIVACY.md', () => {
  const background = read('src/background/index.ts');
  const aliveKey = background.match(/const ALIVE_KEY = '([^']+)'/)![1]!;
  for (const key of [SETTINGS_KEY, SESSION_KEY, GETTING_STARTED_KEY, aliveKey, DEBUG_STORAGE_KEY]) {
    assert.ok(privacy.includes(`\`${key}\``), `PRIVACY.md does not list the storage key ${key}`);
  }
});

test('every stored settings and session field is listed in PRIVACY.md', () => {
  for (const field of [...Object.keys(defaultSettings()), ...Object.keys(initialSession())]) {
    assert.ok(privacy.includes(`\`${field}\``), `PRIVACY.md does not mention the stored field ${field}`);
  }
});

test('the retention bounds in PRIVACY.md match the code', () => {
  assert.ok(privacy.includes(`last ${MAX_ANSWERED_KEYS}`) && privacy.includes(`MAX_ANSWERED_KEYS = ${MAX_ANSWERED_KEYS}`));
  assert.ok(privacy.includes(`last ${MAX_LOG_ENTRIES}`) && privacy.includes(`MAX_LOG_ENTRIES = ${MAX_LOG_ENTRIES}`));
});

test('the README points to PRIVACY.md and no longer calls the notifications permission optional', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('PRIVACY.md'));
  assert.doesNotMatch(readme, /`notifications` \| [^|]*\(optional\)/);
});
