# M3 design: stop on an explicit status marker

Status: **Proposed (2026-11-05). Not implemented.** Implementation starts only
after the owner approves this design.

## Goal

Stop repeating continuations when ChatGPT itself reports, in a predefined line,
that the milestone is complete or that it is blocked, without turning the
extension into something that reads or interprets conversations.

## Owner requirements (2026-11-05)

| # | Requirement | Where the design meets it |
|---|---|---|
| R1 | Only inspect the latest assistant answer | Reading rules 1–2 |
| R2 | Only detect an exact, predefined marker line | Marker grammar; reading rules 4–6 |
| R3 | Never store, transmit or log any conversation text | Privacy enforcement P1–P5 |
| R4 | Never include answer contents in diagnostic reports | P3 |
| R5 | Never interpret ordinary assistant messages as stop instructions | Reading rules 4–7; tests T-P |
| R6 | Explicitly configurable, can be disabled | Setting (off by default) |
| R7 | Missing, malformed or ambiguous marker → fail safely | Outcomes table |
| R8 | Document the change to the privacy promise | Documentation changes |

## Marker grammar

The convention already used by `templates/AUTOPILOT.md` (which today says "the
extension does not parse them"). Exactly three lines are markers:

```
AUTOPILOT STATUS: CONTINUE
AUTOPILOT STATUS: MILESTONE COMPLETE
AUTOPILOT STATUS: BLOCKED
```

- **Exact match** of the whole line, case-sensitive, after only these
  normalizations: trimming leading/trailing whitespace, and turning non-breaking
  spaces into spaces. Markdown emphasis (`**…**`) does not appear in the
  rendered text, so a bold marker matches too.
- Nothing else counts: no trailing period, no other words on the line, no
  translations, no lowercase variants.
- A line that **starts with** `AUTOPILOT STATUS:` but is not one of the three is
  **malformed**.

## Reading rules (content script)

One pure function, `readStatusMarker(message)`, in a new module
`src/content/statusMarker.ts`. It returns one value:
`'none' | 'continue' | 'complete' | 'blocked' | 'unclear'`.

1. **Only when the feature is on.** When it is off, the function is never called
   and the answer is never read (tested by counting text reads).
2. **Only the latest assistant answer**: the last element of the assistant
   message list (`findMessages(assistantMessage)`, the same list that gives the
   response key). User messages, older answers, the message box and the rest of
   the page are never read for markers.
3. **Only a finished answer**: called only when the page status is `complete`,
   never while ChatGPT is generating.
4. **Quoted text is excluded**: text inside `pre`, `code` and `blockquote`
   elements in the answer is skipped, so a marker shown as an example or a quote
   never counts.
5. **Last non-empty line only**: the marker counts only if it is the last
   non-empty line of the remaining text.
6. **Exactly one marker**: if a marker or a malformed `AUTOPILOT STATUS:` line
   appears anywhere else in the answer (not the last line), or the last line is
   malformed, the result is `unclear`.
7. **The text never leaves the function**: it is read into a local variable,
   compared and discarded. Only the enum value is returned.

Open point, to be settled by live validation (see "Risks"): whether ChatGPT puts
extra interface text (for example "Sources" or action labels) inside the
assistant message element after the answer. If it does, the reading is narrowed
to the answer's content element, found only from a live observation (D9 rule:
no guessed selectors).

## Outcomes (background state machine)

The marker joins the page observation as `signals.statusMarker` (enum only).
It is acted on only at the point where Autopilot would otherwise schedule a
continuation: a confirmed completion after an observed generation, for an
unanswered response. It is checked again in both prechecks right before sending.

| Marker | Effect | Panel guidance |
|---|---|---|
| `none` (no marker) | Same as today: the continuation is sent. The cycle limit still applies | — |
| `continue` | Same as today: the continuation is sent | — |
| `complete` | **Stopped**, reason "ChatGPT reports the milestone complete"; nothing sent | *Finished*: read the last answer; start again if more work is wanted |
| `blocked` | **Paused**, reason "ChatGPT reports it is blocked"; nothing sent | *Fix first*: read the last answer, provide what it needs, then Resume |
| `unclear` (malformed or ambiguous) | **Paused**, reason "Unclear status marker in the last answer"; nothing sent | *Fix first*: check the last answer, then Resume |

Why "no marker" continues: the feature is opt-in, and today's behaviour without
a marker is already safe (one continuation per finished answer, bounded by the
cycle limit). A forgotten marker can never cause a stop; a wrong or
half-written one pauses. Pausing on a missing marker too (a stricter mode) could
be added later as a second setting if the owner wants it; it is not part of
this design.

Pause/Stop by the user always takes precedence, and existing safeguards
(notices, composer text, conversation switch, …) are unchanged.

## Setting

- New setting **"Stop on status marker"**, **off by default**. Stored with the
  other settings (`stopOnMarker: boolean`); older stored settings get `false`.
- The panel explains what it does in one line next to the checkbox. Turning it
  on is the only way the extension ever reads answer text.
