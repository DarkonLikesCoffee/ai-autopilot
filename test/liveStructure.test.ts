// Regression tests against the live ChatGPT structure captured by probe v2
// (owner, 2026-11-09): see test/fixtures/liveStructure.ts. Tests marked
// SYNTHETIC use structures that were NOT captured (e.g. a second answer part)
// and check only that unknown shapes fail safe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { observePage } from '../src/content/page.ts';
import { DEFAULT_SELECTORS, type SelectorConfig } from '../src/content/selectors.ts';
import { readStatusMarker } from '../src/content/statusMarker.ts';
import { collectDiagnostic } from '../src/content/diagnostics.ts';
import { answerRoot, assistantTurn, codeBlock, page, paragraph, type Spec } from './fixtures/liveStructure.ts';
import { fakeDocument, reads } from './helpers/fakeDom.ts';

const URL = 'https://chatgpt.com/c/abc';
const M4 = '11111111-aaaa-4bbb-8ccc-000000000004';
const M5 = 'a93353e3-acc2-42db-a7b5-7201c8c878cd';
const ON = { readMarker: true };
const COMPLETE = 'AUTOPILOT STATUS: MILESTONE COMPLETE';
const observe = (doc: ReturnType<typeof fakeDocument>, selectors: SelectorConfig = DEFAULT_SELECTORS, options: { readMarker?: boolean } = ON) => observePage(doc as never, URL, selectors, options);
const ordinary = (lastLine: string): Spec[] => [paragraph('An ordinary answer.'), codeBlock('npm run check'), paragraph(lastLine)];
/** The selector set before this fix, to show what went wrong. */
const PREVIOUS: SelectorConfig = {
  ...DEFAULT_SELECTORS,
  assistantMessage: ['[data-conversation-role="assistant"]', '[data-message-author-role="assistant"]'],
  messageIdAttributes: ['data-message-id'],
  answerContent: ['.markdown'],
};

// --- Message identification ---

test('live: the latest assistant message is the unit, not its hidden h4 heading; its key uses the message id', () => {
  const doc = fakeDocument(page([assistantTurn(4, M4), assistantTurn(5, M5)]));
  const o = observe(doc);
  assert.equal(o.status, 'complete');
  assert.equal(o.signals.assistantMessageCount, 2);
  assert.equal(o.responseKey, `/c/abc|id:${M5}`);
});

test('live, previous selectors: the heading was matched, the key was count-based and the answer could not be found (M3-L0)', () => {
  const doc = fakeDocument(page([assistantTurn(4, M4), assistantTurn(5, M5, { blocks: ordinary(COMPLETE) })]));
  const o = observe(doc, PREVIOUS);
  assert.equal(o.responseKey, '/c/abc|n:2');
  assert.equal(o.signals.statusMarker, 'unclear');
  assert.equal(o.signals.answerContentElements, 0);
});

test('live: the response key no longer depends on how many turns ChatGPT renders', () => {
  const visible = observe(fakeDocument(page([assistantTurn(3, 'm3'), assistantTurn(4, M4), assistantTurn(5, M5)])));
  const fewer = observe(fakeDocument(page([assistantTurn(3, 'm3', { hidden: true }), assistantTurn(4, M4, { hidden: true }), assistantTurn(5, M5)])));
  assert.equal(visible.signals.assistantMessageCount, 3);
  assert.equal(fewer.signals.assistantMessageCount, 1);
  assert.equal(visible.responseKey, fewer.responseKey, 'same response, same key');
  // With the previous selectors the same response got different keys, and a new answer could reuse an answered one.
  const before = observe(fakeDocument(page([assistantTurn(3, 'm3'), assistantTurn(4, M4), assistantTurn(5, M5)])), PREVIOUS);
  const after = observe(fakeDocument(page([assistantTurn(3, 'm3', { hidden: true }), assistantTurn(4, M4), assistantTurn(5, M5)])), PREVIOUS);
  assert.notEqual(before.responseKey, after.responseKey);
});

// --- Answer isolation ---

test('live: exactly one answer-content element; the marker on its last line is found', () => {
  const doc = fakeDocument(page([assistantTurn(4, M4, { blocks: ordinary('AUTOPILOT STATUS: BLOCKED') }), assistantTurn(5, M5, { blocks: ordinary(COMPLETE) })]));
  const o = observe(doc);
  assert.equal(o.signals.answerContentElements, 1);
  assert.equal(o.signals.statusMarker, 'complete', 'the latest answer decides, not the older BLOCKED one');
  for (const line of ['AUTOPILOT STATUS: CONTINUE', 'AUTOPILOT STATUS: BLOCKED']) {
    assert.equal(observe(fakeDocument(page([assistantTurn(5, M5, { blocks: ordinary(line) })]))).signals.statusMarker, line.endsWith('CONTINUE') ? 'continue' : 'blocked');
  }
  assert.equal(observe(fakeDocument(page([assistantTurn(5, M5)]))).signals.statusMarker, 'none', 'an ordinary answer');
});

