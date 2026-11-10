// A small DOM for unit tests built from test/fixtures/liveStructure.ts specs:
// selector matching (tag, #id, .class, [a], [a="v"], [a$="v"], [a^="v"],
// [a*="v"], comma lists, the descendant combinator), visibility semantics
// (hidden attribute, display:none and the `hidden` class hide the subtree;
// display:contents elements report not visible; sr-only boxes are 1x1), and a
// counter of text reads.

import type { Spec } from '../fixtures/liveStructure.ts';

export const reads = { text: 0 };

type Part = { kind: 'tag' | 'id' | 'class'; value: string } | { kind: 'attr'; name: string; op: '' | '=' | '$=' | '^=' | '*='; value: string };

function parseCompound(selector: string): Part[] | null {
  const parts: Part[] = [];
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w:-]+)|\[([\w-]+)(?:(\$=|\^=|\*=|=)"([^"]*)")?\]/y;
  let i = 0;
  while (i < selector.length) {
    re.lastIndex = i;
    const m = re.exec(selector);
    if (!m) return null;
    if (m[1]) parts.push({ kind: 'tag', value: m[1].toUpperCase() });
    else if (m[2]) parts.push({ kind: 'id', value: m[2] });
    else if (m[3]) parts.push({ kind: 'class', value: m[3] });
    else parts.push({ kind: 'attr', name: m[4]!, op: (m[5] ?? '') as '', value: m[6] ?? '' });
    i = re.lastIndex;
  }
  return parts;
}

export class FakeText {
  nodeType = 3;
  parentElement: FakeElement | null = null;
  private readonly value: string;
  constructor(value: string) { this.value = value; }
  get nodeValue() { reads.text += 1; return this.value; }
  raw() { return this.value; }
}

export class FakeElement {
  nodeType = 1;
  tagName: string;
  attrs: Record<string, string>;
  style: Spec['style'];
  childNodes: (FakeElement | FakeText)[] = [];
  parentElement: FakeElement | null = null;
  constructor(spec: Spec) {
    this.tagName = spec.tag.toUpperCase();
    this.attrs = { ...(spec.attrs ?? {}) };
    this.style = spec.style;
    for (const c of spec.children ?? []) {
      const node = c.tag === '#text' ? new FakeText(c.text ?? '') : new FakeElement(c);
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }
  get children() { return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement); }
  get classList() { return { contains: (c: string) => (this.attrs.class ?? '').split(/\s+/).includes(c) }; }
  get id() { return this.attrs.id ?? ''; }
  get open() { return 'open' in this.attrs; }
  get hidden() { return 'hidden' in this.attrs; }
  getAttribute(name: string) { return name in this.attrs ? this.attrs[name]! : null; }
  hasAttribute(name: string) { return name in this.attrs; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  private displayNone() { return this.hidden || this.style === 'hidden' || this.classList.contains('hidden'); }
  private srOnly(): boolean { for (let n: FakeElement | null = this; n; n = n.parentElement) if (n.style === 'sr-only') return true; return false; }
  checkVisibility() {
    if (this.style === 'contents') return false;
    for (let n: FakeElement | null = this; n; n = n.parentElement) if (n.displayNone()) return false;
    return true;
  }
  getBoundingClientRect() {
    if (!this.checkVisibility()) return { width: 0, height: 0 };
    return this.srOnly() ? { width: 1, height: 1 } : { width: 400, height: 20 };
  }
  get textContent(): string { return this.childNodes.map((c) => (c instanceof FakeText ? c.raw() : c.textContent)).join(''); }
  get innerText(): string { return this.checkVisibility() || this.style === 'contents' ? this.childNodes.map((c) => (c instanceof FakeText ? c.raw() : c.innerText)).join('') : ''; }
  private matchesCompound(parts: Part[]): boolean {
    return parts.every((p) => {
      if (p.kind === 'tag') return this.tagName === p.value;
      if (p.kind === 'id') return this.id === p.value;
      if (p.kind === 'class') return this.classList.contains(p.value);
      if (p.kind !== 'attr') return false;
      const v = this.getAttribute(p.name);
      if (v === null) return false;
      return p.op === '' ? true : p.op === '=' ? v === p.value : p.op === '$=' ? v.endsWith(p.value) : p.op === '^=' ? v.startsWith(p.value) : v.includes(p.value);
    });
  }
  matches(selector: string): boolean {
    return selector.split(',').some((one) => {
      const chain = one.trim().split(/\s+/).map(parseCompound);
      if (chain.some((c) => c === null)) return false;
      const [last, ...ancestors] = [...chain].reverse() as Part[][];
      if (!this.matchesCompound(last!)) return false;
      let node: FakeElement | null = this.parentElement;
      for (const parts of ancestors) {
        while (node && !node.matchesCompound(parts)) node = node.parentElement;
        if (!node) return false;
        node = node.parentElement;
      }
      return true;
    });
  }
  descendants(): FakeElement[] { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  querySelectorAll(selector: string): FakeElement[] { return this.descendants().filter((e) => e.matches(selector)); }
  closest(selector: string): FakeElement | null { for (let n: FakeElement | null = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  find(selector: string): FakeElement { const f = this.querySelectorAll(selector); if (!f[0]) throw new Error(`no ${selector}`); return f[f.length - 1]!; }
}

/** A document-like root over a page spec. */
export function fakeDocument(spec: Spec) {
  const documentElement = new FakeElement(spec);
  return {
    documentElement,
    querySelectorAll: (selector: string) => [documentElement, ...documentElement.descendants()].filter((e) => e.matches(selector)),
  };
}
