# Live ChatGPT validation procedure

The automated tests run against a fake page. This procedure checks the
extension against the real ChatGPT site. It must be run by a person with a
ChatGPT account; a cloud development session cannot do it. Record each run in
`AUTOPILOT.md` (section 11) with the date, browser version, ChatGPT UI language
and the result of every step as PASS, FAIL or NOT RUN.

Use a throwaway conversation that is **not** connected to a real repository, and
set **Maximum cycles** to 2 so a fault cannot run away.

## Setup

1. `npm ci && npm run build`, load `dist/` unpacked (see README), reload ChatGPT tabs.
2. Open a new ChatGPT conversation and send a short first message yourself, so
   the URL becomes `/c/<id>`.
3. Open DevTools on that tab and turn on detection diagnostics:

   ```js
   localStorage.setItem('chatgpt-autopilot:debug', '1')
   ```

   Each change in what the extension detects is now logged as
   `[ChatGPT Autopilot] Page detection`. It contains status, response key,
   counts, booleans and a fixed list of attribute values (button `aria-label`
   and `data-testid`, turn/streaming markers). It never contains message or
   composer text. Nothing leaves the tab.

## Detection (no sending)

| # | Do | Expect in the diagnostic log |
|---|---|---|
| D1 | Idle conversation with one finished answer | `status: "complete"`, `composerFound: true`, `assistantMessageCount` equals the visible answers (not double), `responseKey` ends in `id:<…>` |
| D2 | Send a long question yourself and watch it stream | `status: "generating"` for the whole stream (`stopControlFound` or `streamingMarkerFound` true), then `complete` once it ends |
| D3 | Compare `userMessageCount` before and after D2 | Increases by exactly 1 |
| D4 | Type a draft into the box, do not send | `composerHasText: true` |
| D5 | Regenerate the last answer | `generating`, then `complete`; note whether `responseKey` changed |
| D6 | Switch to another conversation in the sidebar | `responseKey` path changes to the new `/c/<id>` |

If any row fails, save the logged diagnostic (it is text-free) and update
`src/content/selectors.ts`; add a unit test in `test/page.test.ts` that
reproduces the observed markup.

## Sending (Maximum cycles = 2 or 3)

| # | Do | Expect |
|---|---|---|
| S1 | Start Autopilot after an answer finished | After the delays, exactly one continuation is sent; Activity shows it confirmed |
| S2 | Let it run | It stops at 2 continuations; never two messages for one answer |
| S3 | Start again, type into the box during the countdown | Paused; your text untouched and not sent |
| S4 | Start again, switch conversation during the countdown | Paused; nothing sent in either conversation |
| S5 | Start, then move the tab behind another tab in the same window | Continuation still sent to the session's tab (record if it fails) |
| S6 | Start, then minimise the window or switch to another window | Record exactly what happens (hidden-tab behaviour is not yet established) |
| P1 | During the countdown press Pause, later Resume; separately press Stop | Pause/Stop: nothing sent. Resume: one continuation after a fresh delay |

Note for S3: Autopilot pauses **when the countdown ends** (its last check before
sending sees text in the box), not at the moment you start typing.

## Notices and recovery (record when they happen)

| # | Situation | Expect |
|---|---|---|
| N1 | A usage-limit notice appears | Error, "ChatGPT shows a usage limit"; nothing sent; not retried |
| N2 | Logged out / session expired | Error, "ChatGPT asks you to log in"; nothing sent |
| N3 | A ChatGPT error notice ("Something went wrong", network error) | Error, "ChatGPT shows an error"; nothing sent |
| R1 | Close the ChatGPT tab during the countdown | Paused, "The ChatGPT tab was closed"; nothing sent |
| R2 | Quit and reopen the browser while running | Paused, "The browser or the extension restarted"; nothing sent until you resume |

The status of every row is kept in `AUTOPILOT.md` → "Live test matrix".

Turn diagnostics off afterwards:

```js
localStorage.removeItem('chatgpt-autopilot:debug')
```

## Reporting a problem

The quickest capture is **Copy diagnostic report** in the panel's Activity
section, right after the problem. It contains technical state only (see
README). Paste it into the issue. The console captures below give more detail
when the report is not enough.

## When a continuation cannot be sent ("the send button did not become available")

