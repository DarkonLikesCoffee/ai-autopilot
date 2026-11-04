// ChatGPT Autopilot: send-button probe. Paste into the DevTools console of your
// ChatGPT tab. Prints structure only: no message text, no message-box text, no
// button text. Same fields as the extension's "Send step" diagnostics.
(() => {
  const SEND = ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]', 'button[aria-label="Enviar"]'];
  const COMPOSER = ['#prompt-textarea', 'textarea[name="prompt-textarea"]', 'form [contenteditable="true"][role="textbox"]', 'form textarea'];
  const ATTRS = ['data-testid', 'id', 'aria-label', 'aria-disabled', 'type', 'data-state'];
  const visible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true);
  const describe = (el) => {
    const attributes = {};
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v !== null) attributes[a] = v.slice(0, 60); }
    return { tag: el.tagName.toLowerCase(), visible: visible(el), disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', attributes };
  };
  const all = (root, sel) => { try { return Array.from(root.querySelectorAll(sel)); } catch { return []; } };
  let composer = null;
  for (const sel of COMPOSER) { composer = all(document, sel).find(visible) || null; if (composer) break; }
  const text = composer ? (composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText || '') : '';
  const hidden = all(document, 'textarea[name="prompt-textarea"]').find((t) => t !== composer);
  let container = composer && (composer.closest('form') || composer.parentElement);
  for (let i = 0; container && !container.closest('form') && i < 6 && all(container, 'button').length === 0; i += 1) container = container.parentElement;
  const report = {
    composer: composer && {
      tag: composer.tagName.toLowerCase(), id: composer.id || null, proseMirror: composer.classList.contains('ProseMirror'),
      focused: document.activeElement === composer, textLength: text.length, paragraphs: all(composer, 'p').length,
      hiddenTextarea: hidden ? { valueLength: hidden.value.length } : null,
    },
    sendSelectors: SEND.map((selector) => ({ selector, matches: all(document, selector).slice(0, 5).map(describe) })),
    nearbyButtons: container ? all(container, 'button').slice(0, 15).map(describe) : [],
    uiLanguage: document.documentElement.lang || null,
  };
  console.log('[ChatGPT Autopilot] send probe', report);
  return JSON.stringify(report, null, 2);
})();
