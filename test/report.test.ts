import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosticReport, formatDiagnosticReport } from '../src/shared/report.ts';
import { initialSession } from '../src/shared/session.ts';
import { defaultSettings } from '../src/shared/settings.ts';
import type { UiSnapshot } from '../src/shared/messages.ts';
import type { SendDiagnostic } from '../src/content/sendDiagnostics.ts';
import { obs } from './helpers/fixtures.ts';

const NOW = 1_700_000_000_000;

function snapshotWithSecrets(): UiSnapshot {
  const session = {
    ...initialSession(),
    run: 'paused' as const,
    phase: 'delay' as const,
    reason: 'composer_has_text' as const,
    detail: 'nothing was sent so your text is kept',
    tabId: 7,
    conversation: '/c/SECRET-CONVERSATION-ID',
    cycles: 2,
    generationSeen: true,
    pendingKey: '/c/SECRET-CONVERSATION-ID|id:SECRET-MESSAGE-ID',
    dueAt: NOW + 4000,
    answeredKeys: ['/c/SECRET-CONVERSATION-ID|id:SECRET-A', '/c/SECRET-CONVERSATION-ID|n:3'],
    lastStatus: 'complete' as const,
    lastContinuationAt: NOW - 60_000,
    startedAt: NOW - 600_000,
    log: [{ at: NOW - 5000, message: 'Response complete. Continuation 3 in 10s.' }],
  };
  return {
    settings: { ...defaultSettings(), prompt: 'SECRET PROMPT about my private project' },
    session,
    sessionTab: { tabId: 7, title: 'SECRET conversation title', conversation: '/c/SECRET-CONVERSATION-ID' },
    activeTab: { tabId: 7, title: 'SECRET conversation title', conversation: '/c/SECRET-CONVERSATION-ID' },
    activeTabConnected: null,
    page: null,
    gettingStarted: false,
    now: NOW,
  };
}

const lastSend: SendDiagnostic = {
  stage: 'send_button_unavailable',
  elapsedMs: 3000,
  insertion: { method: 'execCommand', execCommandReturned: true },
  composer: null,
  sendSelectors: [{ selector: 'button[aria-label="Enviar"]', matches: [], total: 0 }],
  chosen: null,
  nearbyButtons: [],
};

test('the report never contains the prompt, tab titles, conversation ids, response keys or message ids', () => {
  const text = formatDiagnosticReport({
    snapshot: snapshotWithSecrets(),
    observation: obs('complete', '/c/SECRET-CONVERSATION-ID|id:SECRET-LATEST', 'https://chatgpt.com/c/SECRET-CONVERSATION-ID'),
    lastSend,
    environment: { extensionVersion: '0.2.0', userAgent: 'Mozilla/5.0 test' },
  });
  assert.ok(!text.includes('SECRET'), text);
  assert.doesNotThrow(() => JSON.parse(text));
});

test('the report keeps what is needed to understand a problem', () => {
  const r = buildDiagnosticReport({
    snapshot: snapshotWithSecrets(),
    observation: obs('complete', '/c/x|id:m9', 'https://chatgpt.com/c/x', { unrecognizedNoticeFound: true }),
    lastSend,
    environment: { extensionVersion: '0.2.0', userAgent: 'UA' },
  }) as any;
  assert.equal(r.extensionVersion, '0.2.0');
  assert.deepEqual(r.settings.prompt, { length: 'SECRET PROMPT about my private project'.length, isDefault: false });
  assert.equal(r.settings.delaySeconds, 10);
  assert.equal(r.session.run, 'paused');
  assert.equal(r.session.reason, 'composer_has_text');
  assert.equal(r.session.conversation, 'saved');
  assert.equal(r.session.pendingKey, 'id');
  assert.equal(r.session.answeredResponses, 2);
  assert.equal(r.session.secondsFromNow.dueAt, 4);
  assert.equal(r.session.secondsFromNow.lastContinuationAt, -60);
  assert.deepEqual(r.session.log, [{ secondsFromNow: -5, message: 'Response complete. Continuation 3 in 10s.' }]);
  assert.equal(r.tabs.sessionTabFound, true);
  assert.equal(r.tabs.activeTabIsSessionTab, true);
  assert.equal(r.page.status, 'complete');
  assert.equal(r.page.page, 'saved');
  assert.equal(r.page.responseKey, 'id');
  assert.equal(r.page.signals.unrecognizedNoticeFound, true);
  assert.equal(r.lastSendAttempt.stage, 'send_button_unavailable');
});

test('a tab that did not answer and a default prompt are reported as such', () => {
  const snap = snapshotWithSecrets();
  snap.settings = defaultSettings();
  snap.sessionTab = null;
  snap.activeTab = null;
  const r = buildDiagnosticReport({ snapshot: snap, observation: null, lastSend: null, environment: { extensionVersion: 'v', userAgent: 'u' } }) as any;
  assert.deepEqual(r.page, { answered: false });
  assert.equal(r.lastSendAttempt, null);
  assert.equal(r.settings.prompt.isDefault, true);
  assert.equal(r.tabs.sessionTabFound, false);
  assert.equal(r.tabs.activeTabIsSessionTab, false);
});

test('the report includes the guidance kind of the halt', () => {
  const r = buildDiagnosticReport({ snapshot: snapshotWithSecrets(), observation: null, lastSend: null, environment: { extensionVersion: 'v', userAgent: 'u' } }) as any;
  assert.equal(r.session.guidance, 'fix');
});