Capture two things from the same ChatGPT tab and paste both into an issue or
the AUTOPILOT.md history. Neither contains message text, the prompt, the
message-box text or any button text.

**A. The extension's own record of the failing attempt**

1. In the ChatGPT tab's DevTools console:
   `localStorage.setItem('chatgpt-autopilot:debug', '1')`, then reload the tab.
2. Start Autopilot and let it fail as before.
3. In the console, filter for `Send step`. You should see `typed`,
   `waiting_for_send_button` (once per change) and `send_button_unavailable`.
4. Right-click the `send_button_unavailable` entry's object → **Copy object**
   (and the `typed` one).

**B. A baseline: what Send looks like when you type yourself**

1. Click into the empty message box and type a single word by hand. Do not send it.
2. Paste the contents of [`docs/send-probe.js`](send-probe.js) into the console
   and press Enter. Copy the JSON it returns.
3. Delete your word again.

How to read them:

| A shows | B shows | Meaning |
|---|---|---|
| `sendSelectors` all empty; `nearbyButtons` has no send-like button | a button that no `sendSelectors` entry matches | Selectors are outdated: B's attributes give the new selector |
| `chosen.usable: false` (or only a voice/dictation button), `composer.holdsPrompt: true` | a usable button matched by a selector | ChatGPT did not register the inserted text (editor state); see `insertion` and `hiddenTextarea` |
| `chosen` is a hidden or different button while another match is usable | — | The first-visible-match rule picks the wrong button |
| a usable button only late (`elapsedMs` > 3000) | — | The 3 s wait is too short |

### Adding a language

If B shows a send (or stop) button whose only identifying attribute is a
localized `aria-label`, add that label, copied exactly, to `LOCALIZED_LABELS`
in `src/content/selectors.ts` under the UI language (`uiLanguage` in B), with
where it was observed as `source`. Add the same selector to the `SEND` list in
`docs/send-probe.js` (a unit test checks they match) and a test in
`test/localizedSend.test.ts` built from the observed structure. Never add a
translation that was not observed, and never a generic selector such as
`button[type="submit"]`.

## Recorded runs

Only what the owner observed and reported is recorded here. A row not listed
was not run.

### Run 1 — 2026-11-04, es-ES — FAIL (fixed in #12)

- Interface: ChatGPT web, Spanish (`es-ES`). Build: `main` before #12.
- Result: detection worked; the prompt was inserted, then the run stopped with
  "The continuation could not be sent: the send button did not become available."
- Activity log as reported:

  ```
  13:14:02 ChatGPT is generating a response.
  13:14:09 Response complete. Continuation 1 in 10s.
  13:14:19 Sending continuation 1.
  13:14:23 Error: The continuation could not be sent (the send button did not become available).
  ```
- Diagnostics (A) as reported: `holdsPrompt: true`, `proseMirror: true`,
  `execCommandReturned: true`; all four send selectors matched nothing. The
  page's send control: `<button aria-label="Enviar" type="submit">`.
- Root cause: no selector for the Spanish label. Fixed in #12 (`LOCALIZED_LABELS`).

### Run 2 — reported 2026-11-05, es-ES — PASS

- Interface: ChatGPT web, Spanish (`es-ES`). Build: `main` after #12 (the
  exact commit was not stated). Maximum cycles: 3.
- Reported results:

  | Row | Result |
  |---|---|
  | D2 (completion detection) | PASS — each finished response was detected as complete |
  | S1 (one continuation per finished response) | PASS — three continuations were submitted, each confirmed as sent; ChatGPT answered each |
  | S2 (cycle limit) | PASS — stopped exactly at the maximum (3) |
  | D1, D3–D6, S3–S6 | NOT RUN |
- Activity log: not captured verbatim in this record (not included in the report).
- Not established by this run: composer protection (S3), conversation
  switching (S4, D6), background/hidden tabs (S5, S6), regenerated answers
  (D5), usage-limit/login/error notices, and any interface language other than
  Spanish.

### Run 3 — reported 2026-11-05 — PASS

