// Turns a snapshot into what the panel shows. Pure, so it can be tested.

import type { UiSnapshot } from '../shared/messages.ts';
import { haltSentence } from '../shared/session.ts';
import { HALT_KIND_LABEL, haltGuidance, type HaltKind } from '../shared/guidance.ts';
import type { SessionState } from '../shared/types.ts';

/** Guidance is shown when paused or in error, and when stopped by the limit; not after your own Stop. */
export function guidanceFor(session: SessionState): PanelView['guidance'] {
  const showable = session.run === 'paused' || session.run === 'error' || (session.run === 'stopped' && (session.reason === 'max_cycles' || session.reason === 'marker_complete'));
  const g = showable ? haltGuidance(session.reason) : null;
  return g ? { label: HALT_KIND_LABEL[g.kind], kind: g.kind, action: g.action } : null;
}
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
  /** After a halt: "Resume when ready" / "Fix first" / "Finished" and one line on what to do; null otherwise. */
  guidance: { label: string; kind: HaltKind; action: string } | null;
}

export const GENERATION_TEXT: Record<ResponseStatus, string> = {
  unknown: 'Not recognized',
  idle: 'Idle',
  generating: 'Answering',
  complete: 'Answer finished',
  error: 'Shows an error',
  usage_limit: 'Shows a usage limit',
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
  waiting_delay: 'Continuation in …',
  paused: 'Paused',
  error: 'Stopped by an error',
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

  const reasonDetail = session.reason ? haltSentence(session.reason, session.detail) : '';
  let detail: string;
  switch (status) {
    case 'waiting_chatgpt':
      detail = session.generationSeen || session.lastStatus === 'generating'
        ? 'ChatGPT is answering. Autopilot sends the continuation after the answer is finished.'
        : 'Waiting for ChatGPT. Send your first message yourself to begin.';
      break;
    case 'waiting_delay':
      detail = 'The answer is finished. The continuation is sent when the countdown ends.';
      break;
    case 'running':
      detail = 'Sending the continuation…';
      break;
    case 'stopped':
      detail = session.reason && session.reason !== 'user' ? reasonDetail : 'Open the ChatGPT conversation you want to continue, then press Start.';
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
    statusLabel: status === 'waiting_delay' && countdown !== '—' ? `Continuation in ${countdown}` : STATUS_LABEL[status],
    tone: TONE[status],
    detail,
    canStart: session.run === 'stopped' && activeTab !== null,
    canPause: session.run === 'running',
    canResume: session.run === 'paused' || session.run === 'error',
    canStop: session.run !== 'stopped',
    startHint: session.run === 'stopped' && activeTab === null ? 'Open a ChatGPT conversation in this window, then press Start.' : null,
    conversation,
    cycles: `${session.cycles} / ${limit}`,
    generation: GENERATION_TEXT[session.lastStatus],
    countdown,
    lastContinuation: formatClock(session.lastContinuationAt),
    lastError: halted && reasonDetail ? reasonDetail : '—',
    guidance: guidanceFor(session),
  };
}
