import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROMPT, defaultSettings, isUnlimited, normalizeSettings, validateSettings } from '../src/shared/settings.ts';

test('the default prompt is the generic AUTOPILOT.md continuation prompt', () => {
  const settings = defaultSettings();
  assert.equal(settings.prompt, DEFAULT_PROMPT);
  assert.match(settings.prompt, /^Continue working on the project\./);
  assert.match(settings.prompt, /Read the repository's AUTOPILOT\.md/);
  assert.match(settings.prompt, /Only stop if the project milestone is complete, you're genuinely blocked, or human input is necessary\.$/);
  assert.deepEqual(validateSettings(settings), []);
});

test('validation names each invalid field', () => {
  const fields = validateSettings({ ...defaultSettings(), prompt: ' ', delaySeconds: 1.5, confirmSeconds: 0, maxCycles: -1 }).map((i) => i.field);
  assert.deepEqual(fields, ['prompt', 'delaySeconds', 'confirmSeconds', 'maxCycles']);
  assert.equal(validateSettings({ ...defaultSettings(), prompt: 'x'.repeat(8001) })[0]?.field, 'prompt');
});

test('0 maximum cycles means unlimited', () => {
  assert.equal(isUnlimited({ maxCycles: 0 }), true);
  assert.equal(isUnlimited({ maxCycles: 1 }), false);
  assert.deepEqual(validateSettings({ ...defaultSettings(), maxCycles: 0 }), []);
});

test('normalization keeps valid fields and resets only invalid ones', () => {
  const normalized = normalizeSettings({ prompt: 'Keep going.', delaySeconds: 'soon', confirmSeconds: 9999, maxCycles: 0, notifications: false });
  assert.deepEqual(normalized, { ...defaultSettings(), prompt: 'Keep going.', maxCycles: 0, notifications: false });
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings([1, 2]), defaultSettings());
  assert.equal(normalizeSettings({ prompt: '' }).prompt, DEFAULT_PROMPT);
});
