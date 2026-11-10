// The live ChatGPT answer structure captured by docs/answer-structure-probe.js
// v2 (owner, 2026-11-09, es-ES), reproduced with the same tags, data-*
// attributes, roles and nesting. Texts are synthetic (the probe never captures
// text). Rendered two ways: a fake DOM (unit tests) and HTML (E2E).
//
// Captured (path from the probe in brackets):
//   div[data-turn-key] (up 7) > div[data-content-search-turn-key] (up 6)
//   > div.flex (up 5) > div.group[data-talvt-turn-state="complete"] (up 4)
//   > div.flex (up 3) > div.block-BQZwFn (up 2, display:contents)
//   > UNIT div[data-content-search-unit-key="fallback-turn-N:1:assistant"] (up 1)
//       h4.sr-only[data-conversation-role="assistant"] (0.0)  ← the old match
//         span (13 chars), span.hidden[aria-hidden="true"] (7 chars)
//       div > div.group[data-chatgpt-selection-message-id=M] (0.1.0)
//         span[hidden]
//         div.MarkdownRoot[data-markdown-text-style="assistant-message"] (0.1.0.1)
//           div[data-dil-source-message-id=M][data-markdown-copy="contents"]
//             div > div[hidden], div.Renderer > div.DilResponseRoot[data-dil-message-id=M]
//               p / h3 / ol>li / ul>li with span runs, inline code, and
//               div[data-client-defined-widget="code_block"] > div.CodeBlock
//                 > div[data-code-block="true"]
//                     div.ActionBar[data-markdown-copy="exclude"] (svg, 4-char label, buttons)
//                     div (code text)
//         div.contents (empty)
// Not captured (marked SYNTHETIC where used): user turns, and what a tool,
// sources or thinking section looks like.

export type Style = 'sr-only' | 'hidden' | 'contents';
export interface Spec { tag: string; attrs?: Record<string, string>; style?: Style; text?: string; children?: Spec[] }

const s = (tag: string, attrs: Record<string, string> = {}, children: (Spec | string)[] = [], style?: Style): Spec => ({
  tag, attrs, style, children: children.map((c) => (typeof c === 'string' ? { tag: '#text', text: c } : c)),
});

const run = (text: string) => s('span', { 'data-d-text-flow': 'run' }, [text]);
const para = (...runs: (Spec | string)[]) => s('p', { class: 'TextBase-hXhSqg Text-lIMP0_', 'data-d-component': 'text' }, runs.map((r) => (typeof r === 'string' ? run(r) : r)));

/** A captured-style code-block widget: label in an excluded ActionBar, the code in plain divs (no pre/code). */
export const codeBlock = (code: string, label = 'bash') =>
  s('div', { 'data-client-defined-widget': 'code_block' }, [
    s('div', { class: 'CodeBlock-zu1QM3' }, [
      s('div', { 'data-code-block': 'true', 'data-markdown-copy': 'code-block', 'data-theme': 'dark' }, [
        s('div', { class: 'ActionBar-KWWAct', 'data-markdown-copy': 'exclude' }, [
          s('svg', { class: 'Icon-X4VkKC', 'aria-hidden': 'true' }),
          s('div', { class: 'min-w-0 truncate flex-1' }, [label]),
          s('div', { class: 'ms-auto flex' }, [s('div', { role: 'presentation', 'data-code-block-controls': 'true' }, [s('button', { 'data-state': 'closed' }), s('button', { 'data-state': 'closed' })])]),
        ]),
        s('div', { class: 'relative' }, [s('div', { class: 'InlineCodePane-EYx4bd' }, [s('div', { class: 'Viewer-ALA646' }, [s('div', { class: 'chatgpt-code-scrollport' }, [code])])])]),
      ]),
    ]),
  ]);

export interface AnswerOptions {
  /** Blocks of the rendered response, in order (default: an ordinary answer). */
  blocks?: Spec[];
  /** SYNTHETIC: extra elements inside the message group, beside the answer content. */
  extraInMessage?: Spec[];
  /** Replace the answer content root entirely (SYNTHETIC structures, e.g. none or two). */
  contentRoots?: Spec[];
  /** Hidden (display:none) like turns ChatGPT stops rendering. */
  hidden?: boolean;
  headingText?: string;
}

