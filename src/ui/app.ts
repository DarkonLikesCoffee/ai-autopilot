// The Autopilot control panel, shared by the popup and the side panel.
// Fixed markup is built once; every dynamic value is set with textContent.

import type { UiRequest, UiResponse, UiSnapshot } from '../shared/messages.ts';
import { LIMITS, type SettingsField } from '../shared/settings.ts';
import type { Settings } from '../shared/types.ts';
import { buildView, formatClock } from './viewModel.ts';
import { FIELD_INPUT, fieldIssues, hasUnsavedChanges, parseForm, type FormValues } from './settingsForm.ts';

const MARKUP = `
<header class="bar">
  <div class="brand"><img src="icons/icon32.png" alt="" width="20" height="20"><h1>ChatGPT Autopilot</h1></div>
  <span id="pill" class="pill" data-tone="neutral">Stopped</span>
</header>
<main>
  <section class="card status-card">
    <p id="status-label" class="status-label">Stopped</p>
    <p id="status-detail" class="muted"></p>
    <p id="status-guidance" class="guidance" hidden><strong id="guidance-kind"></strong> <span id="guidance-action"></span></p>
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
      <label for="s-prompt">Continuation prompt <span class="hint">sent unchanged after every finished answer</span></label>
      <textarea id="s-prompt" rows="9" maxlength="${LIMITS.promptMaxLength}" spellcheck="true"></textarea>
      <p id="s-prompt-error" class="field-error" hidden></p>
      <div class="grid">
        <div><label>Delay before sending (s)<input id="s-delay" type="number" min="${LIMITS.delaySeconds.min}" max="${LIMITS.delaySeconds.max}" step="1"></label><p id="s-delay-error" class="field-error" hidden></p></div>
        <div><label>Completion confirmation (s)<input id="s-confirm" type="number" min="${LIMITS.confirmSeconds.min}" max="${LIMITS.confirmSeconds.max}" step="1"></label><p id="s-confirm-error" class="field-error" hidden></p></div>
        <div><label>Maximum cycles<input id="s-max" type="number" min="1" max="${LIMITS.maxCycles.max}" step="1"></label><p id="s-max-error" class="field-error" hidden></p></div>
        <label class="check"><input id="s-unlimited" type="checkbox"> Unlimited</label>
      </div>
      <label class="check"><input id="s-notify" type="checkbox"> Notifications</label>
      <label class="check"><input id="s-stop-marker" type="checkbox"> Stop on status marker</label>
      <p class="hint">Off by default. When on, Autopilot reads the latest finished answer, outside code and quotes, only to check whether its last line is exactly <code>AUTOPILOT STATUS: MILESTONE COMPLETE</code> (stop), <code>AUTOPILOT STATUS: BLOCKED</code> (pause) or <code>AUTOPILOT STATUS: CONTINUE</code>. That text is never stored, sent or logged. An unclear status line pauses.</p>
      <p class="hint">Unlimited means no limit set by the extension. ChatGPT's own usage limits always apply: Autopilot stops when one appears.</p>
      <p class="hint" id="settings-timing">Saved changes apply right away: a new continuation prompt is used for the next continuation, a new delay from the next countdown. A countdown that is already running is not changed.</p>
      <div class="controls">
        <button id="btn-save" class="primary" type="submit">Save settings</button>
        <button id="btn-reset" type="button">Reset to defaults</button>
        <span id="settings-unsaved" class="unsaved" hidden>Unsaved changes.</span>
      </div>
      <div id="reset-confirm" class="confirm" role="group" aria-labelledby="reset-confirm-text" hidden>
        <p id="reset-confirm-text"><strong>Reset all settings and the continuation prompt to the defaults?</strong> Your continuation prompt is replaced by the default one.</p>
        <div class="controls">
          <button id="btn-reset-confirm" class="danger" type="button">Reset settings and prompt</button>
          <button id="btn-reset-cancel" type="button">Cancel</button>
        </div>
      </div>
    </form>
  </details>

  <details class="card" id="activity">
    <summary><h2>Activity</h2></summary>
    <ol id="log" class="log"></ol>
    <div class="controls">
      <button id="btn-report" type="button">Copy diagnostic report</button>
    </div>
    <p class="hint">Technical state only: no prompt, conversation or notice text. Paste it into an issue when asking for help.</p>
    <textarea id="report-fallback" rows="8" readonly hidden aria-label="Diagnostic report"></textarea>
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
/** Set after a refused save: from then on, field messages follow the input. */
let showFieldIssues = false;

async function request(message: UiRequest): Promise<UiResponse> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as UiResponse | undefined;
    return response ?? { ok: false, error: 'The extension did not answer. Reopen this panel.' };
  } catch (error) {
    return { ok: false, error: `The extension could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

let bannerTimer: ReturnType<typeof setTimeout> | null = null;
function showBanner(text: string, tone: 'info' | 'danger'): void {
  const banner = $('banner');
  banner.textContent = text;
  banner.dataset.tone = tone;
  banner.hidden = !text;
  if (bannerTimer !== null) clearTimeout(bannerTimer);
  // Notes fade after a while; errors stay until the next action.
  bannerTimer = tone === 'info' && text ? setTimeout(() => { banner.hidden = true; }, 8000) : null;
}

