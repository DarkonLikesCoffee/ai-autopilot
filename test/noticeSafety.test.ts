// Notices in any language must fail safely (owner requirement, 2026-11-05).
// No Spanish notice text could be verified from a reliable source, so none is
// matched by text. Instead, language-independent rules:
//  1. an alert-type notice outside the conversation that matches no known
//     text is "unrecognized" and is never taken for a finished answer;
//  2. a continuation that is not followed by ChatGPT generating pauses;
//  3. a generation that ends without a new answer pauses.
// The notice texts below are synthetic placeholders, not ChatGPT strings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../src/content/detector.ts';
import { observePage, unrecognizedNotice } from '../src/content/page.ts';
import { DEFAULT_SELECTORS } from '../src/content/selectors.ts';
import { NO_RESPONSE_MS, normalizeSession } from '../src/shared/session.ts';
import type { PageObservation } from '../src/shared/types.ts';
import { CONVO, FakeTimers, fakeRoot, obs, type FakeElementSpec } from './helpers/fixtures.ts';

const UNKNOWN = '[synthetic notice text in an unknown language]';
const page = (extra: Record<string, FakeElementSpec[]>) =>
  fakeRoot({ '#prompt-textarea': [{}], '[data-message-author-role="assistant"]': [{ attrs: { 'data-message-id': 'm1' } }], ...extra });

test('an alert outside the conversation with unknown text is an unrecognized notice', () => {
  const o = observePage(page({ '[role="alert"]': [{ text: UNKNOWN }] }), CONVO, DEFAULT_SELECTORS);
  assert.equal(o.signals.unrecognizedNoticeFound, true);
  assert.equal(o.status, 'complete', 'the page status itself is unchanged; the session decides (see controller tests)');
});

test('error-styled regions with unknown text are unrecognized notices too', () => {
  for (const selector of ['.text-token-text-error', '[class*="border-token-surface-error"]', '[data-testid*="error"]']) {
    assert.equal(unrecognizedNotice(page({ [selector]: [{ text: UNKNOWN }] }), DEFAULT_SELECTORS), true, selector);
  }
});

test('the known English notices keep their exact meaning and are not "unrecognized"', () => {
  const limit = observePage(page({ '[role="alert"]': [{ text: 'You’ve reached our limit of messages per hour. Please try again later.' }] }), CONVO, DEFAULT_SELECTORS);
  assert.equal(limit.status, 'usage_limit');
  assert.equal(limit.signals.unrecognizedNoticeFound, false);
  const error = observePage(page({ '[role="alert"]': [{ text: 'Something went wrong. Please try again.' }] }), CONVO, DEFAULT_SELECTORS);
  assert.equal(error.status, 'error');
  assert.equal(error.signals.unrecognizedNoticeFound, false);
  const login = observePage(page({ '[role="alert"]': [{ text: 'Your session has expired. Please log in again.' }] }), CONVO, DEFAULT_SELECTORS);
  assert.equal(login.signals.authRequired, true);
  assert.equal(login.signals.unrecognizedNoticeFound, false);
});

test('not unrecognized notices: inside a message, hidden, empty, screen-reader-only, or a routine status toast', () => {
  const cases: Record<string, FakeElementSpec[]>[] = [
    { '[role="alert"]': [{ text: UNKNOWN, insideMessage: true }] },
    { '[role="alert"]': [{ text: UNKNOWN, visible: false }] },
    { '[role="alert"]': [{ text: '   ' }] },
    { '[role="status"]': [{ text: UNKNOWN }] },
    { '[data-testid*="toast"]': [{ text: UNKNOWN }] },
  ];
  for (const extra of cases) assert.equal(unrecognizedNotice(page(extra), DEFAULT_SELECTORS), false, JSON.stringify(extra));
  // A 1px screen-reader-only live region.
  const srOnly = { querySelectorAll: (sel: string) => (sel === '[role="alert"]' ? [{ textContent: UNKNOWN, getAttribute: () => null, closest: () => null, checkVisibility: () => true, getBoundingClientRect: () => ({ width: 1, height: 1 }) }] : []) };
  assert.equal(unrecognizedNotice(srOnly, DEFAULT_SELECTORS), false);
  const rendered = { querySelectorAll: (sel: string) => (sel === '[role="alert"]' ? [{ textContent: UNKNOWN, getAttribute: () => null, closest: () => null, checkVisibility: () => true, getBoundingClientRect: () => ({ width: 300, height: 40 }) }] : []) };
  assert.equal(unrecognizedNotice(rendered, DEFAULT_SELECTORS), true);
});

test('a very long alert is still an alert: unrecognized, never ignored', () => {
  assert.equal(unrecognizedNotice(page({ '[role="alert"]': [{ text: 'x'.repeat(2000) }] }), DEFAULT_SELECTORS), true);
});

test('the detector reports a notice appearing on an already finished page at once', () => {
  const timers = new FakeTimers();
  let current: PageObservation = obs('complete', 'k|1');
  const emitted: PageObservation[] = [];
  const detector = createDetector({ read: () => current, emit: (o) => emitted.push(o), timers, settleMs: 1000, coalesceMs: 100 });
  detector.evaluate();
  current = obs('complete', 'k|1', CONVO, { unrecognizedNoticeFound: true });
  detector.evaluate();
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1]!.signals.unrecognizedNoticeFound, true);
});

test('the time a continuation waits for ChatGPT to start answering survives a restart', () => {
  const restored = normalizeSession({ ...normalizeSession(null), schemaVersion: 2, run: 'running', phase: 'watching', tabId: 7, awaitingResponseSince: 1234 });
  assert.equal(restored.awaitingResponseSince, 1234);
  assert.equal(normalizeSession({ ...restored, awaitingResponseSince: 'x' }).awaitingResponseSince, null);
  assert.equal(NO_RESPONSE_MS, 60_000);
});
