// Opt-in page-detection diagnostics for checking the selectors against the
// live ChatGPT site. Off by default. When on, each change in what the
// extension detects is logged to the tab's console (never sent anywhere).
// Only structure is reported: attribute values from a fixed list, booleans
// and counts. No message text, no composer text, no button titles.
//
// Turn on in the ChatGPT tab's DevTools console:
//   localStorage.setItem('chatgpt-autopilot:debug', '1')
// Turn off:
//   localStorage.removeItem('chatgpt-autopilot:debug')

import type { QueryRoot } from './page.ts';
import type { PageObservation } from '../shared/types.ts';

export const DEBUG_STORAGE_KEY = 'chatgpt-autopilot:debug';

/** Elements whose attributes describe turn and streaming state. */
const MARKER_SELECTOR =
  '[data-talvt-turn-state], [data-loading-indicator], [data-d-stream-word], [data-chatgpt-agent-turn-start], [data-is-streaming]';
const MAX_MARKERS = 12;
const MAX_BUTTONS = 20;
/** Attribute values longer than this are cut; labels are short, anything longer is not a label. */
const MAX_VALUE_LENGTH = 60;

export interface StorageLike {
  getItem(key: string): string | null;
}

export function diagnosticsEnabled(storage: StorageLike | undefined): boolean {
  try {
    return storage?.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    // Storage can be blocked; diagnostics simply stay off.
    return false;
  }
}

interface AttributeSource {
  getAttribute(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

function attr(element: AttributeSource, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null ? null : value.slice(0, MAX_VALUE_LENGTH);
}

function safeAll(root: QueryRoot, selector: string): AttributeSource[] {
  try {
    return Array.from(root.querySelectorAll(selector)) as AttributeSource[];
  } catch {
    return [];
  }
}

export interface PageDiagnostic {
  status: PageObservation['status'];
  responseKey: string | null;
  signals: PageObservation['signals'];
  markers: Record<string, string | boolean | null>[];
  buttons: Record<string, string | boolean | null>[];
}

export function collectDiagnostic(root: QueryRoot, observation: PageObservation): PageDiagnostic {
  const markers = safeAll(root, MARKER_SELECTOR)
    .slice(-MAX_MARKERS)
    .map((element) => ({
      conversationRole: attr(element, 'data-conversation-role'),
      turnState: attr(element, 'data-talvt-turn-state'),
      loadingIndicator: attr(element, 'data-loading-indicator'),
      streamingWord: element.hasAttribute?.('data-d-stream-word') ?? element.getAttribute('data-d-stream-word') !== null,
      isStreaming: attr(element, 'data-is-streaming'),
      state: attr(element, 'data-state'),
      ariaBusy: attr(element, 'aria-busy'),
      testId: attr(element, 'data-testid') ?? attr(element, 'data-test-id'),
    }));
  const buttons = safeAll(root, 'button')
    .slice(-MAX_BUTTONS)
    .map((button) => ({
      ariaLabel: attr(button, 'aria-label'),
      testId: attr(button, 'data-testid') ?? attr(button, 'data-test-id'),
      disabled: (button as { disabled?: boolean }).disabled === true || button.getAttribute('aria-disabled') === 'true',
    }));
  return { status: observation.status, responseKey: observation.responseKey, signals: observation.signals, markers, buttons };
}

/** Logs a value when its key differs from the previous one's. */
export function createChangeLogger<T>(log: (value: T) => void, keyOf: (value: T) => string = (v) => JSON.stringify(v)) {
  let last = '';
  return (value: T) => {
    const key = keyOf(value);
    if (key === last) return;
    last = key;
    log(value);
  };
}

/** Logs a diagnostic when it differs from the previous one. */
export function createDiagnosticLogger(log: (diagnostic: PageDiagnostic) => void) {
  return createChangeLogger(log);
}