- Interface language and build: not stated in the report (runs 1–2 were es-ES
  on `main` after #12).
- Reported results:

  | Row | Result |
  |---|---|
  | S3 (typing during the countdown) | PASS |
  | S4 (conversation switching during the countdown) | PASS |
  | D5 (regenerating answers) | PASS |
  | S5 (session tab behind another tab) | PASS |
  | S6 (minimised browser) | PASS — which of the two safe outcomes occurred (sent once, or stopped with an error and the prompt removed) was not stated |
  | D1, D3, D4, D6, P1, N1–N3, R1–R2, L2 | NOT RUN (not part of this report) |
- Activity log: not included in the report.

### Run 4 — reported 2026-11-05 — PASS

- Interface language and build: not stated (runs 2–3 were es-ES).
- Reported results:

  | Row | Result |
  |---|---|
  | P1 (Pause, Resume, Stop during the countdown) | PASS |
  | S6 (minimised browser, from run 3) | Clarified: Autopilot kept working normally, i.e. the continuation was sent (once) |
- Activity log: not included in the report.

### Needed after the notice fail-safe change

The change adds three pauses (below). Re-run **S1–S2** on the es-ES interface
to confirm the normal flow is not paused by a notice ChatGPT shows routinely,
and record the result as Run 5.

### Run 5 — reported 2026-11-05, es-ES — PASS (regression check after #18)

- Interface: ChatGPT web, Spanish (`es-ES`). Build: `main` after #18 (the
  exact commit was not stated). Maximum cycles: 3.
- Reported results:

  | Row | Result |
  |---|---|
  | R5 / S1 (one continuation per finished response) | PASS: three continuations sent successfully; no duplicate submissions |
  | R5 / S2 (cycle limit) | PASS: stopped correctly at 3 |
  | R5 (no unexpected pause from the new notice rules) | PASS: no unexpected pauses |
- Activity log: not included in the report.

### M2 live check — reported 2026-11-06 — PASS

- Build: `main` after #21 (exact commit not stated).
- The pause guidance in the panel made sense (owner).
- **Copy diagnostic report**: the report was inspected and contained no
  conversation text (owner).

## Unrecognized notices (any language)

Autopilot recognizes usage-limit, login and error notices by their **English**
texts. No Spanish notice text could be verified from a reliable source
(2026-11-05), so none is matched by text. Instead:

| Situation | What Autopilot does |
|---|---|
| A visible alert (`role="alert"` or error styling) outside the conversation whose text it does not recognize | Paused: "ChatGPT shows a notice Autopilot does not recognize"; nothing sent |
| A continuation was sent but ChatGPT does not start answering within 60 s | Paused: "ChatGPT did not start answering the continuation"; nothing more sent |
| ChatGPT generated, but no new answer is visible afterwards | Paused: "ChatGPT finished without a new answer"; nothing sent |

**When such a pause shows a real notice on a non-English interface,** copy
the notice's exact text from the page and its interface language into an
issue. Only texts observed this way are added to the notice patterns (with a
test), so that notice can be shown with its proper reason.

## M3: Stop on status marker (setting on)

Turn on **Stop on status marker** in Settings and diagnostics in the tab
(`localStorage.setItem('chatgpt-autopilot:debug', '1')`, reload). In a throwaway
conversation, ask ChatGPT to end its answers as described in each row.

| # | Do | Expect |
|---|---|---|
| M3-L0 | Any finished answer; look at the `Page detection` console entry | `answerContentElements: 1` (count only, no text). If it is 0 or more, the answer content selector does not fit the live page: record the value; every answer then pauses as "unclear" |
| M3-L1 | Setting **off**; an answer ending in `AUTOPILOT STATUS: MILESTONE COMPLETE` | Continues as before (the answer is not read) |
| M3-L2 | Answer ending in `AUTOPILOT STATUS: CONTINUE` | Continues |
| M3-L3 | Answer ending in `AUTOPILOT STATUS: MILESTONE COMPLETE` | Stopped, *Finished*; nothing sent |
| M3-L4 | Answer ending in `AUTOPILOT STATUS: BLOCKED`; then press Resume | Paused, *Fix first*; nothing sent. Resume sends one continuation |
| M3-L5 | Answer that shows the marker only inside a code block | Continues (quoted text is ignored) |
| M3-L6 | After L3/L4, click **Copy diagnostic report** | It shows `statusMarker` and `stopOnMarker` only; no answer text |

#### How to run M3-L1 to M3-L6

