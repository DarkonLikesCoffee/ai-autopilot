// The M3 status-marker reader (docs/design/m3-stop-protocol.md). A small fake
// DOM counts every text read, so "nothing was read" can be asserted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKER_LINES, readStatusMarker, type MarkerNode } from '../src/content/statusMarker.ts';
import { DEFAULT_SELECTORS } from '../src/content/selectors.ts';

const SEL = DEFAULT_SELECTORS.answerContent;
let textReads = 0;

interface Opts { visible?: boolean; box?: { width: number; height: number }; open?: boolean; noVisibilityApi?: boolean }

function text(value: string): MarkerNode {
  return { nodeType: 3, get nodeValue() { textReads += 1; return value; } };
}

function el(tag: string, attrs: Record<string, string> = {}, children: (MarkerNode | string)[] = [], opts: Opts = {}): MarkerNode {
  const kids = children.map((c) => (typeof c === 'string' ? text(c) : c));
  const node: MarkerNode & { classes: string[] } = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
    childNodes: kids,
    open: opts.open,
    getAttribute: (n) => attrs[n] ?? null,
    hasAttribute: (n) => n in attrs,
    ...(opts.noVisibilityApi ? {} : { checkVisibility: () => opts.visible !== false }),
    getBoundingClientRect: () => opts.box ?? { width: 300, height: 20 },
    querySelectorAll(selector: string) {
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      const all: MarkerNode[] = [];
      const walk = (n: MarkerNode) => {
        for (const c of Array.from(n.childNodes ?? [])) {
          if ((c as { classes?: string[] }).classes?.includes(cls ?? '\u0000')) all.push(c);
          walk(c);
        }
      };
      walk(node);
      return all;
    },
  };
  return node;
}

/** An assistant message whose answer content holds these blocks. */
const answer = (...blocks: (MarkerNode | string)[]) =>
  el('div', { 'data-message-author-role': 'assistant' }, [el('div', { class: 'markdown' }, blocks.map((b) => (typeof b === 'string' ? el('p', {}, [b]) : b)))]);

const read = (message: MarkerNode) => readStatusMarker(message, SEL).marker;

// --- Grammar ---

test('each of the three exact markers on the last line is detected', () => {
  assert.equal(read(answer('Done for today.', 'AUTOPILOT STATUS: CONTINUE')), 'continue');
  assert.equal(read(answer('All tasks verified.', 'AUTOPILOT STATUS: MILESTONE COMPLETE')), 'complete');
  assert.equal(read(answer('I need the API key.', 'AUTOPILOT STATUS: BLOCKED')), 'blocked');
  assert.deepEqual(Object.keys(MARKER_LINES).sort(), ['AUTOPILOT STATUS: BLOCKED', 'AUTOPILOT STATUS: CONTINUE', 'AUTOPILOT STATUS: MILESTONE COMPLETE']);
});

test('bold, surrounding whitespace and non-breaking spaces still match', () => {
  assert.equal(read(answer('x', el('p', {}, [el('strong', {}, ['AUTOPILOT STATUS: MILESTONE COMPLETE'])]))), 'complete');
  assert.equal(read(answer('x', '   AUTOPILOT STATUS: BLOCKED  \t')), 'blocked');
  assert.equal(read(answer('x', 'AUTOPILOT STATUS: CONTINUE')), 'continue');
  // Split across inline elements, as markdown rendering may do.
  assert.equal(read(answer('x', el('p', {}, ['AUTOPILOT STATUS: ', el('em', {}, ['MILESTONE COMPLETE'])]))), 'complete');
});

test('malformed marker lines pause (unclear): lowercase, punctuation, extra words, unknown status', () => {
  for (const line of [
    'autopilot status: milestone complete',
    'AUTOPILOT STATUS: MILESTONE COMPLETE.',
    'AUTOPILOT STATUS: COMPLETE',
    'AUTOPILOT STATUS: MILESTONE COMPLETE — great work',
    'AUTOPILOT STATUS: DONE',
    'AUTOPILOT STATUS:',
  ]) assert.equal(read(answer('x', line)), 'unclear', line);
});

test('no marker, an inline mention or a translation means none (normal continuation)', () => {
  assert.equal(read(answer('Here is the change.')), 'none');
  assert.equal(read(answer('When done I will write AUTOPILOT STATUS: MILESTONE COMPLETE on its own line.')), 'none');
  assert.equal(read(answer('x', 'ESTADO DE AUTOPILOT: COMPLETADO')), 'none');
  assert.equal(read(answer()), 'none', 'empty answer');
});

test('a marker that is not the last line, or two markers, pause (unclear)', () => {
  assert.equal(read(answer('AUTOPILOT STATUS: MILESTONE COMPLETE', 'One more thing to do.')), 'unclear');
  assert.equal(read(answer('AUTOPILOT STATUS: CONTINUE', 'AUTOPILOT STATUS: MILESTONE COMPLETE')), 'unclear');
  assert.equal(read(answer('AUTOPILOT STATUS: BLOCKED', 'AUTOPILOT STATUS: BLOCKED')), 'unclear', 'even the same marker twice');
  assert.equal(read(answer('autopilot status: maybe', 'AUTOPILOT STATUS: CONTINUE')), 'unclear', 'an earlier malformed attempt');
});

