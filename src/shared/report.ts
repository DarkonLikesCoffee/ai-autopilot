// The diagnostic report the panel copies in one step (M2, T10). It holds
// technical state only, so it can be shared to get help.
//
// Never included: the continuation prompt, tab titles (they are conversation
// titles), conversation ids, response keys or message ids, message text,
// message-box text and notice text. Each of those is replaced by a length, a
// count or a kind. The activity log is included: its messages are written by
// the extension and contain no page text.

import { DEFAULT_PROMPT } from './settings.ts';
import { haltGuidance } from './guidance.ts';
import { isSavedConversation } from './session.ts';
import type { UiSnapshot } from './messages.ts';
import type { PageObservation } from './types.ts';
import type { SendDiagnostic } from '../content/sendDiagnostics.ts';

export const REPORT_VERSION = 1;

export interface ReportInput {
  snapshot: UiSnapshot;
  /** A fresh observation of the session's tab, if it answered. */
  observation: PageObservation | null;
  /** The content script's record of the last send attempt, if any. */
  lastSend: SendDiagnostic | null;
  environment: { extensionVersion: string; userAgent: string };
}

/** "saved" for a /c/<id> conversation, "new" for an unsaved chat, never the id itself. */
function conversationKind(path: string | null): 'saved' | 'new' | null {
  if (path === null) return null;
  return isSavedConversation(path) ? 'saved' : 'new';
}

/** The form of a response key ("id" or "count"), never the key itself. */
function keyKind(key: string | null): 'id' | 'count' | null {
  if (key === null) return null;
  return key.includes('|id:') ? 'id' : 'count';
}

function pathKind(url: string): 'saved' | 'new' | 'other' {
  try {
    const path = new URL(url).pathname;
    if (isSavedConversation(path)) return 'saved';
    return path === '/' ? 'new' : 'other';
  } catch {
    return 'other';
  }
}

/** Times as offsets from the report time, in seconds, so no clock or date is needed to read them. */
function since(now: number, at: number | null): number | null {
  return at === null ? null : Math.round((at - now) / 1000);
}

export function buildDiagnosticReport(input: ReportInput): Record<string, unknown> {
  const { snapshot, observation, lastSend, environment } = input;
  const { settings, session, now } = snapshot;
  return {
    report: 'ChatGPT Autopilot diagnostic report',
    reportVersion: REPORT_VERSION,
    note: 'Technical state only: no prompt, conversation, message, message-box or notice text.',
    extensionVersion: environment.extensionVersion,
    userAgent: environment.userAgent,
    settings: {
      prompt: { length: settings.prompt.length, isDefault: settings.prompt === DEFAULT_PROMPT },
      delaySeconds: settings.delaySeconds,
      confirmSeconds: settings.confirmSeconds,
      maxCycles: settings.maxCycles,
      notifications: settings.notifications,
      stopOnMarker: settings.stopOnMarker,
    },
    session: {
      run: session.run,
      phase: session.phase,
      reason: session.reason,
      guidance: haltGuidance(session.reason)?.kind ?? null,
      detail: session.detail,
      cycles: session.cycles,
      conversation: conversationKind(session.conversation),
      generationSeen: session.generationSeen,
      pendingKey: keyKind(session.pendingKey),
      markerPauseResumed: session.markerAcknowledgedKey !== null,
      answeredResponses: session.answeredKeys.length,
      lastStatus: session.lastStatus,
      secondsFromNow: {
        dueAt: since(now, session.dueAt),
        submitStartedAt: since(now, session.submitStartedAt),
        lastContinuationAt: since(now, session.lastContinuationAt),
        awaitingResponseSince: since(now, session.awaitingResponseSince),
        startedAt: since(now, session.startedAt),
        updatedAt: since(now, session.updatedAt),
      },
      log: session.log.map((entry) => ({ secondsFromNow: since(now, entry.at), message: entry.message })),
    },
    tabs: {
      sessionTabFound: snapshot.sessionTab !== null,
      sessionTabConversation: snapshot.sessionTab ? conversationKind(snapshot.sessionTab.conversation) : null,
      activeChatgptTabFound: snapshot.activeTab !== null,
      activeTabIsSessionTab: !!snapshot.activeTab && !!snapshot.sessionTab && snapshot.activeTab.tabId === snapshot.sessionTab.tabId,
    },
    page: observation
      ? { answered: true, status: observation.status, responseKey: keyKind(observation.responseKey), page: pathKind(observation.url), signals: observation.signals }
      : { answered: false },
    lastSendAttempt: lastSend,
  };
}

export function formatDiagnosticReport(input: ReportInput): string {
  return JSON.stringify(buildDiagnosticReport(input), null, 2);
}
