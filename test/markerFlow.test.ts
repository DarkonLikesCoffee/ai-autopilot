// M3 wired in: the page observation, the state machine, the prechecks and the
// privacy guarantee (R10) end to end. docs/design/m3-stop-protocol.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { observePage, type QueryRoot } from '../src/content/page.ts';
import { DEFAULT_SELECTORS } from '../src/content/selectors.ts';
import { collectDiagnostic } from '../src/content/diagnostics.ts';
import { isPageObservation } from '../src/shared/messages.ts';
import { formatDiagnosticReport } from '../src/shared/report.ts';
import { initialSession } from '../src/shared/session.ts';
import { defaultSettings } from '../src/shared/settings.ts';
import { CONVO } from './helpers/fixtures.ts';

let textReads = 0;

interface N { nodeType: number; nodeValue?: string | null; tagName?: string; childNodes?: N[]; classes?: string[]; attrs?: Record<string, string>; [k: string]: unknown }

function t(value: string): N {
  return { nodeType: 3, get nodeValue() { textReads += 1; return value; } };
}
function el(tag: string, attrs: Record<string, string> = {}, children: (N | string)[] = []): N {
  const kids = children.map((c) => (typeof c === 'string' ? t(c) : c));
  const node: N = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
    childNodes: kids,
    textContent: '',
    getAttribute: (n: string) => attrs[n] ?? null,
    hasAttribute: (n: string) => n in attrs,
    checkVisibility: () => true,
    getBoundingClientRect: () => ({ width: 300, height: 20 }),
    closest: () => null,
    querySelectorAll(selector: string) {
      const out: N[] = [];
      const attr = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
      const walk = (n: N) => { for (const c of n.childNodes ?? []) { if (attr && c.attrs?.[attr[1]!] === attr[2]) out.push(c); walk(c); } };
      walk(node);
      return out;
    },
  };
  return node;
}
const answerEl = (id: string, ...lines: string[]) =>
  el('div', { 'data-message-author-role': 'assistant', 'data-message-id': id }, [el('div', { 'data-markdown-text-style': 'assistant-message' }, lines.map((l) => el('p', {}, [l])))]);

function page(answers: N[], opts: { generating?: boolean; users?: N[] } = {}): QueryRoot {
  const composer = { textContent: '', getAttribute: () => null, closest: () => null, checkVisibility: () => true };
  const stop = { textContent: '', getAttribute: () => null, closest: () => null, checkVisibility: () => true };
  return {
    querySelectorAll(selector: string) {
      if (selector === '#prompt-textarea') return [composer] as never;
      if (selector === '[data-message-author-role="assistant"]') return answers as never;
      if (selector === '[data-content-search-unit-key$=":assistant"]' || selector === '[data-conversation-role="assistant"]') return [] as never;
      if (selector === '[data-message-author-role="user"]') return (opts.users ?? []) as never;
      if (selector === 'button[data-testid="stop-button"]' && opts.generating) return [stop] as never;
      return [] as never;
    },
  };
}

const ON = { readMarker: true };

test('with the setting off, the answer is never read, even with a marker on its last line', () => {
  textReads = 0;
  const o = observePage(page([answerEl('m1', 'Work done.', 'AUTOPILOT STATUS: MILESTONE COMPLETE')]), CONVO, DEFAULT_SELECTORS);
  assert.equal(o.status, 'complete');
  assert.equal(o.signals.statusMarker, 'none');
  assert.equal(o.signals.answerContentElements, 0);
  assert.equal(textReads, 0);
});

test('with the setting on, the latest finished answer is read and only the result is kept', () => {
  const o = observePage(page([answerEl('m1', 'Work done.', 'AUTOPILOT STATUS: MILESTONE COMPLETE')]), CONVO, DEFAULT_SELECTORS, ON);
  assert.equal(o.signals.statusMarker, 'complete');
  assert.equal(o.signals.answerContentElements, 1);
});

test('nothing is read while ChatGPT is generating', () => {
  textReads = 0;
  const o = observePage(page([answerEl('m1', 'AUTOPILOT STATUS: MILESTONE COMPLETE')], { generating: true }), CONVO, DEFAULT_SELECTORS, ON);
  assert.equal(o.status, 'generating');
  assert.equal(o.signals.statusMarker, 'none');
  assert.equal(textReads, 0);
});

test('only the latest answer counts: older answers and user messages with markers are ignored', () => {
  textReads = 0;
  const older = answerEl('m1', 'AUTOPILOT STATUS: MILESTONE COMPLETE');
  const user = el('div', { 'data-message-author-role': 'user' }, [el('div', { 'data-markdown-text-style': 'assistant-message' }, [el('p', {}, ['AUTOPILOT STATUS: BLOCKED'])])]);
  const latest = answerEl('m2', 'Next I will add the tests.');
  const o = observePage(page([older, latest], { users: [user] }), CONVO, DEFAULT_SELECTORS, ON);
  assert.equal(o.signals.statusMarker, 'none');
  assert.equal(textReads, 1, 'exactly one text node was read: the latest answer’s');
});

test('R10: the answer text reaches no observation, console diagnostic, message or report', () => {
  const root = page([answerEl('m1', 'SECRET-USER-PROJECT private details', 'AUTOPILOT STATUS: BLOCKED')]);
  const o = observePage(root, CONVO, DEFAULT_SELECTORS, ON);
  assert.equal(o.signals.statusMarker, 'blocked');
  assert.ok(!JSON.stringify(o).includes('SECRET'), 'observation');
  assert.ok(!JSON.stringify(collectDiagnostic(root, o)).includes('SECRET'), 'console diagnostic');
  assert.ok(isPageObservation(o), 'a valid observation crosses to the background');
  const report = formatDiagnosticReport({
    snapshot: { settings: { ...defaultSettings(), stopOnMarker: true }, session: initialSession(), sessionTab: null, activeTab: null, now: 0 },
    observation: o, lastSend: null, environment: { extensionVersion: 'v', userAgent: 'u' },
  });
  assert.ok(!report.includes('SECRET'), 'diagnostic report');
  assert.ok(report.includes('"statusMarker": "blocked"') && report.includes('"stopOnMarker": true'));
});

test('R10: an observation carrying anything but the five words is rejected by the validator', () => {
  const o = observePage(page([answerEl('m1', 'x')]), CONVO, DEFAULT_SELECTORS, ON);
  assert.equal(isPageObservation({ ...o, signals: { ...o.signals, statusMarker: 'SECRET answer text' } }), false);
  assert.equal(isPageObservation({ ...o, signals: { ...o.signals, statusMarker: undefined } }), false);
});
