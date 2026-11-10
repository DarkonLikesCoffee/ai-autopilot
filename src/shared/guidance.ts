// What the user should do after each halt (M2, T11). Every reason is one of:
//   resume   — nothing to fix; press Resume when you want to continue
//   fix      — do the one thing described first, then press Resume
//   finished — the run is over; start again for more
// A Record over HaltReason, so a new reason without guidance does not compile.

import type { HaltReason } from './types.ts';

export type HaltKind = 'resume' | 'fix' | 'finished';

export interface HaltGuidance {
  kind: HaltKind;
  /** One line: what to do. Never contains page or conversation text. */
  action: string;
}

export const HALT_GUIDANCE: Record<HaltReason, HaltGuidance> = {
  user: { kind: 'resume', action: 'Press Resume to continue.' },
  max_cycles: { kind: 'finished', action: 'To continue, raise Maximum cycles in Settings and start again.' },
  usage_limit: { kind: 'fix', action: 'Wait until the limit is lifted, then press Resume. Autopilot never retries on its own.' },
  auth_required: { kind: 'fix', action: 'Log in in the ChatGPT tab, open the conversation, then press Resume.' },
  page_error: { kind: 'fix', action: 'Check the ChatGPT tab and reload it if needed, then press Resume.' },
  conversation_changed: { kind: 'fix', action: 'Go back to the original conversation and press Resume, or press Stop and start in the new one.' },
  tab_closed: { kind: 'fix', action: 'Open the conversation again, then press Resume.' },
  browser_restarted: { kind: 'fix', action: 'Open the conversation again, then press Resume.' },
  composer_has_text: { kind: 'fix', action: 'Send or clear your text, then press Resume. Your text was not changed.' },
  submit_failed: { kind: 'fix', action: 'Check the ChatGPT tab, then press Resume. If it happens again, copy the diagnostic report.' },
  submission_uncertain: { kind: 'fix', action: 'Check the conversation: if the continuation is missing, send it yourself. Then press Resume; that answer is not continued again.' },
  tab_unreachable: { kind: 'fix', action: 'Reload the ChatGPT tab, then press Resume.' },
  unrecognized_notice: { kind: 'fix', action: 'Read the notice in the ChatGPT tab, then press Resume. If it is not in English, report its exact text.' },
  no_response: { kind: 'fix', action: 'Check the ChatGPT tab for a notice, then press Resume.' },
  no_new_answer: { kind: 'fix', action: 'Check the last answer (it may have ended with an error), then press Resume.' },
  marker_complete: { kind: 'finished', action: 'Check the result yourself: the status line is ChatGPT\'s own report, not a verification. Start again for more work.' },
  // Resume acknowledges only that answer (markerAcknowledgedKey): it gets at most one
  // continuation, and later answers' status lines are checked again. Sending a message
  // yourself does not resume Autopilot.
  marker_blocked: { kind: 'fix', action: 'Read the last answer. Send ChatGPT what it needs yourself, then press Resume; or press Resume now to send the continuation to this answer once. Later answers are checked again.' },
  marker_unclear: { kind: 'fix', action: 'Its last line must be exactly one of the three status lines. Press Resume to send the continuation to this answer once. Later answers are checked again.' },
};

export const HALT_KIND_LABEL: Record<HaltKind, string> = {
  resume: 'Resume when ready',
  fix: 'Fix first',
  finished: 'Finished',
};

export function haltGuidance(reason: HaltReason | null): HaltGuidance | null {
  return reason ? HALT_GUIDANCE[reason] : null;
}