async function copyReport(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const response = await request({ type: 'GET_REPORT' });
    if (!response.ok || !response.report) {
      showBanner(response.ok ? 'The diagnostic report could not be created.' : response.error, 'danger');
      return;
    }
    const fallback = $<HTMLTextAreaElement>('report-fallback');
    try {
      await navigator.clipboard.writeText(response.report);
      fallback.hidden = true;
      showBanner('Diagnostic report copied. It contains no conversation text.', 'info');
    } catch {
      // Clipboard not available here: show it for copying by hand.
      fallback.value = response.report;
      fallback.hidden = false;
      fallback.select();
      showBanner('Copy the diagnostic report below (Ctrl+C / Cmd+C).', 'info');
    }
  } finally {
    button.disabled = false;
  }
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
  $<HTMLInputElement>('s-stop-marker').checked = settings.stopOnMarker;
}

function readForm(): FormValues {
  return {
    prompt: $<HTMLTextAreaElement>('s-prompt').value,
    delaySeconds: $<HTMLInputElement>('s-delay').value,
    confirmSeconds: $<HTMLInputElement>('s-confirm').value,
    maxCycles: $<HTMLInputElement>('s-max').value,
    unlimited: $<HTMLInputElement>('s-unlimited').checked,
    notifications: $<HTMLInputElement>('s-notify').checked,
    stopOnMarker: $<HTMLInputElement>('s-stop-marker').checked,
  };
}

/** Marks each invalid field and describes it in place; returns the first invalid control. */
function markFieldIssues(issues: Partial<Record<SettingsField, string>>): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (const [field, id] of Object.entries(FIELD_INPUT) as [SettingsField, string][]) {
    const control = document.getElementById(id);
    const message = document.getElementById(`${id}-error`);
    if (!control || !message) continue;
    const text = issues[field] ?? '';
    message.textContent = text;
    message.hidden = !text;
    if (text) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', message.id);
      first ??= control;
    } else {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
  }
  return first;
}

function renderSettingsState(): void {
  const unsaved = snapshot !== null && settingsDirty && hasUnsavedChanges(readForm(), snapshot.settings);
  $('settings-unsaved').hidden = !unsaved;
  if (showFieldIssues) markFieldIssues(fieldIssues(readForm()));
}

function setResetConfirm(open: boolean): void {
  $('reset-confirm').hidden = !open;
  $<HTMLButtonElement>('btn-reset').disabled = open;
  $(open ? 'btn-reset-cancel' : 'btn-reset').focus();
}

function render(): void {
  if (!snapshot) return;
  const view = buildView(snapshot, snapshot.now + (Date.now() - receivedAt));
  const pill = $('pill');
  pill.textContent = view.statusLabel;
  pill.dataset.tone = view.tone;
  $('status-label').textContent = view.statusLabel;
  $('status-detail').textContent = view.detail;
  const guidance = $('status-guidance');
  guidance.hidden = !view.guidance;
  guidance.dataset.kind = view.guidance?.kind ?? '';
  $('guidance-kind').textContent = view.guidance ? `${view.guidance.label}:` : '';
  $('guidance-action').textContent = view.guidance?.action ?? '';
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
  renderSettingsState();

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
  $('btn-report').addEventListener('click', (e) => void copyReport(e.currentTarget as HTMLButtonElement));

  const form = $<HTMLFormElement>('settings-form');
  form.addEventListener('input', () => { settingsDirty = true; renderSettingsState(); });
  form.addEventListener('change', () => { settingsDirty = true; renderSettingsState(); });
  $<HTMLInputElement>('s-unlimited').addEventListener('change', (e) => {
    const unlimited = (e.currentTarget as HTMLInputElement).checked;
    const max = $<HTMLInputElement>('s-max');
    max.disabled = unlimited;
    if (!unlimited && !max.value) max.value = '25';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = readForm();
    const issues = fieldIssues(values);
    const firstInvalid = markFieldIssues(issues);
    if (firstInvalid) {
      // Nothing is sent: each field says what is wrong, and focus goes to the first one.
      showFieldIssues = true;
      showBanner('Fix the marked settings first. Nothing was saved.', 'danger');
      firstInvalid.focus();
      return;
    }
    void act({ type: 'SAVE_SETTINGS', settings: parseForm(values) }, $<HTMLButtonElement>('btn-save')).then((response) => {
      if (response.ok) {
        settingsDirty = false;
        showFieldIssues = false;
        markFieldIssues({});
        fillSettings(response.snapshot.settings);
        renderSettingsState();
      }
    });
  });
  // Reset asks first: it also replaces the continuation prompt.
  $('btn-reset').addEventListener('click', () => setResetConfirm(true));
  $('btn-reset-cancel').addEventListener('click', () => setResetConfirm(false));
  $('reset-confirm').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setResetConfirm(false); }
  });
  $('btn-reset-confirm').addEventListener('click', (e) => {
    void act({ type: 'RESET_SETTINGS' }, e.currentTarget as HTMLButtonElement).then((response) => {
      if (response.ok) {
        settingsDirty = false;
        showFieldIssues = false;
        markFieldIssues({});
        fillSettings(response.snapshot.settings);
      }
      setResetConfirm(false);
      renderSettingsState();
    });
  });

  void refresh();
  // Keep the status and countdown current while the panel is open.
  setInterval(() => void refresh(), 1000);
  setInterval(render, 250);
}

init();