// --- Quoted text and interface elements (R9) ---

test('markers inside code, pre or blockquote never count', () => {
  assert.equal(read(answer('Example:', el('pre', {}, [el('code', {}, ['AUTOPILOT STATUS: MILESTONE COMPLETE'])]))), 'none');
  assert.equal(read(answer('x', el('p', {}, [el('code', {}, ['AUTOPILOT STATUS: BLOCKED'])]))), 'none');
  assert.equal(read(answer('You said:', el('blockquote', {}, [el('p', {}, ['AUTOPILOT STATUS: MILESTONE COMPLETE'])]))), 'none');
  // Quoted marker earlier, real marker last: the real one decides.
  assert.equal(read(answer(el('blockquote', {}, ['AUTOPILOT STATUS: CONTINUE']), 'AUTOPILOT STATUS: MILESTONE COMPLETE')), 'complete');
});

test('hidden, collapsed, screen-reader-only and interface subtrees are never read as answer text', () => {
  const marker = 'AUTOPILOT STATUS: MILESTONE COMPLETE';
  const hiddenCases: MarkerNode[] = [
    el('p', { hidden: '' }, [marker]),
    el('p', { 'aria-hidden': 'true' }, [marker]),
    el('p', {}, [marker], { visible: false }),
    el('span', {}, [marker], { box: { width: 1, height: 1 } }),
    el('details', {}, [el('summary', {}, ['Details']), el('p', {}, [marker])]),
    el('button', {}, [marker]),
    el('div', { role: 'button' }, [marker]),
    el('svg', {}, [marker]),
    el('label', {}, [marker]),
    el('nav', {}, [marker]),
    el('div', { role: 'status' }, [marker]),
    el('div', { role: 'alert' }, [marker]),
    el('script', {}, [marker]),
    el('textarea', {}, [marker]),
  ];
  for (const node of hiddenCases) {
    assert.equal(read(answer('Visible answer.', node)), 'none', `${node.tagName} ${JSON.stringify((node as { getAttribute: (n: string) => string | null }).getAttribute('role'))}`);
  }
  // An open details section is visible content.
  assert.equal(read(answer('x', el('details', {}, [el('summary', {}, ['More']), el('p', {}, [marker])], { open: true }))), 'complete');
  // A hidden marker plus a visible last line: the visible line decides.
  assert.equal(read(answer(el('p', { hidden: '' }, ['AUTOPILOT STATUS: CONTINUE']), 'AUTOPILOT STATUS: BLOCKED')), 'blocked');
});

test('if the answer content cannot be isolated, the result is unclear and no text is read', () => {
  textReads = 0;
  const noContent = el('div', { 'data-message-author-role': 'assistant' }, [el('p', {}, ['AUTOPILOT STATUS: MILESTONE COMPLETE'])]);
  assert.deepEqual(readStatusMarker(noContent, SEL), { marker: 'unclear', contentElements: 0 });
  const twoParts = el('div', {}, [el('div', { class: 'markdown' }, [el('p', {}, ['part one'])]), el('div', { class: 'markdown' }, [el('p', {}, ['AUTOPILOT STATUS: MILESTONE COMPLETE'])])]);
  assert.deepEqual(readStatusMarker(twoParts, SEL), { marker: 'unclear', contentElements: 2 });
  assert.equal(textReads, 0, 'not a single text node was read');
  // A hidden second content element does not count, so the visible one is read.
  const oneVisible = el('div', {}, [el('div', { class: 'markdown' }, [el('p', {}, ['AUTOPILOT STATUS: BLOCKED'])]), el('div', { class: 'markdown' }, [], { visible: false })]);
  assert.deepEqual(readStatusMarker(oneVisible, SEL), { marker: 'blocked', contentElements: 1 });
});

test('any doubt pauses: unknown visibility or an exception while reading gives unclear', () => {
  const noApi = el('div', {}, [el('div', { class: 'markdown' }, [el('p', {}, ['AUTOPILOT STATUS: CONTINUE'])], { noVisibilityApi: true })]);
  assert.equal(read(noApi), 'unclear');
  const throwing: MarkerNode = { nodeType: 1, tagName: 'DIV', querySelectorAll: () => { throw new Error('boom'); } };
  assert.equal(read(throwing), 'unclear');
});

// --- Privacy (R10, P6) ---

test('only the comparison result leaves the reader: no answer text in the result or the module', async () => {
  const secret = answer('SECRET-PROJECT-DETAILS the user wrote about', 'AUTOPILOT STATUS: MILESTONE COMPLETE');
  const result = readStatusMarker(secret, SEL);
  assert.deepEqual(Object.keys(result).sort(), ['contentElements', 'marker']);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  const mod = await import('../src/content/statusMarker.ts');
  assert.ok(!JSON.stringify(Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? 'fn' : v])).includes('SECRET'), 'nothing retained in the module');
});
