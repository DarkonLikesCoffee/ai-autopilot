import test from 'node:test';
import assert from 'node:assert/strict';
import { HALT_GUIDANCE, HALT_KIND_LABEL } from '../src/shared/guidance.ts';
import { initialSession, REASON_TEXT } from '../src/shared/session.ts';
import { guidanceFor } from '../src/ui/viewModel.ts';
import type { HaltReason, SessionState } from '../src/shared/types.ts';

// The expected kind of every halt reason, written out so a change is deliberate.
const EXPECTED: Record<HaltReason, 'resume' | 'fix' | 'finished'> = {
  user: 'resume',
  max_cycles: 'finished',
  usage_limit: 'fix',
  auth_required: 'fix',
  page_error: 'fix',
  conversation_changed: 'fix',
  tab_closed: 'fix',
  browser_restarted: 'fix',
  composer_has_text: 'fix',
  submit_failed: 'fix',
  submission_uncertain: 'fix',
  tab_unreachable: 'fix',
  unrecognized_notice: 'fix',
  no_response: 'fix',
  no_new_answer: 'fix',
  marker_complete: 'finished',
  marker_blocked: 'fix',
  marker_unclear: 'fix',
};

test('every halt reason has guidance of the expected kind', () => {
  assert.deepEqual(Object.keys(HALT_GUIDANCE).sort(), Object.keys(REASON_TEXT).sort(), 'one entry per reason');
  for (const [reason, kind] of Object.entries(EXPECTED) as [HaltReason, string][]) {
    const g = HALT_GUIDANCE[reason];
    assert.equal(g.kind, kind, reason);
    assert.ok(g.action.length > 10 && g.action.endsWith('.'), `${reason}: one complete sentence`);
  }
});

test('"fix" guidance always ends with how to continue; "finished" never offers Resume', () => {
  for (const [reason, g] of Object.entries(HALT_GUIDANCE)) {
    if (g.kind === 'fix') assert.match(g.action, /press Resume/i, reason);
    if (g.kind === 'finished') assert.doesNotMatch(g.action, /Resume/, reason);
  }
  assert.match(HALT_GUIDANCE.usage_limit.action, /never retries on its own/);
  assert.match(HALT_GUIDANCE.submission_uncertain.action, /not continued again/);
});

const session = (over: Partial<SessionState>): SessionState => ({ ...initialSession(), ...over });

test('the panel shows guidance after a halt, and not while running or after your own Stop', () => {
  assert.equal(guidanceFor(session({ run: 'running' })), null);
  assert.equal(guidanceFor(session({ run: 'stopped', reason: 'user' })), null, 'stopped by you: Start, not Resume');
  assert.equal(guidanceFor(session({ run: 'stopped', reason: null })), null);
  assert.deepEqual(guidanceFor(session({ run: 'paused', reason: 'user' })), { label: HALT_KIND_LABEL.resume, kind: 'resume', action: HALT_GUIDANCE.user.action });
  assert.equal(guidanceFor(session({ run: 'paused', reason: 'composer_has_text' }))?.label, 'Fix first');
  assert.equal(guidanceFor(session({ run: 'error', reason: 'usage_limit' }))?.kind, 'fix');
  assert.equal(guidanceFor(session({ run: 'stopped', reason: 'max_cycles' }))?.label, 'Finished');
});
