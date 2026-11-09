// ChatGPT Autopilot: answer-structure probe (M3-L0). Paste into the DevTools
// console of your ChatGPT tab while the latest answer is finished. It prints
// the element structure of the latest assistant message, so the element that
// holds the visible answer content can be identified from evidence.
//
// Printed: tag names, class names, role/aria-hidden/hidden, data-* attribute
// names, visibility, box size and TEXT LENGTHS (numbers). Never printed: any
// text. Attribute and class values are shown only when they look like
// identifier tokens (letters, digits, - _ : .), otherwise as "<omitted>".
(() => {
  const ASSISTANT = ['[data-conversation-role="assistant"]', '[data-message-author-role="assistant"]'];
  const MAX_NODES = 250, MAX_DEPTH = 12;
  const token = (v) => (typeof v === 'string' && /^[\w:.\-]{1,60}$/.test(v) ? v : v == null ? null : '<omitted>');
  const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : null);
  // The extension's own rule: the first selector that matches defines the list; the last element is the latest.
  let messages = [], selectorUsed = null;
  for (const s of ASSISTANT) { const found = Array.from(document.querySelectorAll(s)).filter((e) => visible(e) !== false); if (found.length) { messages = found; selectorUsed = s; break; } }
  const latest = messages[messages.length - 1];
  if (!latest) return console.log('[ChatGPT Autopilot] answer probe: no assistant message found'), 'none';
  const nodes = [];
  const walk = (el, depth, path) => {
    if (nodes.length >= MAX_NODES || depth > MAX_DEPTH) return;
    const box = el.getBoundingClientRect();
    let ownText = 0;
    for (const c of el.childNodes) if (c.nodeType === 3) ownText += c.nodeValue.trim().length;
    const data = {};
    for (const a of el.attributes) if (a.name.startsWith('data-')) data[a.name] = token(a.value);
    nodes.push({
      path, depth, tag: el.tagName.toLowerCase(),
      classes: Array.from(el.classList).slice(0, 12).map(token),
      role: token(el.getAttribute('role')), ariaHidden: el.getAttribute('aria-hidden'), hidden: el.hidden || undefined,
      data, visible: visible(el), box: [Math.round(box.width), Math.round(box.height)],
      children: el.children.length, ownTextLength: ownText, textLength: (el.innerText || '').trim().length,
    });
    Array.from(el.children).forEach((c, i) => walk(c, depth + 1, `${path}.${i}`));
  };
  walk(latest, 0, '0');
  const report = { probe: 'answer-structure', version: 1, selectorUsed, assistantMessages: messages.length, nodesShown: nodes.length, nodes };
  console.log('[ChatGPT Autopilot] answer probe', report);
  return JSON.stringify(report);
})();