test('live: a marker inside a code-block widget, its label bar, the hidden heading or hidden spans is never read as the answer', () => {
  const cases: AnswerCase[] = [
    { name: 'code-block widget', blocks: [paragraph('Example:'), codeBlock(COMPLETE)] },
    { name: 'code-block label (data-markdown-copy="exclude")', blocks: [paragraph('Example:'), codeBlock('echo', COMPLETE)] },
    { name: 'inline code', blocks: [paragraph('Write ', { tag: 'code', attrs: { 'data-d-component': 'code' }, children: [{ tag: '#text', text: COMPLETE }] })] },
  ];
  for (const c of cases) assert.equal(observe(fakeDocument(page([assistantTurn(5, M5, { blocks: c.blocks })]))).signals.statusMarker, 'none', c.name);
  assert.equal(observe(fakeDocument(page([assistantTurn(5, M5, { headingText: COMPLETE })]))).signals.statusMarker, 'none', 'the sr-only heading is outside the answer content');
  // The code-block widget does not count as the last line: the paragraph after it does.
  assert.equal(observe(fakeDocument(page([assistantTurn(5, M5, { blocks: [paragraph(COMPLETE), codeBlock('npm test')] })]))).signals.statusMarker, 'complete');
});
interface AnswerCase { name: string; blocks: Spec[] }

test('SYNTHETIC: two answer-content parts in one message (e.g. a tool or thinking part rendered the same way) → unclear, nothing read', () => {
  reads.text = 0;
  const two = assistantTurn(5, M5, { contentRoots: [answerRoot(M5, [paragraph('Part one')]), answerRoot(M5, [paragraph(COMPLETE)])] });
  const o = observe(fakeDocument(page([two])));
  assert.equal(o.signals.statusMarker, 'unclear');
  assert.equal(o.signals.answerContentElements, 2);
  assert.equal(reads.text, 0);
});

test('SYNTHETIC: a message without answer content (e.g. only a tool or sources section) → unclear, nothing read', () => {
  reads.text = 0;
  const none = assistantTurn(5, M5, { contentRoots: [], extraInMessage: [{ tag: 'div', attrs: { 'data-testid': 'sources' }, children: [{ tag: '#text', text: COMPLETE }] }] });
  const o = observe(fakeDocument(page([none])));
  assert.equal(o.signals.statusMarker, 'unclear');
  assert.equal(o.signals.answerContentElements, 0);
  assert.equal(reads.text, 0);
});

test('SYNTHETIC: a sources or tool section beside the answer content is not read', () => {
  const beside = assistantTurn(5, M5, { blocks: ordinary('Last line of the answer.'), extraInMessage: [{ tag: 'div', attrs: { 'data-testid': 'sources' }, children: [{ tag: '#text', text: COMPLETE }] }] });
  assert.equal(observe(fakeDocument(page([beside]))).signals.statusMarker, 'none');
});

test('live: an alert inside the answer content is conversation text, not an unrecognized page notice', () => {
  const withAlert = assistantTurn(5, M5, { blocks: [paragraph('x'), { tag: 'div', attrs: { role: 'alert' }, children: [{ tag: '#text', text: 'inline notice text' }] }] });
  assert.equal(observe(fakeDocument(page([withAlert]))).signals.unrecognizedNoticeFound, false);
});

test('SYNTHETIC: an error notice inside the assistant turn but outside the answer content is still detected', () => {
  const errorInTurn = assistantTurn(5, M5, { extraInMessage: [{ tag: 'div', attrs: { role: 'alert' }, children: [{ tag: '#text', text: 'Something went wrong while generating the response.' }] }] });
  const o = observe(fakeDocument(page([errorInTurn])));
  assert.equal(o.signals.errorNoticeFound, true);
  assert.equal(o.status, 'error');
  const unknownInTurn = assistantTurn(5, M5, { extraInMessage: [{ tag: 'div', attrs: { role: 'alert' }, children: [{ tag: '#text', text: '[aviso sintetico]' }] }] });
  assert.equal(observe(fakeDocument(page([unknownInTurn]))).signals.unrecognizedNoticeFound, true);
});

// --- Privacy and scope ---

test('live: with the setting off nothing is read; with it on, no answer or label text leaves the reader', () => {
  const doc = fakeDocument(page([assistantTurn(5, M5, { blocks: ordinary(COMPLETE), headingText: 'SECRET-LABEL' })]));
  reads.text = 0;
  const off = observe(doc, DEFAULT_SELECTORS, {});
  assert.equal(off.signals.statusMarker, 'none');
  assert.equal(reads.text, 0);
  const on = observe(doc);
  const json = JSON.stringify([on, collectDiagnostic(doc as never, on)]);
  for (const word of ['ordinary answer', 'npm run check', 'SECRET-LABEL', 'AUTOPILOT STATUS']) assert.ok(!json.includes(word), word);
});

test('live: while the turn is still streaming (stop control shown) the answer is not read', () => {
  const doc = fakeDocument(page([assistantTurn(5, M5, { blocks: ordinary(COMPLETE) })], { generating: true }));
  reads.text = 0;
  const o = observe(doc);
  assert.equal(o.status, 'generating');
  assert.equal(o.signals.statusMarker, 'none');
  assert.equal(reads.text, 0);
});

test('the reader on the captured content root directly', () => {
  const doc = fakeDocument(page([assistantTurn(5, M5, { blocks: ordinary(COMPLETE) })]));
  const unit = doc.documentElement.find('[data-content-search-unit-key$=":assistant"]');
  assert.deepEqual(readStatusMarker(unit as never, DEFAULT_SELECTORS.answerContent), { marker: 'complete', contentElements: 1 });
});
