import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDiagnostic, createDiagnosticLogger, DEBUG_STORAGE_KEY, diagnosticsEnabled } from '../src/content/diagnostics.ts';
import { CONVO, fakeRoot, obs } from './helpers/fixtures.ts';

test('diagnostics are off unless explicitly turned on', () => {
  assert.equal(diagnosticsEnabled(undefined), false);
  assert.equal(diagnosticsEnabled({ getItem: () => null }), false);
  assert.equal(diagnosticsEnabled({ getItem: () => 'true' }), false);
  assert.equal(diagnosticsEnabled({ getItem: (k) => (k === DEBUG_STORAGE_KEY ? '1' : null) }), true);
  assert.equal(diagnosticsEnabled({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('a diagnostic holds structure only: no text, no titles, short values', () => {
  const root = fakeRoot({
    button: [
      { text: 'secret conversation text', attrs: { 'aria-label': 'Send prompt', title: 'secret title', 'data-testid': 'send-button' } },
      { attrs: { 'aria-label': 'x'.repeat(500), 'aria-disabled': 'true' } },
    ],
    '[data-talvt-turn-state], [data-loading-indicator], [data-d-stream-word], [data-chatgpt-agent-turn-start], [data-is-streaming]': [
      { text: 'secret answer', attrs: { 'data-conversation-role': 'assistant', 'data-talvt-turn-state': 'in_progress' } },
    ],
  });
  const diagnostic = collectDiagnostic(root, obs('generating', '/c/abc|id:m1', CONVO, { stopControlFound: true }));
  const serialized = JSON.stringify(diagnostic);
  assert.ok(!serialized.includes('secret'));
  assert.equal(diagnostic.status, 'generating');
  assert.equal(diagnostic.responseKey, '/c/abc|id:m1');
  assert.deepEqual(diagnostic.buttons[0], { ariaLabel: 'Send prompt', testId: 'send-button', disabled: false });
  assert.equal(diagnostic.buttons[1]!.ariaLabel!.toString().length, 60);
  assert.equal(diagnostic.buttons[1]!.disabled, true);
  assert.equal(diagnostic.markers[0]!.turnState, 'in_progress');
  assert.equal(diagnostic.markers[0]!.conversationRole, 'assistant');
});

test('the logger only logs changes', () => {
  const logged: unknown[] = [];
  const log = createDiagnosticLogger((d) => logged.push(d));
  const root = fakeRoot({});
  log(collectDiagnostic(root, obs('complete', 'k1')));
  log(collectDiagnostic(root, obs('complete', 'k1')));
  log(collectDiagnostic(root, obs('complete', 'k2')));
  assert.equal(logged.length, 2);
});
