// Real-browser check of the built extension (dist/) in Chromium. chatgpt.com
// is replaced by a local fake page that mimics the parts of the ChatGPT
// interface the extension relies on: a contenteditable composer, a send
// button that is disabled while the composer is empty, streamed responses
// with a stop button (including a brief flicker mid-stream), usage-limit
// notices and in-app navigation. The test drives the real panel UI.
//
// Requires Playwright with Chromium (a pinned dev dependency; runs in CI as the
// "e2e" job). Run: npm run e2e
// This does not prove compatibility with the live ChatGPT site; it proves the
// extension's own behaviour end to end: detection, delay, insertion,
// submission, verification, safeguards, messaging and storage.

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantTurn, codeBlock, FIXTURE_CSS, paragraph, toHtml } from '../test/fixtures/liveStructure.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// EXTENSION_DIR: run against another build, e.g. the unzipped release ZIP (CI does this).
const extensionDir = process.env.EXTENSION_DIR ?? fileURLToPath(new URL('../dist', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'autopilot-e2e-'));
const PROMPT = 'E2E: continue working per AUTOPILOT.md.';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const FAKE_CHATGPT = `<!doctype html><html><head><meta charset="utf-8"><title>Fake ChatGPT</title></head><body>
<main id="thread"></main>
<div id="notices"></div>
<form id="composer-form" onsubmit="if (window.__spanish) window.__send(); return false">
  <div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:40px;border:1px solid #ccc"></div>
  <span id="controls"></span>
</form>
<script>
  // ?lang=es mimics the live es-ES page: the only send control is
  // <button aria-label="Enviar" type="submit"> (no data-testid), the stop control "Detener".
  window.__spanish = new URLSearchParams(location.search).get('lang') === 'es';
  if (window.__spanish) document.documentElement.lang = 'es-ES';
  else document.documentElement.lang = 'en-US';
  // ?nosend=1: a page whose Send button Autopilot does not find (M5 C-8).
  window.__noSend = new URLSearchParams(location.search).get('nosend') === '1';
  window.__messages = [];      // every message the page received, in order
  window.__sendBroken = false; // when true, clicking send does nothing (a broken UI)
  let n = 0;
  const box = document.getElementById('prompt-textarea');
  const controls = document.getElementById('controls');
  let generating = false;
  function renderControls() {
    if (window.__spanish) {
      controls.innerHTML = generating
        ? '<button type="button" aria-label="Detener">Detener</button>'
        : '<button type="submit" aria-label="Enviar"' + (!box.innerText.trim() ? ' disabled' : '') + '>Enviar</button>';
      return;
    }
    if (window.__noSend && !generating) { controls.innerHTML = ''; return; }
    if (generating) {
      controls.innerHTML = '<button type="button" data-testid="stop-button" aria-label="Stop streaming">Stop</button>';
    } else {
      const empty = !box.innerText.trim();
      controls.innerHTML = '<button type="button" data-testid="send-button" ' + (empty ? 'disabled' : '') + '>Send</button>';
    }
  }
  box.addEventListener('input', renderControls);
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-testid="send-button"]')) window.__send();
  });
  window.__send = () => {
    if (window.__sendBroken || generating) return;
    const text = box.innerText.trim();
    if (!text) return;
    window.__messages.push(text);
    const thread = document.getElementById('thread');
    // Both the current markup (a turn wrapper with data-conversation-role) and the
    // older one (data-message-author-role, carrying the id) nested inside it: each
    // message must be counted once, and the id found on the nested element.
    const turn = (role) => {
      const wrapper = document.createElement('section');
      wrapper.setAttribute('data-conversation-role', role);
      const inner = document.createElement('div');
      inner.setAttribute('data-message-author-role', role);
      wrapper.append(inner);
      thread.append(wrapper);
      return inner;
    };
    const user = turn('user');
    user.setAttribute('data-user-message-bubble', '');
    user.textContent = text;
    box.innerHTML = '';
    n += 1;
    const answer = turn('assistant');
    answer.setAttribute('data-message-id', 'msg-' + n);
    generating = true;
    renderControls();
    let chunks = 0;
    const tick = () => {
      chunks += 1;
      answer.append(document.createTextNode(' chunk' + chunks));
      if (chunks === 6) {
        // A brief flicker mid-stream: the stop button disappears for 300 ms.
        generating = false; renderControls();
        setTimeout(() => { generating = true; renderControls(); setTimeout(tick, 150); }, 300);
        return;
      }
      if (chunks === 12) {
        // M3: a test may give the finished answer real answer content (a .markdown block, a status line).
        if (window.__nextAnswerHtml) { answer.innerHTML = window.__nextAnswerHtml; window.__nextAnswerHtml = null; }
        generating = false; renderControls(); return;
      }
      setTimeout(tick, 150);
    };
    setTimeout(tick, 150);
  };
  window.__typeDraft = (text) => { box.focus(); document.execCommand('insertText', false, text); };
  window.__showLimit = () => {
    document.getElementById('notices').innerHTML = '<div role="alert">You\\u2019ve reached our limit of messages per hour. Please try again later.</div>';
  };
  // A notice in a language Autopilot has no texts for (synthetic text, not a ChatGPT string).
  window.__showUnknownNotice = () => {
    document.getElementById('notices').innerHTML = '<div role="alert" style="padding:8px">[synthetic notice in an unknown language]</div>';
  };
  window.__rerender = () => { const t = document.getElementById('thread'); t.replaceWith(t.cloneNode(true)); };
  renderControls();
</script></body></html>`;

