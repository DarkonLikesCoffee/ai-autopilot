// ChatGPT Autopilot: answer-structure probe, version 2 (M3-L0). Paste into the
// DevTools console of your ChatGPT tab while the latest answer is finished.
//
// Version 1 showed that the extension's assistant selector matches a visually
// hidden heading. This version also walks UP from that match to the turn that
// contains it, and reports the structure of the whole turn, so the element
// holding the visible answer content can be identified from evidence.
//
// Printed: tag names, class names, role/aria-hidden/hidden, data-* attribute
// names, visibility, box size, which candidate selectors match each element,
// and TEXT LENGTHS (numbers). Never printed: any text. Attribute and class
// values are shown only when they look like identifier tokens (letters, digits,
// - _ : .), otherwise as "<omitted>".
(() => {
  const ASSISTANT = ['[data-content-search-unit-key$=":assistant"]', '[data-conversation-role="assistant"]', '[data-message-author-role="assistant"]'];
  // Structural candidates to locate, not to adopt: every match is reported so the choice rests on evidence.
  const CANDIDATES = [...ASSISTANT, '[data-markdown-text-style="assistant-message"]', '[data-chatgpt-selection-message-id]', '[data-message-id]', '[data-message-author-role]', '[data-conversation-role]', '[data-testid^="conversation-turn"]', 'article'];
  const MAX_NODES = 300, MAX_DEPTH = 14, MAX_UP = 8;
  const token = (v) => (typeof v === 'string' && /^[\w:.\-]{1,60}$/.test(v) ? v : v == null ? null : '<omitted>');
  const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : null);
  const textLength = (el) => (el.innerText || '').trim().length;
  const summary = (el) => {
    const box = el.getBoundingClientRect();
    const data = {};
    for (const a of el.attributes) if (a.name.startsWith('data-')) data[a.name] = token(a.value);
    let ownText = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) ownText += c.nodeValue.trim().length;
    return {
      tag: el.tagName.toLowerCase(),
      classes: Array.from(el.classList).slice(0, 12).map(token),
      role: token(el.getAttribute('role')), ariaHidden: el.getAttribute('aria-hidden'), hidden: el.hidden || undefined,
      data, visible: visible(el), box: [Math.round(box.width), Math.round(box.height)],
      children: el.children.length, ownTextLength: ownText, textLength: textLength(el),
      matches: CANDIDATES.map((s, i) => { try { return el.matches(s) ? i : -1; } catch { return -1; } }).filter((i) => i >= 0),
    };
  };
  const all = (root, s) => { try { return Array.from(root.querySelectorAll(s)); } catch { return []; } };

  // 1. Every candidate on the page: how many, and the latest one.
  const candidates = CANDIDATES.map((selector, index) => {
    const found = all(document, selector);
    const last = found[found.length - 1];
    return { index, selector, count: found.length, latest: last ? summary(last) : null };
  });

  // 2. The extension's own rule: the first assistant selector that matches defines the list.
  let matched = [], selectorUsed = null;
  for (const s of ASSISTANT) { const f = all(document, s).filter((e) => visible(e) !== false); if (f.length) { matched = f; selectorUsed = s; break; } }
  const latest = matched[matched.length - 1];
  if (!latest) return console.log('[ChatGPT Autopilot] answer probe: no assistant element found'), JSON.stringify({ probe: 'answer-structure', version: 2, candidates });

  // 3. Walk up from it, to find the turn: the nearest ancestor that contains more than the match itself,
  //    stopping before one that contains a second assistant match (that would be beyond this turn).
  const ancestors = [];
  let turn = null;
  for (let el = latest.parentElement, up = 1; el && up <= MAX_UP; el = el.parentElement, up += 1) {
    const s = summary(el);
    const assistantsInside = all(el, selectorUsed).length;
    ancestors.push({ up, assistantsInside, ...s });
    if (assistantsInside > 1) break;
    if (!turn && s.textLength > textLength(latest)) turn = { el, up };
  }

  // 4. The structure of that turn.
  const nodes = [];
  const walk = (el, depth, path) => {
    if (nodes.length >= MAX_NODES || depth > MAX_DEPTH) return;
    nodes.push({ path, depth, isExtensionMatch: el === latest || undefined, ...summary(el) });
    Array.from(el.children).forEach((c, i) => walk(c, depth + 1, `${path}.${i}`));
  };
  // If no ancestor qualifies (the match already holds the whole message, and its parent holds other
  // turns), the match's own subtree is the turn.
  walk(turn ? turn.el : latest, 0, '0');

  const report = {
    probe: 'answer-structure', version: 2, selectorUsed, extensionMatches: matched.length,
    candidates, ancestors, turnIsAncestorUp: turn ? turn.up : 0, nodesShown: nodes.length, truncated: nodes.length >= MAX_NODES, nodes,
  };
  console.log('[ChatGPT Autopilot] answer probe', report);
  return JSON.stringify(report);
})();
