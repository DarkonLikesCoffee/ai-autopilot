// M5 C-6: settings form parsing, per-field issues, the unsaved check, and D-3.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_INPUT, fieldIssues, formValues, hasUnsavedChanges, parseForm } from '../src/ui/settingsForm.ts';
import { defaultSettings, LIMITS, normalizeSettings, validateSettings } from '../src/shared/settings.ts';

const saved = defaultSettings();
const values = (over: Partial<ReturnType<typeof formValues>> = {}) => ({ ...formValues(saved), ...over });

test('D-3: the delay is at least 1 s; a stored 0 falls back to the default', () => {
  assert.equal(LIMITS.delaySeconds.min, 1);
  assert.deepEqual(validateSettings({ ...saved, delaySeconds: 1 }), []);
  assert.deepEqual(validateSettings({ ...saved, delaySeconds: 0 }).map((i) => i.field), ['delaySeconds']);
  assert.equal(normalizeSettings({ ...saved, delaySeconds: 0 }).delaySeconds, saved.delaySeconds);
  assert.equal(normalizeSettings({ ...saved, delaySeconds: 1 }).delaySeconds, 1);
});

test('the saved settings round-trip through the form unchanged', () => {
  assert.deepEqual(parseForm(formValues(saved)), saved);
  const unlimited = { ...saved, maxCycles: 0 };
  assert.deepEqual(formValues(unlimited).maxCycles, '');
  assert.deepEqual(parseForm(formValues(unlimited)), unlimited);
  assert.deepEqual(fieldIssues(formValues(saved)), {});
});

test('an empty number box is invalid, never read as 0', () => {
  assert.ok(Number.isNaN(parseForm(values({ delaySeconds: '' })).delaySeconds));
  assert.ok(Number.isNaN(parseForm(values({ maxCycles: '  ' })).maxCycles), 'an empty maximum is not "unlimited"');
  assert.equal(parseForm(values({ maxCycles: '', unlimited: true })).maxCycles, 0, 'only the checkbox means unlimited');
  assert.deepEqual(Object.keys(fieldIssues(values({ delaySeconds: '' }))), ['delaySeconds']);
});

test('each invalid field gets its own message, and only that field', () => {
  const issues = fieldIssues(values({ prompt: '   ', delaySeconds: '0', confirmSeconds: '2.5', maxCycles: '-1' }));
  assert.deepEqual(Object.keys(issues).sort(), ['confirmSeconds', 'delaySeconds', 'maxCycles', 'prompt']);
  assert.equal(issues.prompt, 'The continuation prompt cannot be empty.');
  assert.equal(issues.delaySeconds, 'The delay before sending must be a whole number from 1 to 3600.');
  assert.match(issues.confirmSeconds ?? '', /whole number from 1 to 120\.$/);
  assert.deepEqual(fieldIssues(values({ maxCycles: 'x', unlimited: true })), {}, 'the maximum is ignored when unlimited');
  for (const field of Object.keys(issues)) assert.ok(field in FIELD_INPUT, `${field} has a form control`);
});

test('unsaved changes: any field that would change the saved settings, and nothing else', () => {
  assert.equal(hasUnsavedChanges(formValues(saved), saved), false);
  assert.equal(hasUnsavedChanges(values({ delaySeconds: ' 10 ' }), saved), false, 'the same number, typed differently');
  assert.equal(hasUnsavedChanges(values({ delaySeconds: '11' }), saved), true);
  assert.equal(hasUnsavedChanges(values({ prompt: `${saved.prompt} ` }), saved), true, 'the prompt is sent unchanged, so any edit counts');
  assert.equal(hasUnsavedChanges(values({ unlimited: true }), saved), true);
  assert.equal(hasUnsavedChanges(values({ stopOnMarker: true }), saved), true);
  assert.equal(hasUnsavedChanges(values({ notifications: false }), saved), true);
  assert.equal(hasUnsavedChanges(values({ delaySeconds: '' }), saved), true, 'an emptied box is a change');
});