async function launch() {
  const context = await chromium.launchPersistentContext(profile, {
    // The full Chromium build: the headless shell cannot load extensions.
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  await context.route('https://chatgpt.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_CHATGPT }));
  // D-7: the same page at the obsolete address, which Autopilot must ignore.
  await context.route('https://chat.openai.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_CHATGPT }));
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return { context, worker, extensionId: new URL(worker.url()).host };
}

async function waitFor(label, fn, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { context, worker, extensionId } = await launch();
const session = () => worker.evaluate(async () => (await chrome.storage.local.get('autopilot.session.v2'))['autopilot.session.v2']);
const messages = (page) => page.evaluate(() => window.__messages.slice());

try {
  // ---- Settings through the panel UI ----
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.waitForSelector('#btn-start');

  // ---- M5 C-4: Getting started after a fresh install, once ----
  await panel.waitForFunction(() => !document.getElementById('getting-started').hidden, null, { timeout: 5000 }).catch(() => {});
  check('C-4: a fresh install shows Getting started', await panel.$eval('#getting-started', (el) => !el.hidden && /Send your first message yourself/.test(el.textContent)));
  await panel.click('#btn-gs-dismiss');
  await panel.waitForFunction(() => document.getElementById('getting-started').hidden);
  check('C-4: "Don\'t show again" hides it and keeps focus in the panel', await panel.evaluate(() => document.activeElement?.id === 'status-label'));
  await panel.reload();
  await panel.waitForSelector('#btn-start');
  await sleep(500); // a snapshot has arrived
  check('C-4: the dismissal is kept after reopening the panel', await panel.$eval('#getting-started', (el) => el.hidden));
  await panel.click('#settings summary');
  await panel.fill('#s-prompt', PROMPT);
  await panel.fill('#s-delay', '1');
  await panel.fill('#s-confirm', '1');
  await panel.fill('#s-max', '3');
  await panel.click('#btn-save');
  await panel.waitForFunction(() => document.getElementById('banner').textContent.includes('Settings saved'));
  await panel.reload();
  await panel.waitForSelector('#btn-start');
  await panel.waitForFunction(() => document.getElementById('s-prompt').value.length > 0);
  check('20: settings persist (saved through the UI, still there after reloading the panel)',
    (await panel.inputValue('#s-prompt')) === PROMPT && (await panel.inputValue('#s-delay')) === '1' && (await panel.inputValue('#s-max')) === '3');

  // ---- M5 C-6: field messages, unsaved changes, Reset asks first ----
  const storedSettings = () => worker.evaluate(async () => (await chrome.storage.local.get('autopilot.settings.v2'))['autopilot.settings.v2']);
  const fieldState = (id) => panel.$eval(`#${id}`, (el) => {
    const message = document.getElementById(`${el.id}-error`);
    return { invalid: el.getAttribute('aria-invalid'), describedBy: el.getAttribute('aria-describedby'), message: message.hidden ? '' : message.textContent, focused: document.activeElement === el };
  });
  const unsavedShown = () => panel.$eval('#settings-unsaved', (el) => !el.hidden);
  if (!(await panel.$eval('#settings', (d) => d.open))) await panel.click('#settings summary');
  check('C-6: no unsaved changes right after loading', !(await unsavedShown()));
  await panel.fill('#s-delay', '0');
  check('C-6: an edit shows "Unsaved changes"', await unsavedShown());
  await panel.click('#btn-save');
  const badDelay = await fieldState('s-delay');
  check('C-6: an invalid field is marked and described in place, and focused',
    badDelay.invalid === 'true' && badDelay.describedBy === 's-delay-error' && /from 1 to 3600/.test(badDelay.message) && badDelay.focused, JSON.stringify(badDelay));
  const otherField = await fieldState('s-confirm');
  check('C-6: valid fields are not marked', otherField.invalid === null && otherField.message === '');
  check('C-6: nothing is saved while a field is invalid', (await storedSettings()).delaySeconds === 1 && /Nothing was saved/.test(await panel.textContent('#banner')));
  await panel.fill('#s-delay', '2');
  const fixedDelay = await fieldState('s-delay');
  check('C-6: the message clears as soon as the field is valid', fixedDelay.invalid === null && fixedDelay.describedBy === null && fixedDelay.message === '');
  await panel.fill('#s-delay', '1');
  await sleep(300); // a refresh arrives meanwhile: the form keeps what was typed
  check('C-6: typing the saved value back clears "Unsaved changes"', !(await unsavedShown()));
  await panel.fill('#s-max', '4');
  await sleep(1300); // more than one refresh
  check('C-6: a refresh keeps the edited form', (await panel.inputValue('#s-max')) === '4' && (await unsavedShown()));
  await panel.fill('#s-max', '3');

  await panel.click('#btn-reset');
  const confirmText = await panel.textContent('#reset-confirm');
  check('C-6: Reset asks first, naming both the settings and the continuation prompt',
    await panel.$eval('#reset-confirm', (el) => !el.hidden) && /Reset all settings and the continuation prompt/.test(confirmText)
    && await panel.evaluate(() => document.activeElement?.id === 'btn-reset-cancel') && (await storedSettings()).prompt === PROMPT);
  await panel.keyboard.press('Escape');
  check('C-6: Escape cancels the reset; nothing changes and focus returns to Reset',
    await panel.$eval('#reset-confirm', (el) => el.hidden) && await panel.evaluate(() => document.activeElement?.id === 'btn-reset') && (await storedSettings()).prompt === PROMPT);
  await panel.click('#btn-reset');
  await panel.click('#btn-reset-confirm');
  await panel.waitForFunction(() => document.getElementById('banner').textContent.includes('including the continuation prompt'));
  const reset = await storedSettings();
  check('C-6: confirming resets the settings and the prompt', reset.prompt !== PROMPT && reset.delaySeconds === 10 && (await panel.inputValue('#s-delay')) === '10');
  // Back to the settings the rest of the run uses.
  await panel.fill('#s-prompt', PROMPT);
  await panel.fill('#s-delay', '1');
  await panel.fill('#s-confirm', '1');
  await panel.fill('#s-max', '3');
  await panel.click('#btn-save');
  await panel.waitForFunction(() => document.getElementById('banner').textContent.includes('Settings saved'));
  check('C-6: saving clears "Unsaved changes"', !(await unsavedShown()) && (await storedSettings()).delaySeconds === 1);

  async function openConversation(path) {
    const page = await context.newPage();
    await page.goto(`https://chatgpt.com${path}`);
    await page.waitForSelector('[data-testid="send-button"], button[aria-label="Enviar"]');
    await page.bringToFront();
    await sleep(300); // content script attached
    return page;
  }
  async function start(page) {
    await page.bringToFront();
    await panel.click('#btn-start');
    await panel.waitForFunction(() => !document.getElementById('btn-pause').hidden, null, { timeout: 5000 });
  }
  async function userSends(page, text) {
    await page.evaluate((t) => window.__typeDraft(t), text);
    await page.click('[data-testid="send-button"]');
  }
  async function stop() {
    if (!(await panel.locator('#btn-stop').isHidden())) await panel.click('#btn-stop');
    await panel.waitForFunction(() => !document.getElementById('btn-start').hidden);
  }

  // ---- 1-8, 18: automatic cycles up to the maximum ----
  const chat = await openConversation('/c/e2e-main');
  await start(chat);
  const started = await session();
  check('1: Autopilot starts on the active ChatGPT conversation', started.run === 'running' && started.conversation === '/c/e2e-main');
  check('the panel shows "Waiting for ChatGPT"', (await panel.textContent('#pill')) === 'Waiting for ChatGPT');
  await userSends(chat, 'Initial project prompt from the user');
  await waitFor('three automatic continuations', async () => (await messages(chat)).length >= 4, 40000);
  await waitFor('max-cycles stop', async () => (await session()).run === 'stopped');
  await sleep(4000); // longer than a full cycle: nothing else may be sent
  const sent = await messages(chat);
  const afterMax = await session();
  check('2-8: each finished response is followed by exactly one continuation, with no user action', sent.length === 4 && sent.slice(1).every((m) => m === PROMPT), JSON.stringify(sent.map((m) => m.slice(0, 20))));
  check('18: the maximum of 3 cycles is respected', afterMax.cycles === 3 && afterMax.reason === 'max_cycles');
  check('a brief stop-button flicker mid-stream was not taken for a finished response', afterMax.answeredKeys.filter((k) => k.startsWith('/c/e2e-main')).length === 3);

  async function saveSettings(change) {
    if (!(await panel.$eval('#settings', (d) => d.open))) await panel.click('#settings summary');
    await change();
    await panel.click('#btn-save');
    await panel.waitForFunction(() => document.getElementById('banner').textContent.includes('Settings saved'));
  }
  // Unlimited mode, and a delay long enough for the test to pause or stop inside it.
  await saveSettings(async () => { await panel.click('#s-unlimited'); await panel.fill('#s-delay', '4'); });

  // ---- 9: duplicate events (re-renders) do not cause duplicates; 10: pause; resume ----
  const second = await openConversation('/c/e2e-pause');
  await start(second);
  await userSends(second, 'Second conversation');
  await waitFor('delay phase', async () => (await session()).phase === 'delay');
  await second.evaluate(() => { window.__rerender(); window.__rerender(); });
  await panel.click('#btn-pause');
  await sleep(2500);
  check('10: pause prevents the pending continuation', (await messages(second)).length === 1 && (await session()).run === 'paused');
  await second.bringToFront();
  await panel.click('#btn-resume');
  await waitFor('continuation after resume', async () => (await messages(second)).length === 2);
  await second.evaluate(() => window.__rerender());
  await sleep(1500);
  check('9 + resume: one continuation after resuming, re-renders did not add any', (await messages(second)).length === 2);

  // ---- 11: stop prevents submission ----
  await waitFor('next delay', async () => (await session()).phase === 'delay');
  await stop();
  await sleep(2500);
  check('11: stop prevents the pending continuation', (await messages(second)).length === 2 && (await session()).run === 'stopped');

  await saveSettings(() => panel.fill('#s-delay', '1'));

  // ---- Tab switching: the conversation keeps going in a background tab ----
  const bgChat = await openConversation('/c/e2e-background');
  await start(bgChat);
  await userSends(bgChat, 'Background tab test');
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const bgVisibility = await bgChat.evaluate(() => document.visibilityState);
  await waitFor('continuation in a background tab', async () => (await messages(bgChat)).length >= 2, 30000);
  // Headless Chromium reports every tab as visible, so this proves routing, not hidden-tab throttling.
  check('tab switching: the continuation goes to the session\'s tab, not to the tab in front',
    (await messages(bgChat))[1] === PROMPT && (await messages(other).catch(() => null)) === null, `visibility=${bgVisibility}`);
  await other.close();
  await stop();

  // ---- 13: existing composer text is preserved ----
  const draftChat = await openConversation('/c/e2e-draft');
  await start(draftChat);
  await userSends(draftChat, 'Draft test');
  await sleep(500);
  await draftChat.evaluate(() => window.__typeDraft('my unsent note'));
  await waitFor('composer safeguard', async () => (await session()).reason === 'composer_has_text');
  const draft = await draftChat.evaluate(() => document.getElementById('prompt-textarea').innerText);
  check('13: text in the composer is never overwritten or sent', draft === 'my unsent note' && (await messages(draftChat)).length === 1, JSON.stringify(draft));
  await stop();

  // ---- 14: navigation to another conversation prevents submission ----
  const navChat = await openConversation('/c/e2e-nav');
  await start(navChat);
  await userSends(navChat, 'Navigation test');
  await waitFor('delay phase', async () => (await session()).phase === 'delay');
  await navChat.evaluate(() => { history.pushState({}, '', '/c/somewhere-else'); window.__rerender(); });
  await waitFor('navigation safeguard', async () => (await session()).reason === 'conversation_changed');
  await sleep(1500);
  check('14: navigating away prevents the continuation', (await messages(navChat)).length === 1);
  await stop();

  // ---- M3: stop on an exact status marker (setting on) ----
  const md = (...parts) => `<div data-markdown-text-style="assistant-message">${parts.join('')}</div>`;
  const COMPLETE = '<p>AUTOPILOT STATUS: MILESTONE COMPLETE</p>';
  await saveSettings(async () => { await panel.check('#s-stop-marker'); });
  const markerChat = await openConversation('/c/e2e-marker');
  await start(markerChat);
  // 1. The marker only inside a code block is ignored: the continuation is sent.
  await markerChat.evaluate((html) => { window.__nextAnswerHtml = html; }, md('<p>Example of the protocol:</p><pre><code>AUTOPILOT STATUS: MILESTONE COMPLETE</code></pre>'));
  await userSends(markerChat, 'Marker test');
  await waitFor('continuation after a code-block marker', async () => (await messages(markerChat)).length === 2, 30000);
  // 2. The continuation's answer ends with the exact line: Autopilot stops, Finished, nothing more is sent.
  await markerChat.evaluate((html) => { window.__nextAnswerHtml = html; }, md('<p>All tasks are verified.</p>', COMPLETE));
  await waitFor('stop on MILESTONE COMPLETE', async () => (await session()).reason === 'marker_complete', 30000);
  await sleep(5000);
  const guidanceAfterComplete = await panel.evaluate(() => document.getElementById('status-guidance').textContent);
  check('M3: a marker in a code block is ignored; MILESTONE COMPLETE on the last line stops with "Finished", nothing more sent',
    (await session()).run === 'stopped' && (await messages(markerChat)).length === 2 && /^Finished:/.test(guidanceAfterComplete),
    JSON.stringify({ messages: (await messages(markerChat)).length, guidance: guidanceAfterComplete.slice(0, 30) }));

  // The M3-L0 answer-structure probe: finds the answer content, prints structure only, never text.
  const probeSource = readFileSync(new URL('../docs/answer-structure-probe.js', import.meta.url), 'utf8');
  const probeOut = await markerChat.evaluate((src) => (0, eval)(src), probeSource);
  let probe = null;
  try { probe = JSON.parse(probeOut); } catch { /* checked below */ }
  check('M3-L0 probe: shows the answer structure (the answer-content element) and no text at all',
    !!probe && probe.version === 2 && probe.nodes.some((n) => n.data['data-markdown-text-style'] === 'assistant-message' && n.textLength > 0) &&
      !probeOut.includes('Example of the protocol') && !probeOut.includes('AUTOPILOT STATUS') && !probeOut.includes('Marker test') && !probeOut.includes(PROMPT),
    probe ? `nodes=${probe.nodesShown} selector=${probe.selectorUsed}` : String(probeOut).slice(0, 80));

  // Probe v2 on a layout where the assistant selector matches a visually hidden heading next to the
  // message (a test fixture for the probe's walk up to the turn, not a claim about ChatGPT's markup).
  const layout = await context.newPage();
  await layout.route('https://chatgpt.com/c/e2e-probe-layout', (route) => route.fulfill({ status: 200, contentType: 'text/html', body:
    '<!doctype html><html><body><main>' +
    '<article data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1">USER-SECRET question</div></article>' +
    '<article data-testid="conversation-turn-2">' +
      '<h4 class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)" data-conversation-role="assistant"><span>LABEL-SECRET</span></h4>' +
      '<div data-message-author-role="assistant" data-message-id="m1"><div data-markdown-text-style="assistant-message"><p>ANSWER-SECRET text</p><p>AUTOPILOT STATUS: CONTINUE</p></div></div>' +
    '</article></main></body></html>' }));
  await layout.goto('https://chatgpt.com/c/e2e-probe-layout');
  const layoutOut = await layout.evaluate((src) => (0, eval)(src), probeSource);
  let lp = null;
  try { lp = JSON.parse(layoutOut); } catch { /* checked below */ }
  const headingNode = lp?.nodes.find((n) => n.isExtensionMatch);
  check('M3-L0 probe v2: walks up from a hidden heading to its turn and shows the answer content there, without any text',
    !!lp && headingNode?.tag === 'h4' && headingNode.box[0] <= 1 &&
      lp.nodes.some((n) => n.data['data-markdown-text-style'] === 'assistant-message' && n.textLength > 0 && n.visible) &&
      lp.candidates.find((c) => c.selector === '[data-message-id]')?.count === 2 &&
      !/SECRET|AUTOPILOT STATUS/.test(layoutOut),
    lp ? `up=${lp.turnIsAncestorUp} nodes=${lp.nodesShown}` : String(layoutOut).slice(0, 80));
  await layout.close();

  // 3. BLOCKED pauses; Resume is the override for that one answer.
  const blockedChat = await openConversation('/c/e2e-blocked');
  await start(blockedChat);
  await blockedChat.evaluate((html) => { window.__nextAnswerHtml = html; }, md('<p>I need the API key to continue.</p><p>AUTOPILOT STATUS: BLOCKED</p>'));
  await userSends(blockedChat, 'Blocked test');
  await waitFor('pause on BLOCKED', async () => (await session()).reason === 'marker_blocked', 30000);
  await sleep(5000);
  const sentWhileBlocked = (await messages(blockedChat)).length;
  await panel.click('#btn-resume');
  await waitFor('continuation after Resume', async () => (await messages(blockedChat)).length === 2, 30000);
  check('M3: BLOCKED pauses and nothing is sent; Resume continues that answer once', sentWhileBlocked === 1 && (await messages(blockedChat))[1] === PROMPT);
  await stop();

  // 3b. The captured live structure (probe v2, 2026-11-09) in real Chromium: hidden h4 heading,
  //     display:contents ancestors, code-block widgets, message ids on the message group.
  const LIVE_ID_1 = 'a93353e3-acc2-42db-a7b5-7201c8c878cd';
  const LIVE_ID_2 = 'b5ae7f10-1111-4222-8333-444455556666';
  const liveAnswers = [
    toHtml(assistantTurn(1, LIVE_ID_1, { blocks: [paragraph('An ordinary answer.'), codeBlock('AUTOPILOT STATUS: MILESTONE COMPLETE'), paragraph('Next I will add tests.')] })),
    toHtml(assistantTurn(2, LIVE_ID_2, { blocks: [paragraph('All tasks are verified.'), paragraph('AUTOPILOT STATUS: MILESTONE COMPLETE')] })),
  ];
  const livePage = `<!doctype html><html lang="es-ES"><head><style>${FIXTURE_CSS}</style></head><body><main id="thread"></main>
    <form id="f"><div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:40px"></div><span id="controls"></span></form>
    <script>
      window.__messages = [];
      const answers = ${JSON.stringify(liveAnswers)};
      const box = document.getElementById('prompt-textarea');
      const controls = document.getElementById('controls');
      const idle = () => { controls.innerHTML = '<button type="submit" aria-label="Enviar">Enviar</button>'; };
      document.getElementById('f').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = box.innerText.trim();
        if (!text) return;
        window.__messages.push(text);
        box.innerHTML = '';
        const user = document.createElement('div');
        user.innerHTML = '<h4 class="sr-only" data-conversation-role="user"><span>Tú dijiste:</span></h4>';
        document.getElementById('thread').append(user);
        controls.innerHTML = '<button type="button" data-testid="stop-button" aria-label="Detener">Detener</button>';
        setTimeout(() => {
          const next = answers.shift();
          if (next) document.getElementById('thread').insertAdjacentHTML('beforeend', next);
          idle();
        }, 1500);
      });
      idle();
    </script></body></html>`;
  const liveChat = await context.newPage();
  await liveChat.route('https://chatgpt.com/c/e2e-live-structure', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: livePage }));
  await liveChat.goto('https://chatgpt.com/c/e2e-live-structure');
  await liveChat.waitForSelector('button[aria-label="Enviar"]');
  await liveChat.bringToFront();
  await sleep(300);
  await start(liveChat);
  await liveChat.evaluate(() => { const b = document.getElementById('prompt-textarea'); b.focus(); document.execCommand('insertText', false, 'Hola'); });
  await liveChat.click('button[aria-label="Enviar"]');
  await waitFor('continuation on the live structure', async () => (await liveChat.evaluate(() => window.__messages.length)) === 2, 30000);
  const afterFirst = await session();
  await waitFor('stop on the live structure', async () => (await session()).reason === 'marker_complete', 30000);
  await sleep(4000);
  const liveMessages = await liveChat.evaluate(() => window.__messages.slice());
  check('live structure in Chromium: the unit is the message, keys use its id, the code-widget marker is ignored, the final marker stops',
    liveMessages.length === 2 && liveMessages[1] === PROMPT && afterFirst.answeredKeys.includes(`/c/e2e-live-structure|id:${LIVE_ID_1}`) &&
      (await session()).run === 'stopped',
    JSON.stringify({ sent: liveMessages.length, answered: afterFirst.answeredKeys.filter((k) => k.includes('e2e-live')) }));
  await liveChat.close();

  // 4. With the setting off, the same line is not acted on.
  await saveSettings(async () => { await panel.uncheck('#s-stop-marker'); });
  const offChat = await openConversation('/c/e2e-marker-off');
  await start(offChat);
  await offChat.evaluate((html) => { window.__nextAnswerHtml = html; }, md('<p>Done.</p>', COMPLETE));
  await userSends(offChat, 'Marker off test');
  await waitFor('continuation with the setting off', async () => (await messages(offChat)).length === 2, 30000);
  check('M3: with "Stop on status marker" off, a MILESTONE COMPLETE line is ignored', (await session()).reason !== 'marker_complete');
  await stop();

  // ---- Live es-ES structure: the only send control is aria-label="Enviar" type="submit" ----
  const esChat = await openConversation('/c/e2e-es?lang=es');
  await start(esChat);
  await esChat.evaluate((t) => window.__typeDraft(t), 'Hola');
  await esChat.click('button[aria-label="Enviar"]');
  await waitFor('Spanish continuation', async () => (await messages(esChat)).length >= 2, 30000);
  await sleep(1500);
  const esMessages = await messages(esChat);
  check('es-ES: the "Enviar" submit button sends the continuation, exactly once per response',
    esMessages[1] === PROMPT && (await session()).cycles >= 1 && esMessages.filter((m) => m === PROMPT).length === (await session()).cycles,
    JSON.stringify(esMessages.map((m) => m.slice(0, 12))));
  await stop();

  // ---- An unrecognized notice (any language) is never taken for a finished answer ----
  const noticeChat = await openConversation('/c/e2e-es-notice?lang=es');
  await start(noticeChat);
  await noticeChat.evaluate((t) => window.__typeDraft(t), 'Hola');
  await noticeChat.click('button[aria-label="Enviar"]');
  await waitFor('delay before the continuation', async () => (await session()).phase === 'delay', 30000);
  await noticeChat.evaluate(() => window.__showUnknownNotice());
  await waitFor('pause on the unrecognized notice', async () => (await session()).reason === 'unrecognized_notice', 15000);
  await sleep(3000);
  check('an unrecognized notice pauses Autopilot and nothing is sent',
    (await session()).run === 'paused' && (await messages(noticeChat)).length === 1,
    JSON.stringify(await messages(noticeChat)));
  await stop();

  // ---- 12: usage limit stops automatic continuation ----
  const limitChat = await openConversation('/c/e2e-limit');
  await start(limitChat);
  await userSends(limitChat, 'Limit test');
  await limitChat.evaluate(() => window.__showLimit());
  await waitFor('usage-limit stop', async () => (await session()).reason === 'usage_limit');
  await sleep(3000);
  const limitState = await session();
  check('12: a usage limit stops Autopilot and nothing is sent', limitState.run === 'error' && (await messages(limitChat)).length === 1);
  check('the panel shows the error', (await panel.textContent('#pill')) === 'Stopped by an error' && /usage limit/i.test(await panel.textContent('#f-error')));
  const guidanceShown = await panel.evaluate(() => {
    const g = document.getElementById('status-guidance');
    return { hidden: g.hidden, text: g.textContent };
  });
  check('the panel says what to do: "Fix first" with the usage-limit action',
    !guidanceShown.hidden && /^Fix first:/.test(guidanceShown.text) && /limit is lifted/i.test(guidanceShown.text), JSON.stringify(guidanceShown.text));
  await stop();

  // ---- 16: a failed submission is detected and handled safely ----
  const brokenChat = await openConversation('/c/e2e-broken');
  // Opt-in send diagnostics on for this tab: they must describe the failure without the prompt.
  const sendLogs = [];
  brokenChat.on('console', (msg) => { if (msg.text().includes('Send step')) sendLogs.push(msg); });
  await brokenChat.evaluate(() => localStorage.setItem('chatgpt-autopilot:debug', '1'));
  await start(brokenChat);
  await userSends(brokenChat, 'Broken send test');
  await waitFor('delay phase', async () => (await session()).phase === 'delay');
  await brokenChat.evaluate(() => { window.__sendBroken = true; });
  await waitFor('failed submission', async () => (await session()).reason === 'submit_failed', 30000);
  const leftover = await brokenChat.evaluate(() => document.getElementById('prompt-textarea').innerText.trim());
  check('16: a send that does not happen is reported, not retried, and the prompt is removed from the box',
    (await session()).run === 'error' && (await messages(brokenChat)).length === 1 && leftover === '', JSON.stringify(leftover));

  const sendDiagnostics = await Promise.all(sendLogs.map(async (msg) => ({ text: msg.text(), args: await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null))) })));
  const serialized = JSON.stringify(sendDiagnostics);
  const stages = sendDiagnostics.map((d) => d.args[1]?.stage);
  check('opt-in send diagnostics describe the failed send, without the prompt',
    stages.includes('typed') && stages.includes('clicking_send') && stages.includes('not_confirmed') && !serialized.includes(PROMPT) && !serialized.includes('Broken send test'),
    `stages=${stages.join(',')}`);
  await brokenChat.evaluate(() => localStorage.removeItem('chatgpt-autopilot:debug'));

  // ---- Diagnostic report (M2, T10): one click in the panel, technical state only ----
  await panel.bringToFront();
  // Headless Chromium cannot read the clipboard back; record what the panel writes to it.
  await panel.evaluate(() => {
    window.__copied = '';
    navigator.clipboard.writeText = async (text) => { window.__copied = text; };
  });
  await panel.click('#activity summary');
  await panel.click('#btn-report');
  await panel.waitForFunction(() => /Diagnostic report copied|Copy the diagnostic report below/.test(document.getElementById('banner').textContent || ''), null, { timeout: 10000 });
  const reportText = await panel.evaluate(async () => {
    const box = document.getElementById('report-fallback');
    if (!box.hidden && box.value) return box.value;
    return window.__copied;
  });
  let report = null;
  try { report = JSON.parse(reportText); } catch { /* checked below */ }
  check('diagnostic report: valid, describes the failed send, contains no prompt or message text',
    !!report && report.session?.reason === 'submit_failed' && report.page?.answered === true && typeof report.lastSendAttempt?.stage === 'string' &&
      !reportText.includes(PROMPT) && !reportText.includes('Broken send test') && !reportText.includes('e2e-broken'),
    report ? `stage=${report.lastSendAttempt?.stage}` : `unparsable (${reportText.length} chars)`);
  await stop();

  // ---- 17: an unknown page state does not trigger submission ----
  const blank = await context.newPage();
  await blank.route('https://chatgpt.com/c/e2e-unknown', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Loading</title><main>Loading…</main>' }));
  await blank.goto('https://chatgpt.com/c/e2e-unknown');
  await blank.bringToFront();
  await sleep(300);
  await panel.click('#btn-start');
  await sleep(500);
  check('17: Autopilot refuses to start on a page it does not recognize', (await session()).run === 'stopped' && /message box was not found/i.test(await panel.textContent('#banner')));

  // ---- M5 C-7: accessibility (axe in both themes; keyboard actions keep focus; announcements) ----
  await stop();
  {
    const a11yChat = await openConversation('/c/e2e-a11y');
    await panel.evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    for (const id of ['settings', 'activity']) if (!(await panel.$eval(`#${id}`, (d) => d.open))) await panel.click(`#${id} summary`);
    for (const scheme of ['light', 'dark']) {
      await panel.emulateMedia({ colorScheme: scheme });
      const result = await panel.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
        const describe = (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`;
        return {
          serious: r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map(describe),
          other: r.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical').map(describe),
        };
      });
      check(`C-7: axe reports no serious or critical WCAG 2.2 AA issue in the ${scheme} theme`, result.serious.length === 0, [...result.serious, ...result.other.map((o) => `minor: ${o}`)].join(' | '));
    }
    await panel.emulateMedia({ colorScheme: 'light' });
    await a11yChat.bringToFront();
    await panel.waitForFunction(() => !document.getElementById('btn-start').disabled);
    const focused = () => panel.evaluate(() => document.activeElement?.id ?? '');
    const announced = () => panel.textContent('#status-announce');
    await panel.focus('#btn-start');
    await panel.keyboard.press('Enter');
    await panel.waitForFunction(() => !document.getElementById('btn-pause').hidden);
    check('C-7: after Start (keyboard), focus moves to Pause', (await focused()) === 'btn-pause', await focused());
    await waitFor('announcement', async () => /^Waiting for ChatGPT\./.test(await announced()), 3000).catch(() => {});
    check('C-7: the status change is announced in the live region', /^Waiting for ChatGPT\./.test(await announced()), await announced());
    await panel.keyboard.press('Enter');
    await panel.waitForFunction(() => !document.getElementById('btn-resume').hidden);
    check('C-7: after Pause, focus moves to Resume', (await focused()) === 'btn-resume', await focused());
    await waitFor('pause announcement', async () => /^Paused\. Paused by you\. Resume when ready:/.test(await announced()), 3000).catch(() => {});
    check('C-7: the pause and its guidance are announced', /^Paused\. Paused by you\. Resume when ready:/.test(await announced()), await announced());
    await panel.keyboard.press('Enter');
    await panel.waitForFunction(() => !document.getElementById('btn-pause').hidden);
    check('C-7: after Resume, focus moves to Pause', (await focused()) === 'btn-pause', await focused());
    await panel.focus('#btn-stop');
    await panel.keyboard.press('Enter');
    await panel.waitForFunction(() => !document.getElementById('btn-start').hidden);
    check('C-7: after Stop, focus moves to Start', (await focused()) === 'btn-start', await focused());
    const before = await announced();
    await sleep(2500); // the countdown and refreshes keep running
    check('C-7: nothing is announced without a status change', (await announced()) === before);
    await a11yChat.close();
  }

  // ---- D-7: chat.openai.com is no longer a ChatGPT address for Autopilot ----
  {
    const oldDomain = await context.newPage();
    await oldDomain.goto('https://chat.openai.com/c/e2e-old-domain');
    await oldDomain.waitForSelector('#prompt-textarea');
    await oldDomain.bringToFront();
    await sleep(800);
    const reach = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      try { await chrome.tabs.sendMessage(tab.id, { type: 'GET_OBSERVATION' }); return 'answered'; } catch { return 'no content script'; }
    });
    check('D-7: no content script runs on chat.openai.com', reach === 'no content script', reach);
    const hint = await waitFor('start hint', async () => /^Open a ChatGPT conversation/.test(await panel.textContent('#start-hint')), 5000).catch(() => false);
    check('D-7: a chat.openai.com tab is not taken for a ChatGPT tab (Start unavailable)', hint && await panel.$eval('#btn-start', (b) => b.disabled));
    await oldDomain.close();
  }

  // ---- M5 C-8: the Page line ----
  await stop();
  const pageText = () => panel.textContent('#f-page');
  const checkedChat = await openConversation('/c/e2e-page-check');
  const recognized = await waitFor('page line', async () => /^Recognized: message box, Send button, .*; language en-US\.$/.test(await pageText()), 8000).catch(() => false);
  check('C-8: a recognized page shows what was found and the interface language', recognized, await pageText());
  const noSend = await context.newPage();
  await noSend.goto('https://chatgpt.com/c/e2e-no-send?nosend=1');
  await noSend.waitForSelector('#prompt-textarea');
  await noSend.bringToFront();
  await sleep(300);
  const emptyBox = await waitFor('page line, empty box', async () => /The Send button is checked once the message box has text\.$/.test(await pageText()), 8000).catch(() => false);
  check('C-8: no Send button with an empty message box is not a warning', emptyBox && (await panel.$eval('#f-page', (el) => el.dataset.recognized)) === 'true', await pageText());
  await noSend.evaluate(() => window.__typeDraft('a draft'));
  const flagged = await waitFor('page line, not recognized', async () => /^This ChatGPT page is not fully recognized \(Send button not found\)/.test(await pageText()), 8000).catch(() => false);
  check('C-8: no Send button while the box has text shows "not fully recognized"', flagged && (await panel.$eval('#f-page', (el) => el.dataset.recognized)) === 'false', await pageText());
  const panelHtml = await panel.$eval('#f-page', (el) => el.textContent);
  check('C-8: the Page line contains no page text', !/a draft/.test(panelHtml));
  await noSend.close();
  await checkedChat.close();

  // ---- 15: a browser restart does not cause a duplicate ----
  const restartChat = await openConversation('/c/e2e-restart');
  await start(restartChat);
  await userSends(restartChat, 'Restart test');
  await waitFor('delay phase', async () => (await session()).phase === 'delay');
  await context.close();
  const relaunched = await launch();
  const s2 = await relaunched.worker.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const s = (await chrome.storage.local.get('autopilot.session.v2'))['autopilot.session.v2'];
      if (s && s.run !== 'running') return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    return (await chrome.storage.local.get('autopilot.session.v2'))['autopilot.session.v2'];
  });
  check('15: after a browser restart the session is paused, not resumed blindly', s2.run === 'paused' && s2.reason === 'browser_restarted' && s2.tabId === null, `${s2.run}/${s2.reason}`);

  await relaunched.context.close();

  // ---- M5 C-4: a ChatGPT tab open before the install gets the reload hint, not a failed Start ----
  // The real case: the tab exists first, then the extension is installed (over the
  // DevTools protocol), so the tab has no content script until it is reloaded.
  {
    const profile2 = mkdtempSync(join(tmpdir(), 'autopilot-e2e-install-'));
    const ctx = await chromium.launchPersistentContext(profile2, {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--remote-debugging-port=0', '--enable-unsafe-extension-debugging'],
    });
    try {
      await ctx.route('https://chatgpt.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_CHATGPT }));
      const oldTab = await ctx.newPage();
      await oldTab.goto('https://chatgpt.com/c/e2e-before-install');
      await oldTab.waitForSelector('[data-testid="send-button"]');
      const port = await waitFor('DevTools port', () => { try { return readFileSync(join(profile2, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { return null; } });
      const cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const { id } = await (await cdpBrowser.newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: resolve(extensionDir) });
      const panel4 = await ctx.newPage();
      await panel4.goto(`chrome-extension://${id}/sidepanel.html`);
      await panel4.waitForSelector('#btn-start');
      await oldTab.bringToFront();
      const hinted = await panel4.waitForFunction(() => {
        const hint = document.getElementById('start-hint');
        return !hint.hidden && /Reload this ChatGPT tab so Autopilot can connect/.test(hint.textContent);
      }, null, { timeout: 8000 }).then(() => true, () => false);
      check('C-4: a tab open before the install shows the reload hint before Start, and Start is unavailable', hinted && await panel4.$eval('#btn-start', (b) => b.disabled));
      check('C-4: this fresh install shows Getting started', await panel4.$eval('#getting-started', (el) => !el.hidden));
      await oldTab.reload();
      await oldTab.waitForSelector('[data-testid="send-button"]');
      await oldTab.bringToFront();
      const recovered = await panel4.waitForFunction(() => document.getElementById('start-hint').hidden && !document.getElementById('btn-start').disabled, null, { timeout: 8000 }).then(() => true, () => false);
      check('C-4: after reloading the tab, the hint goes and Start is available', recovered);
      await cdpBrowser.close().catch(() => {});
    } finally {
      await ctx.close().catch(() => {});
      rmSync(profile2, { recursive: true, force: true });
    }
  }
} catch (error) {
  console.error(error);
  failures += 1;
  await context.close().catch(() => {});
} finally {
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