Preparation, once:
- Use a throwaway conversation. In Settings: **Maximum cycles = 1** (so each
  row sends at most one continuation) and a short delay (e.g. 10 s).
- Keep diagnostics on (`chatgpt-autopilot:debug`) so each `Page detection`
  entry shows `statusMarker`.

For **every** row:
1. Make sure the settings match the row, and press **Start Autopilot**
   (Autopilot only acts on answers it sees ChatGPT generate after Start).
2. Send the row's prompt yourself, exactly as written.
3. Wait for the answer to finish, then for the delay.
4. Note what the panel shows (status, guidance line, *Continuations sent*), the
   `statusMarker` of the last `Page detection` entry, and whether a
   continuation appeared in the conversation.
5. Press **Stop** before the next row.

| Row | Setting | Prompt to send | Expected |
|---|---|---|---|
| M3-L1 | **off** | `Reply with one short sentence. Then, as the very last line of your reply, write exactly: AUTOPILOT STATUS: MILESTONE COMPLETE` | One continuation is sent; Autopilot then stops at the maximum (1). `statusMarker: 'none'` (the answer is not read) |
| M3-L2 | on | `Reply with one short sentence. Then, as the very last line of your reply, write exactly: AUTOPILOT STATUS: CONTINUE` | `statusMarker: 'continue'`; one continuation is sent; stops at the maximum |
| M3-L3 | on | `Reply with one short sentence. Then, as the very last line of your reply, write exactly: AUTOPILOT STATUS: MILESTONE COMPLETE` | `statusMarker: 'complete'`; **Stopped**, guidance *Finished*; nothing sent |
| M3-L4 | on | `Reply with one short sentence. Then, as the very last line of your reply, write exactly: AUTOPILOT STATUS: BLOCKED` | `statusMarker: 'blocked'`; **Paused**, guidance *Fix first*; nothing sent. Then press **Resume**: exactly one continuation is sent |
| M3-L5 | on | `Show the line AUTOPILOT STATUS: MILESTONE COMPLETE inside a code block, then end your reply with one normal sentence.` | `statusMarker: 'none'`; one continuation is sent (the code block is ignored) |
| M3-L6 | on | — (after M3-L3 or M3-L4) | **Copy diagnostic report**, paste it: `stopOnMarker: true` and `statusMarker` appear; no answer text, no prompt, no conversation id |

If ChatGPT does not follow the prompt exactly (for example it adds a period
after the status line), M3-L2 to L4 show `statusMarker: 'unclear'` and a
pause. That is the designed safe behaviour; send the prompt again in a new
answer. Record which row was affected.

### M3-L0 — reported 2026-11-09 — FAIL

- Owner, current ChatGPT page, setting on, diagnostics on: `status: 'complete'`,
  `answerContentElements: 0`, `assistantMessageCount: 7`, `userMessageCount: 7`.
- `document.querySelectorAll('.markdown').length` in the console: `0`.
- Meaning: the unverified answer-content selector `.markdown` does not exist on
  the live page. With the setting on, every finished answer therefore pauses as
  "unclear" (the intended safe failure); nothing is read and nothing is guessed.
- Next: capture the answer structure with `docs/answer-structure-probe.js` (below).

### Answer-structure probe v1 — reported 2026-11-09

- `selectorUsed: [data-conversation-role="assistant"]`, 5 assistant matches.
- The latest match is an **`h4` with class `sr-only`**, box 1×1, no
  `data-message-id`, text length 13, containing a visible 13-character `span`
  and a hidden 7-character `span`. It is a visually hidden heading labelling the
  turn for screen readers. The 13-character length matches a label such as
  "ChatGPT said:"; that wording is inferred, since no text was captured.
- Meaning:
  - The extension's assistant selector matches a **turn heading**, not the
    message. The M3 reader therefore looks for answer content inside that
    heading, where there is none (`answerContentElements: 0`).
  - The heading has no message id, so the extension's live response keys are
    almost certainly count-based (`n:<count>`), not id-based. This still meets
    M1's rules (the safe direction), but it is now evidence rather than an open
    question (D1).
- v1 did not show where the answer sits relative to the heading. v2 (below)
  walks up to the turn.

### Answer-structure probe v2 — reported 2026-11-09/10

Captured on a finished answer (es-ES). Structure, text-free:

