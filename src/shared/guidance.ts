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
  user: { kind: 'resume', action: 'Press Resume when you want Autopilot to continue.' },
  max_cycles: { kind: 'finished', action: 'The maximum was reached. Raise it in Settings and start again if you want more continuations.' },
  usage_limit: { kind: 'fix', action: 'Wait until ChatGPT lifts the usage limit, then press Resume. Autopilot never retries on its own.' },
  auth_required: { kind: 'fix', action: 'Log in to ChatGPT in that tab, open the conversation again, then press Resume.' },
  page_error: { kind: 'fix', action: 'Check the ChatGPT page and reload it if needed; press Resume once the conversation works again.' },
  conversation_changed: { kind: 'fix', action: 'Go back to the original conversation in that tab and press Resume, or press Stop and start in the new one.' },
  tab_closed: { kind: 'fix', action: 'Open the conversation again, then press Resume.' },
  browser_restarted: { kind: 'fix', action: 'Open the conversation again, then press Resume.' },
  composer_has_text: { kind: 'fix', action: 'Send or clear the text in the message box, then press Resume. Your text was not touched.' },
  submit_failed: { kind: 'fix', action: 'Check the ChatGPT page. If it keeps happening, copy the diagnostic report (Activity) for an issue. Then press Resume.' },
  submission_uncertain: { kind: 'fix', action: 'Look at the conversation: if the continuation is not there, send it yourself. Then press Resume; that response is not answered again.' },
  tab_unreachable: { kind: 'fix', action: 'Reload the ChatGPT tab, then press Resume.' },
  unrecognized_notice: { kind: 'fix', action: 'Read the notice on the ChatGPT page and deal with it, then press Resume. If it is not in English, please report its exact text.' },
  no_response: { kind: 'fix', action: 'Check the ChatGPT page for a notice or error; press Resume once ChatGPT answers again.' },
  no_new_answer: { kind: 'fix', action: 'Check the last answer on the page (it may have ended in an error); press Resume to wait for the next finished answer.' },
};

export const HALT_KIND_LABEL: Record<HaltKind, string> = {
  resume: 'Resume when ready',
  fix: 'Fix first',
  finished: 'Finished',
};

export function haltGuidance(reason: HaltReason | null): HaltGuidance | null {
  return reason ? HALT_GUIDANCE[reason] : null;
}
