// Content script for chatgpt.com. Observes page state, reports status changes
// to the background worker and sends the continuation prompt when the
// background asks. It does not read, store or send the text of any
// conversation message.

import { DEFAULT_SUBMIT_TIMING, submitContinuation, type SubmitResult } from './composer.ts';
import { createDetector } from './detector.ts';
import { observePage } from './page.ts';
import { DEFAULT_SELECTORS } from './selectors.ts';
import type { ContentCommand, ContentReport } from '../shared/messages.ts';
import { createLogger } from '../shared/logger.ts';
import { loadSettings, SETTINGS_KEY } from '../shared/storage.ts';
import { normalizeSettings } from '../shared/settings.ts';

const log = createLogger('content');

function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function start(): void {
  let observer: MutationObserver | null = null;
  let pingTimer: number | null = null;
  let submitting = false;
  /** Responses this page already sent a continuation for. */
  const sentFor = new Set<string>();

  const send = (report: ContentReport) => {
    if (!extensionAlive()) {
      shutdown();
      return;
    }
    chrome.runtime.sendMessage(report).catch((error: unknown) => {
      // "Extension context invalidated" after an update/reload: stop quietly.
      if (!extensionAlive()) shutdown();
      else log.warn('Could not report to the extension', error);
    });
  };

  // Privacy-safe diagnostics: selector booleans/counts only, never message text.
  let lastDiagnostic = '';
  const readPage = () => {
    const observation = observePage(document, location.href, DEFAULT_SELECTORS);
    const diagnostic = JSON.stringify({ status: observation.status, ...observation.signals });
    if (diagnostic !== lastDiagnostic) {
      lastDiagnostic = diagnostic;
      console.info('[ChatGPT Autopilot] Page detection', JSON.parse(diagnostic));
    }
    return observation;
  };

  const detector = createDetector({
    read: readPage,
    emit: (observation) => send({ type: 'PAGE_OBSERVATION', observation }),
    timers: { setTimeout: (cb, ms) => window.setTimeout(cb, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
  });

  // The completion confirmation delay is a setting.
  const applySettings = (raw: unknown) => detector.setSettleMs(normalizeSettings(raw).confirmSeconds * 1000);
  void loadSettings(chrome.storage.local).then((settings) => detector.setSettleMs(settings.confirmSeconds * 1000)).catch(() => undefined);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue);
  });

  function shutdown() {
    observer?.disconnect();
    observer = null;
    if (pingTimer !== null) window.clearTimeout(pingTimer);
    detector.dispose();
  }

  observer = new MutationObserver(() => detector.schedule());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-testid', 'data-state', 'data-is-streaming', 'aria-label', 'aria-disabled', 'aria-busy', 'disabled', 'hidden', 'class', 'role'],
  });

  // ChatGPT is a single-page app: conversation switches do not reload the page.
  window.addEventListener('popstate', () => detector.schedule());
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener('navigatesuccess', () => detector.schedule());
  document.addEventListener('visibilitychange', () => detector.schedule());

  async function runSubmit(key: string, command: Extract<ContentCommand, { type: 'SUBMIT' }>): Promise<SubmitResult> {
    // Never two attempts at once, and never twice for the same response from this page.
    if (submitting || sentFor.has(key)) return { outcome: 'uncertain', detail: 'a continuation for this response was already attempted in this tab' };
    submitting = true;
    try {
      const result = await submitContinuation(document, () => location.href, DEFAULT_SELECTORS, command.request, {
        ...DEFAULT_SUBMIT_TIMING,
        sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      });
      if (result.outcome !== 'refused') sentFor.add(key);
      return result;
    } finally {
      submitting = false;
      detector.schedule();
    }
  }

  chrome.runtime.onMessage.addListener((message: ContentCommand, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
    switch (message.type) {
      case 'GET_OBSERVATION':
        sendResponse(detector.current());
        return false;
      case 'SUBMIT':
        if (typeof message.key !== 'string' || !message.request || typeof message.request.text !== 'string') return false;
        void runSubmit(message.key, message).then((result) => {
          sendResponse(result);
          // Also reported separately, so a background that restarted meanwhile still learns the outcome.
          send({ type: 'SUBMIT_REPORT', key: message.key, result });
        });
        return true; // answered asynchronously
      case 'SCHEDULE_PING': {
        if (typeof message.dueAt !== 'number' || typeof message.now !== 'number') return false;
        if (pingTimer !== null) window.clearTimeout(pingTimer);
        // Relative to the background's clock, so a skewed page clock does not matter.
        pingTimer = window.setTimeout(() => {
          pingTimer = null;
          send({ type: 'DUE_PING' });
        }, Math.max(0, message.dueAt - message.now) + 200);
        sendResponse(true);
        return false;
      }
      default:
        return false;
    }
  });

  send({ type: 'CONTENT_READY', observation: detector.current() });
  detector.evaluate();
}

try {
  start();
} catch (error) {
  log.error('Autopilot content script failed to start', error);
}