```
div[data-turn-key]
 └ div[data-content-search-turn-key="fallback-turn-5"]
   └ … div.group[data-talvt-turn-state="complete"] … div.block-BQZwFn (display:contents)
     └ UNIT div[data-content-search-unit-key="fallback-turn-5:1:assistant"]
        ├ h4.sr-only[data-conversation-role="assistant"]   (1×1; the extension's old match)
        └ div > div[data-chatgpt-selection-message-id=<uuid>]
             ├ span[hidden]
             └ div[data-markdown-text-style="assistant-message"]      ← answer content
                 └ … div[data-dil-message-id=<uuid>] > p, h3, ol, ul, inline code,
                     div[data-client-defined-widget="code_block"]
                       └ div[data-code-block="true"]
                           ├ div[data-markdown-copy="exclude"] (icon, 4-char label, buttons)
                           └ div … (code text; no pre/code elements)
```

Counts on the page: `[data-conversation-role="assistant"]` 8 (4 visible),
`[data-conversation-role]` 16, `[data-message-id]` 0,
`[data-message-author-role]` 0.

Conclusions, now in the code:
- The latest assistant message is the **unit**
  (`[data-content-search-unit-key$=":assistant"]`).
- Its id is `data-chatgpt-selection-message-id`.
- Its answer content is `[data-markdown-text-style="assistant-message"]`.
- Code-block widgets and `data-markdown-copy="exclude"` chrome are not answer
  text.
- Before this, the live response keys were count-based and changed with the
  number of rendered turns.

Not yet captured: an answer with a tool, sources or thinking section. Unknown
shapes fail safe: zero or several answer-content elements give "unclear"
(pause). A capture of one such answer is still welcome.

### M3-L0 (repeat) — reported 2026-11-10 — PASS

- Build: `main` after #29. Setting **Stop on status marker** on, diagnostics on.
- `Page detection`: `status: 'complete'`, `answerContentElements: 1`,
  `composerFound: true`, `streamingMarkerFound: false`,
  `errorNoticeFound: false`, and a `responseKey` of the form
  `/c/<conversation uuid>|id:<message uuid>`. The actual ids are not recorded
  here, because they identify the owner's conversation.
- Meaning: on the live page, the latest assistant message is identified by its
  message id (not a count), and exactly one visible answer-content element is
  found. This confirms the selectors chosen from probe v2.

### M3-L1 to M3-L6 — reported 2026-11-10 — PASS

Build: `main` after #29 (exact commit not stated); interface language not
stated. Owner report, as given. **Behavioural** = what the owner observed
Autopilot do. **Diagnostic** = a value the owner read from `Page detection`
or the diagnostic report. Values the owner did not give are marked
*not supplied*; none is inferred.

| Row | Behavioural evidence | Diagnostic evidence | Result |
|---|---|---|---|
| M3-L1 | Setting **off**: the answer ended in `AUTOPILOT STATUS: MILESTONE COMPLETE` and Autopilot **continued**. Setting **on**: Autopilot **stopped** | *not supplied* (no `statusMarker` value) | PASS (behavioural) |
| M3-L2 | Exactly one continuation sent; stopped at the maximum | `statusMarker: continue` | PASS |
| M3-L3 | No continuation sent | Diagnostic report: `statusMarker: complete`, `reason: marker_complete`, `guidance: finished` | PASS |
| M3-L4 | Paused; *Fix first* guidance; zero continuations before Resume; after Resume exactly one continuation, without pausing again immediately | *not supplied* (no `statusMarker` or `reason` value) | PASS (behavioural) |
| M3-L5 | Exactly one continuation sent; stopped at the maximum | `statusMarker: none` | PASS |
| M3-L6 | The full diagnostic report was inspected | The report contained no answer text, no prompt text, no conversation id and no message id; only technical metadata and status enums | PASS |

Notes on what each row does and does not show:
- **L1:** shows that with the setting off a marker line does not stop
  Autopilot. That the answer is not read at all is established by tests (zero
  text reads), not by this row.
- **L4:** shows the full BLOCKED flow. Without the diagnostic value, the
  behaviour alone does not distinguish `blocked` from `unclear`: both pause
  with *Fix first*, and Resume overrides both once. L2, L3 and L5 show that
  the exact-line comparison yields the exact values on the live page.
