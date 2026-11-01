// Turns a snapshot into what the panel shows. Pure, so it can be tested.

import type { UiSnapshot } from '../shared/messages.ts';
import { REASON_TEXT } from '../shared/session.ts';
import { isUnlimited } from '../shared/settings.ts';
import type { ResponseStatus } from '../shared/types.ts';

export type StatusKey = 'stopped' | 'running' | 'waiting_chatgpt' | 'waiting_delay' | 'paused' | 'error';
export type Tone = 'neutral' | 'active' | 'waiting' | 'warning' | 'danger';

export interface PanelView {
  status: StatusKey;
  statusLabel: string;
  tone: Tone;
  /** Why it is paused, stopped or in error; or what it is doing now. */
  detail: string;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  /** Why Start is unavailable, if it is. */
  startHint: string | null;
  conversation: string;
  cycles: string;
  generation: string;
  countdown: string;
  lastContinuation: string;
  lastError: string;
}

export const GENERATION_TEXT: Record<ResponseStatus, string> = {
  unknown: 'Unknown',
  idle: 'Idle',
  generating: 'Generating',
  complete: 'Finished',
  error: 'Error shown',
  usage_limit: 'Usage limit shown',
};

export function formatClock(at: number | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

const STATUS_LABEL: Record<StatusKey, string> = {
  stopped: 'Stopped',
  running: 'Running',
  waiting_chatgpt: 'Waiting for ChatGPT',
  waiting_delay: 'Waiting before continuation',
  paused: 'Paused',
  error: 'Error',
};

const TONE: Record<StatusKey, Tone> = {
  stopped: 'neutral',
  running: 'active',
  waiting_chatgpt: 'active',
  waiting_delay: 'waiting',
  paused: 'warning',
  error: 'danger',
};

/** @param now the current time on the background's clock */
export function buildView(snapshot: UiSnapshot, now: number): PanelView {
  const { session, settings, sessionTab, activeTab } = snapshot;
  let status: StatusKey;
  if (session.run === 'running') {
    status = session.phase === 'delay' ? 'waiting_delay' : session.phase === 'submitting' ? 'running' : 'waiting_chatgpt';
  } else {
    status = session.run;
  }

  const reasonText = session.reason ? REASON_TEXT[session.reason] : '';
  const reasonDetail = reasonText ? `${reasonText}${session.detail ? `: ${session.detail}` : ''}.` : '';
  let detail: string;
  switch (status) {
    case 'waiting_chatgpt':
      detail = session.generationSeen || session.lastStatus === 'generating'
        ? 'ChatGPT is working. The continuation is sent after it finishes.'
        : 'Waiting for ChatGPT to start and finish a response. Send a message to begin.';
      break;
    case 'waiting_delay':
      detail = 'ChatGPT finished. The continuation prompt is sent when the countdown ends.';
      break;
    case 'running':
      detail = 'Sending the continuation prompt…';
      break;
    case 'stopped':
      detail = session.reason && session.reason !== 'user' ? reasonDetail : 'Start Autopilot in the ChatGPT conversation you want to continue.';
      break;
    default:
      detail = session.reason === 'user' ? 'Paused by you.' : reasonDetail || (status === 'paused' ? 'Paused.' : 'Something needs your attention.');
  }

  const limit = isUnlimited(settings) ? '∞' : String(settings.maxCycles);
  const tab = sessionTab ?? (session.run === 'stopped' ? activeTab : null);
  const conversation = tab ? (tab.title || tab.conversation || 'ChatGPT') : session.conversation ? `${session.conversation} (tab not open)` : '—';
  const countdown = session.run === 'running' && session.phase === 'delay' && session.dueAt !== null ? formatRemaining(session.dueAt - now) : '—';
  const halted = session.run === 'error' || (session.run !== 'running' && session.reason !== null && session.reason !== 'user');

  return {
    status,
    statusLabel: STATUS_LABEL[status],
    tone: TONE[status],
    detail,
    canStart: session.run === 'stopped' && activeTab !== null,
    canPause: session.run === 'running',
    canResume: session.run === 'paused' || session.run === 'error',
    canStop: session.run !== 'stopped',
    startHint: session.run === 'stopped' && activeTab === null ? 'Open a ChatGPT conversation in this window to start.' : null,
    conversation,
    cycles: `${session.cycles} / ${limit}`,
    generation: GENERATION_TEXT[session.lastStatus],
    countdown,
    lastContinuation: formatClock(session.lastContinuationAt),
    lastError: halted && reasonDetail ? reasonDetail : '—',
  };
}
