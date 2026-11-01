// Real-browser check of the built extension (dist/) in Chromium. chatgpt.com
// is replaced by a local fake page that mimics the parts of the ChatGPT
// interface the extension relies on: a contenteditable composer, a send
// button that is disabled while the composer is empty, streamed responses
// with a stop button (including a brief flicker mid-stream), usage-limit
// notices and in-app navigation. The test drives the real panel UI.
//
// Requires Playwright with Chromium (not part of CI). Run: npm run e2e
// This does not prove compatibility with the live ChatGPT site; it proves the
// extension's own behaviour end to end: detection, delay, insertion,
// submission, verification, safeguards, messaging and storage.

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const extensionDir = fileURLToPath(new URL('../dist', import.meta.url));
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
<form id="composer-form" onsubmit="return false">
  <div id="prompt-textarea" contenteditable="true" role="textbox" style="min-height:40px;border:1px solid #ccc"></div>
  <span id="controls"></span>
</form>
<script>
  window.__messages = [];      // every message the page received, in order
  window.__sendBroken = false; // when true, clicking send does nothing (a broken UI)
  let n = 0;
  const box = document.getElementById('prompt-textarea');
  const controls = document.getElementById('controls');
  let generating = false;
  function renderControls() {
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
    const user = document.createElement('div');
    user.setAttribute('data-message-author-role', 'user');
    user.textContent = text;
    thread.append(user);
    box.innerHTML = '';
    n += 1;
    const answer = document.createElement('div');
    answer.setAttribute('data-message-author-role', 'assistant');
    answer.setAttribute('data-message-id', 'msg-' + n);
    thread.append(answer);
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
      if (chunks === 12) { generating = false; renderControls(); return; }
      setTimeout(tick, 150);
    };
    setTimeout(tick, 150);
  };
  window.__typeDraft = (text) => { box.focus(); document.execCommand('insertText', false, text); };
  window.__showLimit = () => {
    document.getElementById('notices').innerHTML = '<div role="alert">You\\u2019ve reached our limit of messages per hour. Please try again later.</div>';
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

  async function openConversation(path) {
    const page = await context.newPage();
    await page.goto(`https://chatgpt.com${path}`);
    await page.waitForSelector('[data-testid="send-button"]');
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

  // ---- 12: usage limit stops automatic continuation ----
  const limitChat = await openConversation('/c/e2e-limit');
  await start(limitChat);
  await userSends(limitChat, 'Limit test');
  await limitChat.evaluate(() => window.__showLimit());
  await waitFor('usage-limit stop', async () => (await session()).reason === 'usage_limit');
  await sleep(3000);
  const limitState = await session();
  check('12: a usage limit stops Autopilot and nothing is sent', limitState.run === 'error' && (await messages(limitChat)).length === 1);
  check('the panel shows the error', (await panel.textContent('#pill')) === 'Error' && /usage limit/i.test(await panel.textContent('#f-error')));
  await stop();

  // ---- 16: a failed submission is detected and handled safely ----
  const brokenChat = await openConversation('/c/e2e-broken');
  await start(brokenChat);
  await userSends(brokenChat, 'Broken send test');
  await waitFor('delay phase', async () => (await session()).phase === 'delay');
  await brokenChat.evaluate(() => { window.__sendBroken = true; });
  await waitFor('failed submission', async () => (await session()).reason === 'submit_failed', 30000);
  const leftover = await brokenChat.evaluate(() => document.getElementById('prompt-textarea').innerText.trim());
  check('16: a send that does not happen is reported, not retried, and the prompt is removed from the box',
    (await session()).run === 'error' && (await messages(brokenChat)).length === 1 && leftover === '', JSON.stringify(leftover));
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
} catch (error) {
  console.error(error);
  failures += 1;
  await context.close().catch(() => {});
} finally {
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
