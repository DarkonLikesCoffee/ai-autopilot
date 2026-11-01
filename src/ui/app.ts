// The Autopilot control panel, shared by the popup and the side panel.
// Fixed markup is built once; every dynamic value is set with textContent.

import type { UiRequest, UiResponse, UiSnapshot } from '../shared/messages.ts';
import { LIMITS } from '../shared/settings.ts';
import type { Settings } from '../shared/types.ts';
import { buildView, formatClock } from './viewModel.ts';

const MARKUP = `
<header class="bar">
  <div class="brand"><img src="icons/icon32.png" alt="" width="20" height="20"><h1>ChatGPT Autopilot</h1></div>
  <span id="pill" class="pill" data-tone="neutral">Stopped</span>
</header>
<main>
  <section class="card status-card">
    <p id="status-label" class="status-label">Stopped</p>
    <p id="status-detail" class="muted"></p>
    <div class="controls">
      <button id="btn-start" class="primary" type="button">Start Autopilot</button>
      <button id="btn-pause" type="button">Pause</button>
      <button id="btn-resume" class="primary" type="button">Resume</button>
      <button id="btn-stop" class="danger" type="button">Stop</button>
    </div>
    <p id="start-hint" class="hint" hidden></p>
    <p id="banner" class="banner" role="status" hidden></p>
  </section>

  <section class="card">
    <h2>Session</h2>
    <dl class="facts">
      <dt>Conversation</dt><dd id="f-conversation">—</dd>
      <dt>Continuations sent</dt><dd id="f-cycles">0</dd>
      <dt>ChatGPT</dt><dd id="f-generation">—</dd>
      <dt>Next continuation in</dt><dd id="f-countdown">—</dd>
      <dt>Last continuation</dt><dd id="f-last">—</dd>
      <dt>Last error</dt><dd id="f-error">—</dd>
    </dl>
  </section>

  <details class="card" id="settings">
    <summary><h2>Settings</h2></summary>
    <form id="settings-form" novalidate>
      <label for="s-prompt">Continuation prompt <span class="hint">sent unchanged after every finished response</span></label>
      <textarea id="s-prompt" rows="9" maxlength="${LIMITS.promptMaxLength}" spellcheck="true"></textarea>
      <div class="grid">
        <label>Delay before sending (s)<input id="s-delay" type="number" min="${LIMITS.delaySeconds.min}" max="${LIMITS.delaySeconds.max}" step="1"></label>
        <label>Completion confirmation (s)<input id="s-confirm" type="number" min="${LIMITS.confirmSeconds.min}" max="${LIMITS.confirmSeconds.max}" step="1"></label>
        <label>Maximum cycles<input id="s-max" type="number" min="1" max="${LIMITS.maxCycles.max}" step="1"></label>
        <label class="check"><input id="s-unlimited" type="checkbox"> Unlimited</label>
      </div>
      <label class="check"><input id="s-notify" type="checkbox"> Notifications</label>
      <p class="hint">Unlimited means no limit set by the extension. ChatGPT's own usage limits always apply: Autopilot stops when one appears.</p>
      <div class="controls">
        <button id="btn-save" class="primary" type="submit">Save settings</button>
        <button id="btn-reset" type="button">Reset to defaults</button>
      </div>
    </form>
  </details>

  <details class="card" id="activity">
    <summary><h2>Activity</h2></summary>
    <ol id="log" class="log"></ol>
  </details>
</main>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

let snapshot: UiSnapshot | null = null;
/** Local time when the snapshot arrived, to advance the countdown between refreshes. */
let receivedAt = 0;
let settingsDirty = false;

async function request(message: UiRequest): Promise<UiResponse> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as UiResponse | undefined;
    return response ?? { ok: false, error: 'The extension did not answer. Reopen this panel.' };
  } catch (error) {
    return { ok: false, error: `The extension could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function showBanner(text: string, tone: 'info' | 'danger'): void {
  const banner = $('banner');
  banner.textContent = text;
  banner.dataset.tone = tone;
  banner.hidden = !text;
}

async function act(message: UiRequest, button?: HTMLButtonElement): Promise<UiResponse> {
  if (button) button.disabled = true;
  const response = await request(message);
  if (response.snapshot) accept(response.snapshot);
  showBanner(response.ok ? response.note ?? '' : response.error, response.ok ? 'info' : 'danger');
  if (button) button.disabled = false;
  render();
  return response;
}

function accept(next: UiSnapshot): void {
  snapshot = next;
  receivedAt = Date.now();
  if (!settingsDirty) fillSettings(next.settings);
}

