// Reads the explicit status marker at the end of the latest finished answer
// (M3; design: docs/design/m3-stop-protocol.md, approved 2026-11-06).
//
// Privacy guarantee (R10): the visible answer text is read only temporarily,
// inside readStatusMarker, to compare its last line with three fixed lines. It
// is never persisted, transmitted, logged or retained in application state:
// it lives only in local variables of this function call, and only the result
// of the comparison (one of five words) and a count of answer-content elements
// are returned. This module keeps no state at all (no module-level `let`;
// enforced by test/privacy.test.ts).
//
// The caller must only call it when "Stop on status marker" is on and the page
// shows a finished answer; with the setting off the answer is never read.

export type StatusMarker = 'none' | 'continue' | 'complete' | 'blocked' | 'unclear';

/** The three exact marker lines (the convention of templates/AUTOPILOT.md). */
export const MARKER_LINES: Readonly<Record<string, Exclude<StatusMarker, 'none' | 'unclear'>>> = Object.freeze({
  'AUTOPILOT STATUS: CONTINUE': 'continue',
  'AUTOPILOT STATUS: MILESTONE COMPLETE': 'complete',
  'AUTOPILOT STATUS: BLOCKED': 'blocked',
});

/** A line starting with this (any letter case) is a marker attempt: valid only if exactly one of MARKER_LINES. */
const MARKER_PREFIX = 'autopilot status:';

/** Subtrees that are never read: quoted/code text, interface controls and labels, non-content elements. */
const SKIPPED_TAGS: ReadonlySet<string> = new Set([
  'PRE', 'CODE', 'BLOCKQUOTE',
  'BUTTON', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'NAV',
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT',
]);
const SKIPPED_ROLES: ReadonlySet<string> = new Set(['button', 'status', 'alert']);
/** Elements that end a line. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'HR', 'BR', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'FIGURE',
]);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** The minimal DOM surface the reader uses; real DOM nodes satisfy it. */
export interface MarkerNode {
  nodeType: number;
  nodeValue?: string | null;
  childNodes?: ArrayLike<MarkerNode>;
  tagName?: string;
  open?: boolean;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  checkVisibility?(): boolean;
  getBoundingClientRect?(): { width: number; height: number };
  querySelectorAll?(selector: string): ArrayLike<MarkerNode>;
}

export interface MarkerReading {
  marker: StatusMarker;
  /** How many visible answer-content elements were found (structure only, for diagnostics). */
  contentElements: number;
}

/** Visible in the sense of R9. Throws if visibility cannot be determined, which the caller turns into `unclear`. */
function rendered(element: MarkerNode): boolean {
  if (typeof element.checkVisibility !== 'function') throw new Error('visibility unknown');
  if (!element.checkVisibility()) return false;
  if (typeof element.getBoundingClientRect === 'function') {
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return false; // screen-reader-only box
  }
  return true;
}

function skipped(element: MarkerNode): boolean {
  const tag = (element.tagName ?? '').toUpperCase();
  if (SKIPPED_TAGS.has(tag)) return true;
  if (tag === 'DETAILS' && element.open !== true) return true; // collapsed section
  const attr = (name: string) => element.getAttribute?.(name) ?? null;
  if (element.hasAttribute?.('hidden') || attr('hidden') !== null) return true;
  if (attr('aria-hidden') === 'true') return true;
  const role = attr('role');
  if (role !== null && SKIPPED_ROLES.has(role)) return true;
  return !rendered(element);
}

/** The visible answer-content element, if exactly one matches (R9). */
function answerContent(message: MarkerNode, selectors: readonly string[]): { element: MarkerNode | null; count: number } {
  if (typeof message.querySelectorAll !== 'function') return { element: null, count: 0 };
  const found: MarkerNode[] = [];
  for (const selector of selectors) {
    for (const candidate of Array.from(message.querySelectorAll(selector))) {
      if (!found.includes(candidate) && rendered(candidate)) found.push(candidate);
    }
  }
  return { element: found.length === 1 ? found[0]! : null, count: found.length };
}

/** Appends the visible text of a subtree to `out`, one entry per piece; '\n' separates blocks. */
function collect(node: MarkerNode, out: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    out.push(node.nodeValue ?? '');
    return;
  }
  if (node.nodeType !== ELEMENT_NODE || skipped(node)) return;
  const block = BLOCK_TAGS.has((node.tagName ?? '').toUpperCase());
  if (block) out.push('\n');
  for (const child of Array.from(node.childNodes ?? [])) collect(child, out);
  if (block) out.push('\n');
}

/** The comparison on lines that only ever exist inside readStatusMarker. */
function classify(lines: string[]): StatusMarker {
  const nonEmpty = lines.map((line) => line.replace(/ /g, ' ').trim()).filter((line) => line.length > 0);
  if (nonEmpty.length === 0) return 'none';
  const attempts = nonEmpty.map((line, index) => (line.toLowerCase().startsWith(MARKER_PREFIX) ? index : -1)).filter((index) => index >= 0);
  if (attempts.length === 0) return 'none';
  const lastIndex = nonEmpty.length - 1;
  // Exactly one marker line, it is the last line, and it is exactly one of the three.
  if (attempts.length !== 1 || attempts[0] !== lastIndex) return 'unclear';
  return MARKER_LINES[nonEmpty[lastIndex]!] ?? 'unclear';
}

/**
 * The status marker of the latest finished assistant answer.
 * `message` is that answer's message element; `contentSelectors` find the
 * answer content inside it. Anything unexpected gives `unclear`, never a guess.
 */
export function readStatusMarker(message: MarkerNode, contentSelectors: readonly string[]): MarkerReading {
  let count = 0;
  try {
    const content = answerContent(message, contentSelectors);
    count = content.count;
    if (!content.element) return { marker: 'unclear', contentElements: count };
    const pieces: string[] = [];
    collect(content.element, pieces);
    return { marker: classify(pieces.join('').split('\n')), contentElements: count };
  } catch {
    return { marker: 'unclear', contentElements: count };
  }
}