- The content script reads the setting the same way it reads the confirmation
  delay today (`chrome.storage.local`, updated on change).

## Privacy enforcement

| # | Guarantee | How it is enforced |
|---|---|---|
| P1 | Text read only when on, only from the latest answer, only when finished | Single reading function with these preconditions; unit tests that count text reads (0 when off, 0 while generating, 0 for user messages and older answers) |
| P2 | Text never stored, sent or logged | The function returns an enum; `PageSignals.statusMarker` is typed as that enum, and the message validator rejects anything else; a test feeds an answer full of a SECRET marker-like text and checks that the observation, the console diagnostic, the send diagnostic, the activity log and the stored session contain no SECRET |
| P3 | Never in diagnostic reports | The report includes only the enum and the setting; `test/report.test.ts` is extended with a SECRET answer |
| P4 | No second, unnoticed reader | A source-scan test lists every `innerText`/`textContent`/`.value` read in `src/` and fails if a new one appears outside an allowlist (today: the message box check in `composer.ts`, notice texts and the has-text check in `page.ts`, the message-box length in `sendDiagnostics.ts`; plus `statusMarker.ts`) |
| P5 | Activity log and notifications stay extension-written | Halt reasons and log lines are fixed strings ("ChatGPT reports the milestone complete"); the marker word itself is never copied from the page |

## Fit with the existing architecture

- Deterministic, not agentic: the extension matches three fixed lines; it does
  not interpret, summarize or decide anything about the work (principle 2).
- Reuses the existing paths: observation → detector (which reports a change of
  `statusMarker`) → state machine `observe('complete')` → prechecks. No new
  message types, permissions or storage areas.
- Fail-safe directions match principles 3–4: anything unclear pauses; nothing
  new can cause an extra send.
- Principle 10 / README privacy promise: changed only for the opt-in setting
  (see below).
- "A status marker is not proof that the work is correct" (`docs/ROADMAP.md`
  M3): the panel and README say that the marker is a signal from ChatGPT, not a
  verification.

## Documentation changes

- **README, "Permissions and privacy"**: new wording:
  > It never stores, sends or logs the text of your conversation. By default it
  > does not read it either. Only if you turn on **Stop on status marker**, it
  > reads the latest finished answer, outside code and quotes, only to check
  > whether its last line is exactly one of three status lines. That text is
  > discarded immediately.
- `CLAUDE.md` principle 10 and `AUTOPILOT.md` section 3 get the same exception.
- `templates/AUTOPILOT.md`: the comment "the extension does not parse them"
  becomes an explanation of the three exact lines and that the reply must end
  with one of them when the setting is on.
- `docs/LIVE_VALIDATION.md`: new M3 rows (below).

## Tests

- **Parser (T-P)**, `test/statusMarker.test.ts`:
  - each of the three markers exactly, bold, with surrounding whitespace or NBSP → detected;
  - lowercase, extra punctuation, extra words, a translation → `unclear` (malformed) or `none`;
  - a marker inside `code`, `pre` or `blockquote` → ignored;
  - a marker mentioned inline in a sentence → `none`;
  - a marker that is not the last line → `unclear`;
  - two different markers → `unclear`;
  - an empty answer → `none`.
- **Scope**: an older answer or a user message with a marker → ignored; reading
  happens only when the feature is on and the answer is finished (read counters).
- **State machine**: `complete` stops, `blocked` pauses, `unclear` pauses,
  `continue` and `none` continue. Feature off with a marker present → continues
  exactly as today. The marker re-checked in the prechecks. Pause/Stop by the
  user still win.
- **Privacy**: P2–P4 tests above.
- **E2E** (fake page): an answer ending in `AUTOPILOT STATUS: MILESTONE COMPLETE`
  stops the run with *Finished*; the same marker inside a code block, or with the
  setting off, does not; `BLOCKED` pauses.
- **Live** (owner): M3 rows. (1) The setting off: unchanged. (2) ChatGPT asked to
  end with `CONTINUE`: continues. (3) Asked to end with `MILESTONE COMPLETE`:
  stops. (4) `BLOCKED`: pauses. (5) The marker only inside a code block:
  continues. Plus a diagnostic report check that no answer text appears.

## Risks

| Risk | Mitigation |
|---|---|
| ChatGPT adds interface text inside the message element after the answer, so the marker is not the last line | Shows up as `none` (continue, safe) in live row (3); narrowed to the observed content element then |
| ChatGPT reformats the line (e.g. turns it into a heading or adds a period) | Not detected (continue) or `unclear` (pause): both safe; the template tells ChatGPT the exact form |
| The marker is detected on an answer that is not really finished | Read only on a confirmed completion (settle window), re-checked before sending |
| Reading text weakens the privacy promise | Opt-in, narrow, enforced and tested (P1–P5), and documented |

## Out of scope

Any other use of answer text; per-conversation settings; a stricter
"pause when the marker is missing" mode (possible later, separate decision).