- **L5:** the code block is a widget on the live page, not `pre`/`code` (probe
  v2), so this row confirms the widget exclusion from #29 live.

### Run 6 — reported 2026-11-10 — PASS (M1 regression after #29)

Purpose: #29 changed how responses are identified on the live page (the
message unit and uuid-based keys instead of count-based ones). Run 6 checks
that S1–S2 still behave.

- Build: `main` after #29 (exact commit not stated). Interface language not
  stated (earlier runs were es-ES).
- Settings: maximum cycles **3**, **Stop on status marker off**, continuation
  prompt `hey` (not the default prompt). Initial prompt: a plan for a to-do
  list application (sent by the owner).

| Row | Evidence | Result |
|---|---|---|
| S1 (one continuation per finished answer) | **Behavioural, user-reported:** "the test worked fine, no issues observed" | PASS |
| S2 (stops at the maximum, no duplicates) | **Behavioural, user-reported:** same report; maximum 3 | PASS |
| Response keys in `id:<uuid>` form, a different uuid per answer | **Diagnostic:** not reported for this run | NOT RECORDED |
| `answeredResponses: 3` in the diagnostic report | **Diagnostic:** not reported for this run | NOT RECORDED |

- Diagnostic evidence for the new identification comes from the M3-L0 repeat
  (same build line): exactly one answer-content element and a uuid-based key
  on the live page. Run 6 adds behavioural evidence that the full M1 loop
  still works with it. It does not show the per-answer keys.
- Activity log: not included in the report.

### Repeat M3-L0 after the live-structure fix

1. `git pull`, `npm run build`, reload the extension in `chrome://extensions`,
   then reload the ChatGPT tab.
2. Settings: turn on **Stop on status marker**; save.
3. In that tab's console: `localStorage.setItem('chatgpt-autopilot:debug', '1')`,
   then reload the tab.
4. Send any message and let ChatGPT finish its answer.
5. In the console, open the latest `[ChatGPT Autopilot] Page detection` entry.
   **PASS:** `status: 'complete'`, `answerContentElements: 1`, and
   `responseKey` ending in `id:` followed by a uuid (not `n:`).
   **FAIL:** anything else. Run `docs/answer-structure-probe.js` again and send
   both outputs.
6. Then M3-L1 to M3-L6.

### Capturing the answer structure (for M3-L0)

1. In the ChatGPT tab, wait until the latest answer is finished.
2. Open DevTools → Console, paste the whole of
   [`docs/answer-structure-probe.js`](answer-structure-probe.js) (version 2) and press Enter.
3. Copy the JSON it returns and send it. It contains tag names, class names,
   roles, `data-*` attribute names, visibility, box sizes and **text lengths**
   (numbers), never any text; values that do not look like identifiers are
   shown as `<omitted>`.
4. Optional but helpful: send it once for a short plain answer and once for an
   answer that used a tool or shows a "thinking"/sources section.

The answer-content selector is then chosen from that structure, with a
regression test built from it, and M3-L0 is repeated.

## Release candidate on the installed ZIP (M5, R-3)

Install the exact CI artifact as described in `docs/RELEASING.md` section 2
(not a development build). Diagnostics on; Stop on status marker off;
maximum cycles 2.

| # | Do | Expect |
|---|---|---|
| P-L1 | Delay **5 s**. Start, send a message, and time from the moment the answer finishes (the panel shows *Waiting before continuation*) to the continuation appearing | The continuation appears after about 5 s (5–8 s allowing for the confirmation delay), **not** after 30 s |
| P-L2 | Same with delay **20 s** | About 20 s, not 30 s or more |
| P-L3 | S1–S2 with the default settings | As S1–S2 |
| P-L4 | M3-L3 with the setting on | As M3-L3 |

Background: per Chrome's documentation, alarms in packed (store or CRX)
extensions have a 30 s minimum. A ZIP installed with *Load unpacked* is an
unpacked extension. Either way, the delay is driven by the worker timer and a
page ping, and the alarm is only a fallback (`test/controller.test.ts`: "with
the alarm never firing …"). These rows check the real install.

## Not covered here

Usage-limit and login notices cannot be produced on demand; record them when
they happen naturally, with the diagnostic log line.