/** The answer content root, as captured. */
export const answerRoot = (messageId: string, blocks: Spec[]) =>
  s('div', { class: 'MarkdownRoot-rZKhxa', 'data-markdown-text-style': 'assistant-message', 'data-selected-text-overlay-target': '_r_km_' }, [
    s('div', { class: 'my-4', 'data-dil-source-message-id': messageId, 'data-chatgpt-copy-reference': '1', 'data-markdown-copy': 'contents' }, [
      s('div', {}, [
        s('div', { hidden: '' }),
        s('div', { class: 'relative PortalBoundary-TFj9W2 Renderer-ojZscX', 'data-theme': 'dark' }, [
          s('div', { class: 'DilRenderer-tB76Jj DilResponseRoot-HfQrEh', 'data-d-direction': 'col', 'data-dil-message-id': messageId }, blocks),
        ]),
      ]),
    ]),
  ]);

/** One assistant turn with the captured structure. */
export function assistantTurn(turn: number, messageId: string, options: AnswerOptions = {}): Spec {
  const blocks = options.blocks ?? [
    para('First paragraph of the answer, ', s('code', { class: 'Code-kbs71c', 'data-d-component': 'code' }, [run('npm test')]), ' and more.'),
    s('h3', { 'data-d-component': 'title' }, [run('A heading')]),
    s('ol', { 'data-d-component': 'list' }, [s('li', { 'data-d-component': 'list-item' }, [s('div', {}, [s('div', {}, [para('First item')])])])]),
    codeBlock('npm run check'),
    para('Last paragraph of the answer.'),
  ];
  const unitKey = `fallback-turn-${turn}:1:assistant`;
  return s('div', { 'data-turn-key': `turn-${turn}` }, [
    s('div', { 'data-content-search-turn-key': `fallback-turn-${turn}` }, [
      s('div', { class: 'flex flex-col gap-1.5' }, [
        s('div', { class: 'group flex flex-col', 'data-talvt-turn-state': 'complete' }, [
          s('div', { class: 'flex flex-col gap-3' }, [
            s('div', { class: 'block-BQZwFn' }, [
              s('div', { 'data-content-search-unit-key': unitKey, 'data-chatgpt-search-unit-key': unitKey }, [
                s('h4', { class: 'sr-only m-0 select-none', 'data-conversation-role': 'assistant' }, [
                  s('span', {}, [options.headingText ?? 'ChatGPT said:']), s('span', { class: 'hidden', 'aria-hidden': 'true' }, ['(label)']),
                ], 'sr-only'),
                s('div', {}, [
                  s('div', { class: 'group flex min-w-0 flex-col', 'data-chatgpt-selection-conversation-id': 'conv-1', 'data-chatgpt-selection-message-id': messageId }, [
                    s('span', { hidden: '' }),
                    ...(options.contentRoots ?? [answerRoot(messageId, blocks)]),
                    ...(options.extraInMessage ?? []),
                  ]),
                ]),
                s('div', { class: 'contents' }, [], 'contents'),
              ]),
            ], 'contents'),
          ]),
        ], options.hidden ? 'hidden' : undefined),
      ]),
    ]),
  ]);
}

export const paragraph = para;

/** A page: SYNTHETIC user headings (not captured), the given assistant turns, a composer and a send control. */
export function page(turns: Spec[], options: { generating?: boolean } = {}): Spec {
  return s('html', { lang: 'es-ES' }, [
    s('body', {}, [
      s('main', { id: 'thread' }, turns),
      s('form', {}, [
        s('div', { id: 'prompt-textarea', contenteditable: 'true', class: 'ProseMirror' }),
        options.generating ? s('button', { 'data-testid': 'stop-button', 'aria-label': 'Detener' }) : s('button', { 'aria-label': 'Enviar', type: 'submit' }),
      ]),
    ]),
  ]);
}

// ---- Rendering: HTML (E2E) -------------------------------------------------

export const FIXTURE_CSS = '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.hidden{display:none}.contents,.block-BQZwFn{display:contents}';

const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toHtml(spec: Spec): string {
  if (spec.tag === '#text') return escape(spec.text ?? '');
  const attrs = Object.entries(spec.attrs ?? {}).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escape(v)}"`)).join('');
  const style = spec.style === 'hidden' ? ' style="display:none"' : '';
  return `<${spec.tag}${attrs}${style}>${(spec.children ?? []).map(toHtml).join('')}</${spec.tag}>`;
}
