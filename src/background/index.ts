// Service worker entry point: wires chrome.* APIs to the controller.

import { createController, type Scheduler, type TabAccess } from './controller.ts';
import { isContentReport, isPageObservation, isSubmitResult, isUiRequest, type ContentCommand, type TabInfo } from '../shared/messages.ts';
import { createLogger } from '../shared/logger.ts';
import { conversationPath } from '../shared/session.ts';
import { loadSession } from '../shared/storage.ts';
import type { SessionState } from '../shared/types.ts';

const log = createLogger('background');
const CHATGPT_PATTERNS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const ALARM = 'autopilot-due';
/** Cleared by Chrome only when the browser restarts; tells a browser restart from a worker restart. */
const ALIVE_KEY = 'autopilot.browserSession';

export function isChatgptUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'chatgpt.com' || hostname === 'chat.openai.com');
  } catch {
    return false;
  }
}

function info(tab: chrome.tabs.Tab | undefined): TabInfo | null {
  if (!tab || tab.id === undefined || !isChatgptUrl(tab.url)) return null;
  return { tabId: tab.id, title: tab.title ?? '', conversation: conversationPath(tab.url ?? '') };
}

const tabs: TabAccess = {
  async activeChatgptTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return info(active);
  },
  async tabInfo(tabId) {
    try {
      return info(await chrome.tabs.get(tabId));
    } catch {
      return null;
    }
  },
  async findConversationTab(path) {
    const all = await chrome.tabs.query({ url: CHATGPT_PATTERNS });
    const matches = all.filter((tab) => tab.url && conversationPath(tab.url) === path);
    return matches.length === 1 ? matches[0]?.id ?? null : null;
  },
  async getObservation(tabId) {
    const command: ContentCommand = { type: 'GET_OBSERVATION' };
    const response: unknown = await chrome.tabs.sendMessage(tabId, command);
    return isPageObservation(response) ? response : null;
  },
  async submit(tabId, key, request) {
    const command: ContentCommand = { type: 'SUBMIT', key, request };
    const response: unknown = await chrome.tabs.sendMessage(tabId, command);
    return isSubmitResult(response) ? response : null;
  },
  async schedulePing(tabId, dueAt, now) {
    const command: ContentCommand = { type: 'SCHEDULE_PING', dueAt, now };
    await chrome.tabs.sendMessage(tabId, command);
  },
};

// Three independent wake-ups for the end of the delay, all idempotent: a timer
// (precise while the worker runs), an alarm (survives the worker being
// stopped) and a ping from the page (see SCHEDULE_PING).
let timer: ReturnType<typeof setTimeout> | null = null;
const scheduler: Scheduler = {
  async schedule(dueAt) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void controller.handleDue();
    }, Math.max(0, dueAt - Date.now()));
    await chrome.alarms.create(ALARM, { when: dueAt });
  },
  async cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    await chrome.alarms.clear(ALARM);
  },
};

const BADGES = {
  running: { text: '▶', color: '#1a7f37' },
  delay: { text: '…', color: '#0969da' },
  paused: { text: 'II', color: '#9a6700' },
  error: { text: '!', color: '#cf222e' },
} as const;

async function updateBadge(state: SessionState): Promise<void> {
  const badge = state.run === 'running' ? (state.phase === 'watching' ? BADGES.running : BADGES.delay) : state.run === 'paused' ? BADGES.paused : state.run === 'error' ? BADGES.error : null;
  try {
    await chrome.action.setBadgeText({ text: badge?.text ?? '' });
    if (badge) await chrome.action.setBadgeBackgroundColor({ color: badge.color });
    const status = state.run === 'stopped' ? 'stopped' : `${state.run}, ${state.cycles} continuation${state.cycles === 1 ? '' : 's'} sent`;
    await chrome.action.setTitle({ title: `ChatGPT Autopilot — ${status}` });
  } catch (error) {
    log.warn('Badge update failed', error);
  }
}

const controller = createController({
  storage: chrome.storage.local,
  tabs,
  scheduler,
  now: () => Date.now(),
  log,
  onStateChange: updateBadge,
  async notify(request) {
    await chrome.notifications.create(request.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: request.title,
      message: request.message,
      priority: 2,
    });
  },
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // Extension pages (popup, side panel) send UI requests; content scripts on
  // ChatGPT send page reports. Nothing else is accepted.
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) === true;
  if (!fromExtensionPage) {
    if (sender.tab?.id !== undefined && isContentReport(message) && isChatgptUrl(sender.url ?? sender.tab.url)) {
      void controller.handleContent(sender.tab.id, message);
    }
    return false;
  }
  if (isUiRequest(message)) {
    controller.handleUi(message).then(sendResponse, (error: unknown) => {
      log.error('UI request failed', error);
      sendResponse({ ok: false, error: 'The extension could not process the request.' });
    });
    return true; // keep the channel open for the async response
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void controller.handleDue();
});
chrome.tabs.onRemoved.addListener((tabId) => void controller.handleTabRemoved(tabId));

chrome.notifications.onClicked.addListener((notificationId) => {
  void (async () => {
    const state = await loadSession(chrome.storage.local);
    if (state.tabId !== null) {
      try {
        const tab = await chrome.tabs.update(state.tabId, { active: true });
        if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        // The tab no longer exists.
      }
    }
    await chrome.notifications.clear(notificationId);
  })();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch((error: unknown) => log.warn('Side panel setup failed', error));
});

// Every time the worker starts: after a browser restart the session pauses
// (tab ids are no longer valid); after Chrome merely stopped the worker, the
// pending delay is picked up again.
void (async () => {
  try {
    const marker = await chrome.storage.session.get(ALIVE_KEY);
    if (marker[ALIVE_KEY]) {
      await controller.handleWake();
    } else {
      await chrome.storage.session.set({ [ALIVE_KEY]: true });
      await controller.handleStartup();
    }
    await updateBadge(await loadSession(chrome.storage.local));
  } catch (error) {
    log.error('Could not restore the session state', error);
  }
})();