function fillSettings(settings: Settings): void {
  $<HTMLTextAreaElement>('s-prompt').value = settings.prompt;
  $<HTMLInputElement>('s-delay').value = String(settings.delaySeconds);
  $<HTMLInputElement>('s-confirm').value = String(settings.confirmSeconds);
  const unlimited = settings.maxCycles === 0;
  $<HTMLInputElement>('s-unlimited').checked = unlimited;
  $<HTMLInputElement>('s-max').value = unlimited ? '' : String(settings.maxCycles);
  $<HTMLInputElement>('s-max').disabled = unlimited;
  $<HTMLInputElement>('s-notify').checked = settings.notifications;
}

function readSettings(): Settings {
  const unlimited = $<HTMLInputElement>('s-unlimited').checked;
  return {
    schemaVersion: 2,
    prompt: $<HTMLTextAreaElement>('s-prompt').value,
    delaySeconds: Number($<HTMLInputElement>('s-delay').value),
    confirmSeconds: Number($<HTMLInputElement>('s-confirm').value),
    maxCycles: unlimited ? 0 : Number($<HTMLInputElement>('s-max').value),
    notifications: $<HTMLInputElement>('s-notify').checked,
  };
}

function render(): void {
  if (!snapshot) return;
  const view = buildView(snapshot, snapshot.now + (Date.now() - receivedAt));
  const pill = $('pill');
  pill.textContent = view.statusLabel;
  pill.dataset.tone = view.tone;
  $('status-label').textContent = view.statusLabel;
  $('status-detail').textContent = view.detail;
  document.body.dataset.status = view.status;

  const show = (id: string, visible: boolean, enabled = visible) => {
    const button = $<HTMLButtonElement>(id);
    button.hidden = !visible;
    button.disabled = !enabled;
  };
  show('btn-start', snapshot.session.run === 'stopped', view.canStart);
  show('btn-pause', view.canPause);
  show('btn-resume', view.canResume);
  show('btn-stop', view.canStop);
  const hint = $('start-hint');
  hint.textContent = view.startHint ?? '';
  hint.hidden = !view.startHint;

  $('f-conversation').textContent = view.conversation;
  $('f-cycles').textContent = view.cycles;
  $('f-generation').textContent = view.generation;
  $('f-countdown').textContent = view.countdown;
  $('f-last').textContent = view.lastContinuation;
  $('f-error').textContent = view.lastError;

  const log = $('log');
  const entries = [...snapshot.session.log].reverse().slice(0, 15);
  log.replaceChildren(...entries.map((entry) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = formatClock(entry.at);
    item.append(time, document.createTextNode(` ${entry.message}`));
    return item;
  }));
}

let refreshing = false;
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await request({ type: 'GET_SNAPSHOT' });
    if (response.snapshot) accept(response.snapshot);
    if (!response.ok) showBanner(response.error, 'danger');
    render();
  } finally {
    refreshing = false;
  }
}

function init(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = MARKUP;

  $('btn-start').addEventListener('click', (e) => void act({ type: 'START' }, e.currentTarget as HTMLButtonElement));
  $('btn-pause').addEventListener('click', (e) => void act({ type: 'PAUSE' }, e.currentTarget as HTMLButtonElement));
  $('btn-resume').addEventListener('click', (e) => void act({ type: 'RESUME' }, e.currentTarget as HTMLButtonElement));
  $('btn-stop').addEventListener('click', (e) => void act({ type: 'STOP' }, e.currentTarget as HTMLButtonElement));

  const form = $<HTMLFormElement>('settings-form');
  form.addEventListener('input', () => { settingsDirty = true; });
  $<HTMLInputElement>('s-unlimited').addEventListener('change', (e) => {
    const unlimited = (e.currentTarget as HTMLInputElement).checked;
    const max = $<HTMLInputElement>('s-max');
    max.disabled = unlimited;
    if (!unlimited && !max.value) max.value = '25';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void act({ type: 'SAVE_SETTINGS', settings: readSettings() }, $<HTMLButtonElement>('btn-save')).then((response) => {
      if (response.ok) {
        settingsDirty = false;
        fillSettings(response.snapshot.settings);
      }
    });
  });
  $('btn-reset').addEventListener('click', (e) => {
    settingsDirty = false;
    void act({ type: 'RESET_SETTINGS' }, e.currentTarget as HTMLButtonElement).then((response) => {
      if (response.ok) fillSettings(response.snapshot.settings);
    });
  });

  void refresh();
  // Keep the status and countdown current while the panel is open.
  setInterval(() => void refresh(), 1000);
  setInterval(render, 250);
}

init();
