# AUTOPILOT.md — ChatGPT Autopilot Development State

> This file is the source of truth for the current development state of this repository.
> Read it at the start of every task. Update it after meaningful work, with evidence.

## 1. Project identity

- **Project:** ChatGPT Autopilot
- **Repository:** https://github.com/DarkonLikesCoffee/ai-autopilot
- **Default branch:** `main`
- **Purpose:** A lightweight Chrome Manifest V3 extension that detects when ChatGPT has finished a response and sends a configured continuation prompt, allowing a project workflow to continue without repeated manual prompting.
- **Primary user value:** Reliable, transparent continuation of long-running browser-based AI work without requiring the user's computer to host an agent or model.

## 2. Product architecture and boundaries

- [VERIFIED] ChatGPT provides the reasoning and decides what project work to perform; this extension is a continuation trigger, not an agent. Evidence: `README.md`.
- [VERIFIED] The extension observes ChatGPT page structure and composer state, not conversation text. **Exception (M3, opt-in, off by default):** with "Stop on status marker" on, it reads the visible text of the latest finished answer only temporarily, to compare its last line with three fixed lines; that text is never persisted, transmitted, logged or retained in application state. Evidence: `README.md`, `src/content/page.ts`, `src/content/statusMarker.ts`, `test/privacy.test.ts`.
- [VERIFIED] The extension uses the normal ChatGPT UI to type and send; it does not use undocumented APIs or session tokens. Evidence: `README.md`, `src/content/composer.ts`.
- [VERIFIED] The project uses TypeScript and Chrome Manifest V3. Evidence: `package.json`, extension source and build configuration.
- [VERIFIED] The continuation state machine is separated from Chrome API orchestration. Evidence: `src/shared/session.ts`, `src/background/controller.ts`.
- [VERIFIED] GitHub is not accessed directly by the extension. ChatGPT's connected GitHub integration or the developer's tooling manages repository changes.
- [UNRESOLVED] Compatibility with the current live ChatGPT website has not been established by the automated test suite. Existing E2E coverage uses a local fake page.
- [UNRESOLVED] Behavior in a genuinely hidden/background tab has not been fully validated.

## 3. Product principles

1. Reliability before autonomy; autonomy before feature count.
2. Keep the extension deterministic, not agentic.
3. Never guess whether a response is complete or a message was sent.
4. Prefer pausing/stopping over unsafe or ambiguous behavior.
5. Never send duplicate continuations for one response.
6. Never overwrite text the user has entered.
7. Never send to a conversation other than the one the user started.
8. Do not bypass usage limits, authentication, browser security or anti-abuse controls.
9. No undocumented APIs, cookie/session-token extraction, backend, paid service, API key or local model without owner approval.
10. Keep privacy minimal: do not read, store or transmit conversation contents. **Only exception (D10, owner decision 2026-11-05/06):** the opt-in status-marker check may read the visible text of the latest finished answer temporarily, for the exact comparison only; that text is never persisted, transmitted, logged or retained in application state. Any other reading of conversation text needs a new owner decision.

## 4. Current implementation snapshot

- [VERIFIED] The extension has a configurable continuation prompt, delay, completion-confirmation delay, cycle limit and notifications. Evidence: `README.md`, `src/shared/settings.ts`.
- [VERIFIED] The detector waits for a confirmed non-generating state after observing generation. Evidence: `src/content/detector.ts`.
- [VERIFIED] The composer types and verifies the prompt, attempts one send, and checks whether the message was sent. Evidence: `src/content/composer.ts`.
- [VERIFIED] The session logic tracks answered responses and avoids retrying an ambiguous submission. Evidence: `src/shared/session.ts`.
- [VERIFIED] Unit tests cover the state machine/controller workflow; browser E2E tests run against a fake ChatGPT page. Evidence: `test/`, `e2e/extension.e2e.mjs`, `README.md`.
- [VERIFIED] CI runs typecheck, unit tests and build. Evidence: `.github/workflows/ci.yml`.
- [UNRESOLVED] The latest main-branch CI result and live ChatGPT compatibility must be checked at the beginning of each session; do not assume prior results remain current.

## 5. Current milestone

**Milestone M1 — Establish real-world interaction reliability** — **COMPLETE (2026-11-05)**

Goal: prove that the extension can safely observe and continue a real ChatGPT conversation under realistic browser conditions, and fail safely when it cannot.

Status: [VERIFIED] **Complete.** Final reassessment 2026-11-05 after live Run 5 (`docs/LIVE_VALIDATION.md`). Every requirement is met by live evidence, or by a documented and owner-approved basis (marked *exception* or *indirect*).

### Definition of done

- [x] **Selectors and completion detection validated against the live site.** [VERIFIED] es-ES: D2, D5, L1 live (runs 2, 3, 5). D4 and D6 covered by S3/S4. *Indirect:* D1 and D3 covered for behaviour, with safe failure modes (see "Indirect coverage assessment"). *Exception:* English and other interface languages not live-verified (see "Interface languages").
- [x] **Sending validated, exactly once.** [VERIFIED] es-ES runs 2 and 5: three continuations each, one per finished response, no duplicates, stopped at the limit; no duplicate after regenerating (D5, run 3).
- [x] **Composer protection when the user has typed text.** [VERIFIED] S3, run 3.
- [x] **Conversation switching, usage-limit notices, login/error states and generation restarts fail safely.** [VERIFIED] switching (S4) and generation restarts (D5) live. Unrecognized notices in any language pause (#18; unit + E2E tested; Run 5 confirmed no false pauses on the live es-ES flow). *Exception (owner decision):* N1–N3 not triggered live because that isn't practical; their unit/E2E coverage and the reasons are documented.
- [x] **Background/hidden-tab behaviour understood and documented; unsupported conditions handled safely.** [VERIFIED] S5 and S6 (runs 3–4: sent normally in a background tab and with the browser minimised). Throttled or frozen tabs were not observed; the wall-clock bounds (T4) remain the safeguard.
- [x] **Unit tests, typecheck and build pass.** [VERIFIED] `npm run check` (140 tests); CI `check`.
- [x] **Browser E2E passes for all relevant deterministic scenarios.** [VERIFIED] CI `e2e` on every PR (owner is configuring it as a required check).
- [x] **No known high-severity regression.** [VERIFIED] Run 5 after the last behaviour change: no unexpected pause, no duplicate.

P1 (Pause/Resume/Stop): [VERIFIED] run 4. R5 (regression after #18): [VERIFIED] run 5.

**Known limitations carried forward (not M1 blockers):** English and other interface languages are not live-verified; notice texts are English-only (other languages pause as "unrecognized"; exact texts are added when observed, D9); real frozen or discarded tabs were not observed.

Do not claim the milestone complete based only on fake-page tests.

### Live test matrix (M1)

Authoritative status of every live test. Procedure and capture steps: `docs/LIVE_VALIDATION.md` (same IDs). Run in a throwaway conversation with **Maximum cycles = 2 or 3**. Record each run with date, interface language and build, and set the status here only from an observed result: **VERIFIED** (observed as expected), **FAILED** (with a link to the fix), **NOT RUN**.

| ID | Test (what you do) | Expected behaviour | DoD item | Status |
|---|---|---|---|---|
| D1 | Idle conversation with one finished answer; diagnostics on | `status: complete`; assistant messages counted once; response key ends in `id:…` | Detection | Indirectly covered (S1/S2, D5); see assessment |
| D2 | Send a question yourself and let it stream | Generating for the whole stream, then complete once it ends; log shows "ChatGPT is generating a response." then "Response complete…" | Detection | **VERIFIED** es-ES (Run 2: three responses detected) |
| D3 | Compare `userMessageCount` before/after D2 | Increases by exactly 1 | Detection | Indirectly covered (S1/S2); see assessment |
| D4 | Type a draft, do not send; diagnostics on | `composerHasText: true` | Composer protection | Covered by S3; see assessment |
| D5 | Regenerate the last answer while Autopilot runs | Generating, then complete; a regenerated answer with a new id gets **one** continuation; one that keeps the same key pauses ("finished without a new answer", since 2026-11-05; before: none); never two | Generation restarts | **VERIFIED** (Run 3) |
| D6 | Switch conversation in the sidebar; diagnostics on | Response key path changes to the new `/c/<id>` | Conversation switching | Covered by S4; see assessment |
| S1 | Start after an answer finished | After the delay exactly one continuation is sent and logged "Continuation N sent." | Sending exactly once | **VERIFIED** es-ES (Run 2) |
| S2 | Let it run to the limit | Stops at the maximum; never two messages for one answer | Sending exactly once | **VERIFIED** es-ES (Run 2: stopped at 3) |
| S3 | During the countdown, type into the message box | **At the end of the countdown** (not immediately): Paused, "The message box already contains text"; nothing sent; your text unchanged | Composer protection | **VERIFIED** (Run 3) |
| S4 | During the countdown, switch to another conversation | Paused at once, "The tab switched to a different conversation"; nothing sent in either conversation | Conversation switching | **VERIFIED** (Run 3) |
| S5 | During the countdown, open another tab in front (same window) | The continuation is still sent to the session's tab, once | Background tabs | **VERIFIED** (Run 3) |
| S6 | During the countdown, minimise the window or switch to another window, for longer than the delay | Either sent once, or stopped with an error ("…suspended or throttled…" / "the send button did not become available") and the prompt removed; never sent twice or late. Record which | Background tabs | **VERIFIED** (Runs 3–4: kept working, continuation sent once) |
| P1 | During the countdown, press Pause; later Resume. Separately, press Stop | Pause/Stop: nothing sent. Resume: one continuation after a fresh delay | User control | **VERIFIED** (Run 4) |
| N1 | Usage-limit notice appears (when it happens naturally) | Error, "ChatGPT shows a usage limit"; nothing sent; not retried | Error states | NOT RUN: owner decision; unit/E2E coverage documented; **English texts only** |
| N2 | Logged out / session expired notice (naturally, or log out in another tab) | Error, "ChatGPT asks you to log in"; nothing sent | Error states | NOT RUN: owner decision; unit/E2E coverage documented |
| N3 | ChatGPT error notice ("Something went wrong", network error) | Error, "ChatGPT shows an error"; nothing sent | Error states | NOT RUN: owner decision; unit/E2E coverage documented; **English texts only** |
| R1 | Close the ChatGPT tab during the countdown | Paused, "The ChatGPT tab was closed"; nothing sent | Recovery | NOT RUN |
| R2 | Quit and reopen the browser while running | Paused, "The browser or the extension restarted"; nothing sent until you resume | Recovery | NOT RUN |
| L1 | Spanish interface (es-ES) | Send (`Enviar`) and Stop (`Detener`) recognized | Detection / sending | **VERIFIED** (Run 2) |
| L2 | English interface | Same as S1/S2 | Detection / sending | NOT RUN: documented exception (not required by the DoD) |
| N4 | An unrecognized notice appears (e.g. a Spanish usage-limit or error notice), during a countdown or instead of an answer | Paused, "ChatGPT shows a notice Autopilot does not recognize" (or "did not start answering" / "finished without a new answer"); nothing sent | Error states | NOT RUN (cannot be triggered on demand; unit + E2E tested) |
| R5 | Run 5: after the notice fail-safe change, repeat S1–S2 on es-ES | Same as S1–S2: no unexpected pause | Regression | **VERIFIED** (Run 5) |
| R6 | Run 6: after #29 (live message identification, uuid keys), repeat S1–S2 | Same as S1–S2 | Regression | **VERIFIED** behaviourally (Run 6, user-reported: worked, no issues; max 3, marker setting off, continuation prompt `hey`). Per-answer key diagnostics not recorded |

M1's definition of done needs, at minimum: D1–D6, S1–S4 and P1 VERIFIED; S5/S6 observed and their behaviour documented; N1–N3 VERIFIED when they occur, or explicitly accepted as untestable on demand by the owner (they are covered by unit and E2E tests). *Updated 2026-11-05 by owner decision:* D1/D3/D4/D6 may be met by documented indirect coverage; N1–N3 stay unverified live with documented coverage; L2 is a documented exception.

### Indirect coverage assessment: D1, D3, D4, D6 (2026-11-05)

Each diagnostic row checked against what S1–S4 already demonstrated live and the code path those results depend on. Owner decision (2026-11-05): document indirect coverage where an existing live test covers the same behaviour; run a diagnostic only if it would verify something not yet demonstrated.

| ID | What the diagnostic checks | Live evidence and code path | Assessment |
|---|---|---|---|
| D1 | Assistant messages counted once; response key uses the message id | S1/S2 (run 2): one continuation per finished response for three cycles, stopped at 3; D5 (run 3): no duplicate after regenerating. A continuation is only sent for an unanswered key after an observed generation (`session.ts` `observe`), whichever key form is used; a doubled count changes neither that rule nor the stop at the limit. | **Indirectly covered** for the safety property D1 exists for (exactly one continuation per response). Not demonstrated: whether live keys are id-based or count-based. The only consequence is that, with count-based keys, a regenerated answer gets no continuation (safe direction). Run not needed. |
| D3 | User-message count rises by exactly 1 after a send | Used only in the send confirmation: the prompt has left the box **and** (user count rose **or** a generation started) (`composer.ts` `submissionEvidence`). S1/S2: every continuation was confirmed as sent. | **Indirectly covered** for the behaviour (sends are confirmed live). Not demonstrated: the user count signal itself, since confirmation may have come from the generation start. If live user counting were wrong, confirmation still works once ChatGPT starts generating within 10 s; otherwise the result is "uncertain" → paused, never a resend (safe direction). Run not needed. |
| D4 | `composerHasText` is true when the box has text | S3 (run 3): typing during the countdown paused Autopilot and nothing was sent. That pause is only produced by the precheck reading `composerHasText` (`controller.ts` `precheckObservation`, `composer.ts` `precheck`). | **Covered** (same signal, observed in its real use). |
| D6 | The response key's path follows a conversation switch | S4 (run 3): switching conversation paused Autopilot and nothing was sent. That pause is triggered by the observation URL's path differing from the session's (`session.ts` `observe`); the key's path comes from the same URL. | **Covered** (same source, observed in its real use). |

Basis: S3/S4 were reported as PASS against this matrix's expected behaviour, which names the pause reason. The exact log lines were not included in the report.

### Notices N1–N3: why they stay unverified live, and what covers them

Owner decision (2026-11-05): keep N1–N3 unverified live and document the coverage.

| ID | Why not practical to trigger live | Unit / E2E coverage |
|---|---|---|
| N1 usage limit | Requires exhausting the account's usage quota (and then being locked out for hours) | `test/page.test.ts` "usage-limit notices are detected", "classification order…"; `test/controller.test.ts` "12: a usage limit stops automatic continuation and is never retried automatically"; E2E "12: a usage limit stops Autopilot and nothing is sent", "the panel shows the error" |
| N2 login / session expired | Requires the session to expire, or logging out while a run is active (disruptive; behaviour then depends on when ChatGPT notices) | `test/page.test.ts` "a login screen or session-expired notice is an error, never a completion"; `test/controller.test.ts` "auth errors and page errors stop automatic continuation"; `test/session.test.ts` "start is refused on a page that cannot be continued" |
| N3 ChatGPT error notice | Server or network errors occur at random | `test/page.test.ts` "error notices are detected", "words inside conversation messages are not mistaken for notices", "long texts and hidden notices are not treated as notices"; `test/controller.test.ts` "auth errors and page errors stop automatic continuation" |

**[UNRESOLVED] Language gap found during this assessment.** The notice patterns (`USAGE_LIMIT_PATTERNS`, `AUTH_PATTERNS`, `ERROR_PATTERNS` in `selectors.ts`) are **English only**, and the tests above use English notice texts. On the es-ES interface (the one validated live), a Spanish usage-limit or error notice would **not** be recognized. Login detection is partly language-independent (login button or link when the message box is missing). Possible consequences on es-ES:
- If a notice appears instead of a response, what Autopilot reports depends on what the page shows. If the sent message appears in the thread, the continuation counts as sent and Autopilot keeps showing "Running" (waiting for a generation that never comes). If it does not appear, the outcome is "uncertain" or "not sent", and Autopilot pauses or stops with that generic reason. Either way nothing more is sent, but the usage-limit reason is not shown.
- If ChatGPT ends a response with an error and the page then looks finished with a new response key, Autopilot treats it as a finished response and sends the next continuation: at most one per such response, bounded by the cycle limit.

The second case does not meet "error states fail safely" for es-ES. Spanish notice texts must not be guessed (same rule as for button labels), so closing this needs either the exact Spanish texts when they appear, or an explicit owner decision to accept it as a documented M1 limitation.

### Notice research (2026-11-05)

Goal: verify exact Spanish usage-limit, login and error notice texts before adding them. Sources tried:
- chatgpt.com, its CDN (`cdn.oaistatic.com`, where its interface strings are served) and help.openai.com: blocked by this environment's network policy.
- Web search: the OpenAI help center articles found (login problems, active sessions) do not quote the notices. The rest is third-party sites (titikey, tenorshare), other products (Microsoft Q&A) or dictionary translations ("Algo salió mal", "Se produjo un error").

None of this is reliable evidence of ChatGPT's current wording, so **no Spanish notice pattern was added** (decision D9). The language-independent rules above make unknown notices fail safe; exact texts are added only when observed live on the page.

### Interface languages (L2)

The definition of done requires validation "against the live ChatGPT site"; it does not require each interface language. M1 was validated live on es-ES. **Documented exception:** English (L2) and all other languages are not live-verified. English uses the original selectors, starting with the language-independent `data-testid`/`id`, but that is unverified live. README says so.

## 5b. Milestone M2 — Recovery and observability — **COMPLETE (2026-11-06)**

Goal: when something goes wrong, the user (and a developer helping them) can see what happened, know whether to simply resume or fix something first, and hand over a complete technical report in one step, all without conversation text.

Why now (evidence from M1): every live investigation (runs 1–5) needed the owner to copy console objects from two places by hand; and the panel shows a reason for each pause or error but not whether Resume is safe or something must be fixed first.

### Definition of done (M2)

- [x] **Diagnostic report export:** [VERIFIED] T10. **Copy diagnostic report** in the panel's Activity section. It contains the extension version, browser, settings (prompt as length and is-default only), session state with times relative to the report, the activity log, a fresh observation of the page (status and signals), and the last send-step record. Conversation ids, response keys and tab titles appear only as kinds or counts. `test/report.test.ts` plants SECRET in every user-content field and proves none reaches the report; E2E checks the real panel button.
- [x] **Recoverable vs terminal:** [VERIFIED] T11. Every halt reason is classified as *Resume when ready* (`user`), *Fix first* (13 reasons, each with one concrete action) or *Finished* (`max_cycles`). The panel shows it after a halt, but not while running or after your own Stop. `test/guidance.test.ts` pins every reason's kind; E2E checks the panel after a usage limit. The report includes the kind.
- [x] **Stage history:** [VERIFIED] T5 (log of generation observed, completion, scheduling, attempt, confirmation, halts).
- [x] **Recovery after worker suspension, browser restart and stale storage:** [VERIFIED] T6 and tests. Extension update: covered by the schema-version test (state restored as stopped); a live update was not observed.
- [x] **Storage schema/version tests:** [VERIFIED] T6.
- [x] **Checks:** [VERIFIED] `npm run check` (149 tests) and `npm run e2e` pass, covering the export and the guidance.
- [x] **Live:** [VERIFIED] owner, 2026-11-06: the pause guidance made sense, and an exported diagnostic report contained no conversation text (`docs/LIVE_VALIDATION.md`, M2 live check).

## 5c. Milestone M3 — Stop on an explicit status marker — **COMPLETE (2026-11-10)**

Design: `docs/design/m3-stop-protocol.md`, **approved by the owner 2026-11-06** with decisions (a)–(d), plus R9 (visible answer content only; if it cannot be isolated, `unclear`) and R10 (answer text never persisted, transmitted, logged or retained in application state).

**Status:** [VERIFIED] **Complete.** Final reassessment 2026-11-10: every definition-of-done item below has evidence, and the live item has all seven rows passed.

**Accepted residual gaps** (not blockers; documented):
- **M3-L4** has behavioural evidence only. It does not show diagnostically that the live value was `blocked` rather than `unclear`. Both pause with *Fix first* and are overridden once by Resume, so the user-visible requirement (BLOCKED pauses, nothing sent, Resume sends exactly one) is met. The exact comparison yielding exact values live is shown by L2, L3 and L5.
- **M3-L1** has behavioural evidence only. "Not read when off" rests on tests (zero text reads), which is the right kind of evidence for something that has no visible effect.
- **Tool, sources and thinking sections** were never captured live. They fail safe (zero or several answer-content elements → `unclear`, pause), as tested on synthetic shapes.
- **The unit selector** depends on the observed `:assistant` suffix of `data-content-search-unit-key`. If ChatGPT changes it, the heading fallback applies: count keys, and M3 pauses as `unclear`.

### Definition of done (M3)

- [x] **Reader** (`src/content/statusMarker.ts`): [VERIFIED] T7 part 1. Exact grammar (a case-insensitive `AUTOPILOT STATUS:` prefix marks an attempt; only the three exact lines are valid), last non-empty line, exactly one attempt, isolation of the visible answer content (R9: exactly one visible `answerContent` element, else `unclear` with no text read; hidden, aria-hidden, 1px, closed details, controls and labels, status/alert, code, pre and blockquote subtrees skipped), any exception → `unclear`. Returns `{ marker, contentElements }` only. Not wired in yet. `test/statusMarker.test.ts` (10 tests).
- [x] **Privacy enforcement P1–P6**: [VERIFIED] T7 parts 1–2. P1: no text read with the setting off, while generating, or from older answers and user messages (read counters). P2: the observation carries only the enum and a count, and the validator rejects anything else. A SECRET answer reaches no observation, console diagnostic, report or stored state. P3: the report has only the enum and the setting. P4: source scan. P5: fixed halt texts. P6: no module state.
- [x] **Behaviour**: [VERIFIED] T7 part 2. The setting is off by default (older stored settings stay off). COMPLETE stops (*Finished*); BLOCKED and unclear pause (*Fix first*); missing or CONTINUE continue. The marker is checked again in the background precheck and in the page's own precheck. **Resume after a marker pause is your override for that one response** (it is continued once; later answers are checked again).
- [x] **Docs**: [VERIFIED] T7 part 3. README privacy wording (R10) and a "Stop on status marker" section; the exception added to principle 10 (section 3), section 2 and `CLAUDE.md`; the template now states the exact last-line rule; live rows M3-L0 to M3-L6 in `docs/LIVE_VALIDATION.md`.
- [x] **Checks**: [VERIFIED] `npm run check` (176 tests); `npm run e2e` incl. three M3 scenarios (code-block marker ignored, then COMPLETE stops with *Finished*; BLOCKED pauses and Resume overrides once; setting off ignores the line).
- [x] **Live** (owner): rows M3-L0 to M3-L6, all **PASS**, reported 2026-11-10 (`docs/LIVE_VALIDATION.md`). B = behavioural (observed), D = diagnostic (a value read from `Page detection` or the report).

  | Row | What it proves | Evidence | Status |
  |---|---|---|---|
  | M3-L0 | Live answer content and message id are isolated | D: `answerContentElements: 1`, `id:<uuid>` key | **PASS** |
  | M3-L1 | Setting off: a marker line does not stop Autopilot | B: off → continued; on → stopped. D: not supplied | **PASS** (B) |
  | M3-L2 | CONTINUE continues | D: `statusMarker: continue`. B: one continuation, stopped at the maximum | **PASS** |
  | M3-L3 | MILESTONE COMPLETE stops, nothing sent | D: `statusMarker: complete`, `reason: marker_complete`, `guidance: finished`. B: nothing sent | **PASS** |
  | M3-L4 | BLOCKED pauses; Resume sends exactly one | B: paused, *Fix first*, zero before Resume, exactly one after, no immediate re-pause. D: not supplied | **PASS** (B) |
  | M3-L5 | A marker in a code block (a widget on the live page) is ignored | D: `statusMarker: none`. B: one continuation, stopped at the maximum | **PASS** |
  | M3-L6 | The report holds no answer text after a marker run | D: report inspected; no answer text, prompt, conversation id or message id | **PASS** |

  M1 regression after #29 (R6): **PASS**, behavioural and user-reported (see the matrix).

## 6. Prioritized roadmap

See `docs/ROADMAP.md` for milestone details. Current order:

1. ~~**P0 — M1 reliability**~~ — **complete 2026-11-05.**
2. ~~**P1 — M2 recovery and observability**~~: **complete 2026-11-06** (T10, T11, live check).
3. ~~**P1 — M3 stopping and control**~~: **complete 2026-11-10** (section 5c).
4. **P2 — M4 multi-project sessions:** independent sessions and clear session identity, only after single-session reliability.
5. **M5 product polish (current).** Approved 2026-11-10: `docs/design/m5-release-quality.md` (decisions D-1 to D-7, requirements R-1 to R-5).
6. **Later exploration:** advanced automation only where it preserves the deterministic boundary and user control.

## 7. Actionable task queue

Choose the highest-priority task that remains valid after inspecting the current code, open PRs and CI. Update this list as tasks are completed or priorities change.

- [x] **T1 (P0): Live-site compatibility investigation.** Done 2026-11-05: runs 1–5 on es-ES (see the live test matrix). Other interface languages remain a documented limitation.
- [x] **T2 (P0): Completion-detection test coverage.** Done 2026-11-04. Added deterministic tests for streaming that pauses and resumes, DOM replacement inside the confirmation window, response ids that change after completion, navigation away and back, and regenerated responses (new id vs same key). Found and fixed a silent stall: a finished response whose key changed without a new generation (a late message id, a re-render) left Autopilot "Running" but never continuing. The pending continuation now moves to the updated response with a fresh delay (at least the confirmation delay when the read was not confirmed); answered keys are never targeted. [ASSUMED] that ChatGPT really assigns ids late — not observed; the fix is safe either way.
- [x] **T3 (P0): Submission safety audit.** Done 2026-11-04 (#6 and follow-up). Done: the window between typing the prompt and clicking send (up to 3 s while the send button becomes available). Fixed: (1) text you typed during that wait was sent together with the prompt; (2) if the send button never became available, everything in the box was deleted, including your text; (3) no re-check of conversation, generation or usage limit before the click. Now every poll and the moment before the click re-check the page; the prompt is removed only while the box holds exactly the prompt; a prompt that vanished before the click is reported as uncertain (pause, never retried). New `test/composer.test.ts` (10 tests, fake DOM). Part 2 (after the click): more user messages appearing (older ones loading in, a re-render) while the prompt is still in the box was taken as "sent", leaving the prompt unsent and the session waiting forever; confirmation now also requires the prompt to have left the box. A send that happens after `confirmMs` empties the box, so it is reported as uncertain (never retried). The contenteditable (ProseMirror) path is covered by the Chromium E2E only, not by unit tests.
- [x] **T4 (P0): Hidden/background tab behavior.** Done 2026-11-05: wall-clock bounds on the send step (#8); live S5/S6 passed (runs 3–4). Real frozen or discarded tabs were not observed; the bounds remain the safeguard.
- [x] **T5 (P1): Diagnostics.** Done 2026-11-04. Audit of the activity log against the five stages: confirmed completion + scheduled continuation ("Response complete. Continuation N in Xs."), submission attempt ("Sending continuation N."), confirmed submission ("Continuation N sent.") were logged; **generation observed was never logged**, so a stalled run could not show whether ChatGPT was ever seen working. Added "ChatGPT is generating a response." once per response. A completion detected but not yet confirmed exists only in the content script (the panel shows the live ChatGPT state; the opt-in console diagnostics show it in detail); not added to the log, to avoid a new message type for a transient state. Test: a full cycle logs each stage once, in order. No conversation text in any message.
- [x] **T6 (P1): Session recovery.** Done 2026-11-04. Audited restart × phase: browser restart (all phases) and a worker restart during the delay were already handled and tested. **Fixed:** a worker restart *during an attempt* that woke within 60 s scheduled nothing; if the tab's result report never arrived (tab crashed or discarded), the session stayed "Running" in `submitting` forever. WAKE now schedules a check for when the result is overdue; DUE then pauses as uncertain (the response stays answered; a late result is still applied). Schema-version changes (extension update) were already safe (restored as stopped, answered keys kept); now pinned by a test.
- [x] **T7 (P1, M3): Structured stop protocol.** Implemented 2026-11-06 in #24 (reader), #25 (wiring) and #26 (E2E, docs); live fixes #27–#29; live validation M3-L0 to L6 passed 2026-11-10. Status text is not proof that the work itself is correct.
- [x] **T10 (P1, M2): Diagnostic report export.** Done 2026-11-05. Panel button; read-only `GET_REPORT` (never queued behind a send, never changes state); the content script now always keeps its last send-step record (text-free) for the report and logs it only with diagnostics on. If the clipboard is unavailable, the report is shown in a read-only box for manual copying.
- [x] **T11 (P1, M2): Recoverable vs terminal.** Done 2026-11-05 (`src/shared/guidance.ts`; a `Record<HaltReason, …>`, so a new reason without guidance does not compile).
- [ ] **T8 (P2): Multi-session design.** Write a design proposal and threat/race-condition analysis before implementation.
- [ ] **T9 (P3): UX and release polish.** Improve onboarding, accessibility, settings clarity and packaging after core reliability.

A task may be reordered only with repository evidence and a note in the decisions/history sections.

## 8. Build and verification commands

| Purpose | Command | Expected meaning |
|---|---|---|
| Install | `npm ci` | Install locked dependencies |
| Type check | `npm run typecheck` | Strict TypeScript check |
| Unit tests | `npm test` | Run Node test suite |
| Build | `npm run build` | Produce extension bundle |
| Full check | `npm run check` | Typecheck + unit tests + build |
| Browser E2E | `npm run e2e` | Build and run Playwright browser test; requires supported Chromium/Playwright environment |

Record actual results for every task. Use `NOT RUN — reason` when unavailable.

## 9. Known limitations and risks

- [RESOLVED 2026-11-10] **M3 answer-content selector (live M3-L0 FAIL, 2026-11-09):** `.markdown` did not exist on the live page. Replaced from the captured structure (probe v2, fix below); M3-L0 passed live afterwards and M3 is complete. The README's "keep it off for now" note was removed in M5 C-9.
- [VERIFIED] **Live structure, probe v1 (owner, 2026-11-09):** `[data-conversation-role="assistant"]`, the first assistant selector, matches a visually hidden turn heading (`h4.sr-only`, 1×1, no `data-message-id`), not the message. Consequences: (1) the M3 reader looks inside that heading, so `answerContentElements` is 0; (2) the live response keys are almost certainly count-based (`n:<count>`), since the heading has no id. That still meets M1 (safe direction; see the D1 assessment). No selector is changed until probe v2 shows where the message and its answer content sit in the turn.
- [VERIFIED] **Live structure, probe v2 (owner, 2026-11-09/10)** (recorded in `docs/LIVE_VALIDATION.md`): an assistant turn is a unit `div[data-content-search-unit-key="<turn>:<n>:assistant"]` holding the hidden heading and the message `div[data-chatgpt-selection-message-id=<uuid>]`. The answer content is `div[data-markdown-text-style="assistant-message"]`. Code blocks are widgets (`data-client-defined-widget`, `data-code-block`), not `pre`/`code`, with interface chrome marked `data-markdown-copy="exclude"`. `[data-message-id]` and `[data-message-author-role]` do not occur.
- [VERIFIED] **Fix (2026-11-10) from that evidence:** the assistant selector puts the unit first; response keys use `data-chatgpt-selection-message-id` (then `data-dil-message-id`); the answer-content selector is `[data-markdown-text-style="assistant-message"]` (`.markdown` removed); the reader skips widgets, code blocks and `data-markdown-copy="exclude"`; only the answer content (not the whole unit) is excluded from notice detection, so errors shown inside the turn are still detected. Tested against fixtures replaying the captured structure (`test/fixtures/liveStructure.ts`, `test/liveStructure.test.ts`) and in Chromium on a page built from it. Confirmed live by the M3-L0 repeat (2026-11-10).
- [VERIFIED] **M1 impact.** Before the fix, live response keys were count-based (`n:<visible assistant headings>`), and the count changes as ChatGPT renders or hides older turns. That could not cause a duplicate: a continuation needs an observed generation, and drift without one is ignored or only retargets the single pending continuation (T2). But a new answer could reuse an answered count key in a long conversation, giving a false pause ("finished without a new answer"). Keys are now the message's uuid, independent of what is rendered. **Migration:** answered keys stored before the update are count-based, so Resume after the update waits for ChatGPT's next answer whenever the key form changed; it never continues the response on the page (tested).
- [UNRESOLVED] **New regression risks:** (1) the unit selector relies on the `:assistant` suffix of `data-content-search-unit-key`, observed as `fallback-turn-N:1:assistant`; if ChatGPT renames it, the old heading selector is the fallback (count keys, and M3 pauses as unclear). (2) Tool, sources and thinking sections were not captured; they fail safe (zero or several answer-content elements → unclear). (3) User-message counting still uses the user headings; send confirmation also accepts "ChatGPT started generating", so a stale count only matters if both fail (then "uncertain" → pause).

- [VERIFIED] **Live-site bug (owner report, 2026-11-04) — root cause found and fixed.** On the es-ES ChatGPT UI the only send control is `<button aria-label="Enviar" type="submit">`; all four send selectors matched nothing, so every continuation stopped with "the send button did not become available". The owner's live diagnostics showed insertion working (`holdsPrompt: true`, `proseMirror: true`, `execCommandReturned: true`): a selector issue, not an insertion or timing issue. Fix: localized labels live in one table (`LOCALIZED_LABELS` in `selectors.ts`, each with its observation source; `Enviar`/`Detener` for es), and a send-button match inside the message box's own form is preferred over one elsewhere (`sendButton.ts`). Insertion mechanism and timeouts unchanged. [UNRESOLVED] other UI languages: work only where ChatGPT exposes `data-testid`/`id`; labels are added only from live observations.

- [UNRESOLVED] `[data-talvt-turn-state="in_progress"]` counts as generating. If ChatGPT ever leaves a stale in-progress marker after an error, Autopilot waits forever (safe direction: no send). Check during live validation.
- [UNRESOLVED] Localized stop-button labels are matched one by one (only English variants and Spanish "Detener"); `data-testid="stop-button"` is the language-independent signal. Other UI languages are unverified.

- [UNRESOLVED] Automated E2E tests use a fake ChatGPT page; they do not prove live-site compatibility.
- [UNRESOLVED] ChatGPT can change DOM structure and selectors without notice.
- [UNRESOLVED] Hidden/background tab throttling may affect typing, timers or sending.
- [VERIFIED] ChatGPT usage limits are external constraints; the extension stops when it detects a usage-limit notice. Evidence: `README.md`.
- [VERIFIED] The extension cannot decide whether the AI's project work is correct or whether a project milestone is genuinely complete. Evidence: product architecture and `README.md`.
- [UNRESOLVED] A model can misunderstand instructions, repeat work, or report completion inaccurately. Evidence-based project state and CI reduce but do not eliminate this risk.

- [VERIFIED] A response whose key does not change when it is regenerated (no message ids, count-based keys) is never continued again. Since 2026-11-05 Autopilot pauses in that case ("ChatGPT finished without a new answer") instead of waiting silently. Evidence: `test/controller.test.ts` ("a regenerated response with a new id…").

## 10. Decisions

| ID | Decision | Rationale | Status |
|---|---|---|---|
| D1 | Keep the extension a deterministic continuation trigger, not an AI agent. | Keeps scope, permissions and failure modes understandable. | Active |
| D2 | Use the normal ChatGPT UI rather than undocumented APIs. | Avoids fragile/private interfaces and credential handling. | Active |
| D3 | Keep GitHub/repository operations outside the extension. | The AI's connected GitHub workflow handles project files; extension only handles browser continuation. | Active |
| D4 | Prefer stopping over retrying an ambiguous send. | Avoids duplicate prompts and unintended actions. | Active |
| D5 | Validate single-session reliability before multi-session support. | Prevents multiplying unresolved state and race conditions. | Active |
| D6 | Development PRs should target `main`; automatic merging is allowed only after required CI checks pass. | Enables unattended contributions without bypassing verification. | Superseded by D7 |
| D7 | Owner authorizes Claude to merge its own PRs. Auto-merge (squash) may be enabled while required checks are pending; GitHub merges only after they pass. Merge state is verified afterwards. | Owner instruction, 2026-11-04. GitHub enforces the required checks, so waiting adds nothing. | Active |
| D8 | When the latest finished response changes key during the delay without a new generation, retarget the single pending continuation instead of dropping it. | Dropping it caused a silent stall; retargeting still sends at most one continuation per observed generation, never for an answered key, and re-checks the page before sending. | Active |
| D9 | Do not add notice texts in other languages unless observed on the live page; make unrecognized notices, missing answers and answer-less generations pause, language-independently. | No reliable source for ChatGPT's Spanish notice texts (2026-11-05); guessed texts would either miss or misfire. The owner chose to fix the gap rather than accept it. | Active |
| D10 | M3 is next. The extension may read the latest finished answer only when the owner-facing setting is on, only to match three exact marker lines, and never store, send or log the text. | Owner decision 2026-11-05 with requirements R1–R8; the privacy promise changes only for the opt-in setting. | Active (design approved 2026-11-06, R9–R10 added) |

## 11. Session history

| Date | Work | Outcome | Checks |
|---|---|---|---|
| 2026-11-03 | Established persistent Claude Code development context and roadmap. | [VERIFIED] Added `CLAUDE.md`, `AUTOPILOT.md` and `docs/ROADMAP.md` on a dedicated branch. | Documentation-only change; code checks not run. |
| 2026-11-03 | T1 (partial): landed the owner's live-detection selectors (`fix/live-chatgpt-detection`, previously without a PR) with fixes. Message lists now use the first matching selector, so nested current + older markup is not double-counted and the latest message is taken in document order; the message id is also found on a nested/enclosing element. Diagnostics made opt-in (`localStorage` key `chatgpt-autopilot:debug`), text-free (button `title` dropped, values capped at 60 chars) and unit-tested. E2E fake page now renders nested current + older markup. Added `docs/LIVE_VALIDATION.md`. | [VERIFIED] in tests below. Live site: NOT RUN (no ChatGPT account in the cloud session). | `npm run check` PASS (typecheck, 74 unit tests, build); `npm run e2e` PASS (all 17 checks, Chromium, fake page). |
| 2026-11-04 | T2: detector and state-machine edge cases. Fixed the stall after a late response-key change (session retargets the pending continuation; controller re-feeds a fresh read after a "response changed" refusal, with a delay of at least the confirmation delay). 11 new tests. Also: `CLAUDE.md` auto-merge policy (#4), closed redundant #2. `fix/live-chatgpt-detection` could not be deleted from the cloud session (git proxy rejected the delete push; owner can delete it — its content is in `main`). | [VERIFIED] in tests below. | `npm run check` PASS (85 unit tests); `npm run e2e` PASS (all checks, fake page). |
| 2026-11-04 | T3 (part 1): submission safety while the prompt waits for the send button — three bugs fixed (user text sent with the prompt; user text deleted on send_unavailable; no page re-check before the click). 10 new composer tests; 7 of them fail on the old code. | [VERIFIED] in tests below. | `npm run check` PASS (95 unit tests); `npm run e2e` PASS. |
| 2026-11-04 | T3 (part 2): send confirmation requires the prompt to have left the box as well as a new user message or a generation (was: either signal alone). 3 new tests; 2 fail on the old code. T3 complete. | [VERIFIED] in tests below. | `npm run check` PASS (98 unit tests); `npm run e2e` PASS. |
| 2026-11-04 | T4 (part 1): send-step waits bounded by wall-clock time; no click after a suspended/throttled wait (`tab_suspended`). 4 new tests (3 fail on the old code). A first frozen-tab experiment seemed to show the reply channel closing on freeze; re-running without freezing showed that was an artifact of the test page (a form submit navigated away). Recorded so it is not repeated. | [VERIFIED] in unit tests; browser freezing NOT reproducible headless. | `npm run check` PASS (102 unit tests); `npm run e2e` PASS. |
| 2026-11-04 | T5: activity log now records when a generation is first observed; test pins the order of all stages in a full cycle. | [VERIFIED] in tests below. | `npm run check` PASS (104 unit tests); `npm run e2e` PASS. |
| 2026-11-04 | T6: overdue-result check after a worker restart during an attempt; schema-version test. 3 new tests (1 fails on the old code). | [VERIFIED] in tests below. | `npm run check` PASS (107 unit tests); `npm run e2e` PASS. |
| 2026-11-04 | Live-site send failure investigation: opt-in, text-free send-step diagnostics (`src/content/sendDiagnostics.ts`: send-selector matches with visibility/disabled/attributes, the button that would be chosen, buttons next to the message box, message-box state incl. ProseMirror placeholder and ChatGPT's hidden textarea, insertion method); console probe `docs/send-probe.js` for a hand-typed baseline; capture procedure in `docs/LIVE_VALIDATION.md`. Real-ProseMirror experiment rules out the generic editor-state hypothesis. No behavior change. | Root cause [UNRESOLVED] pending owner's capture. | `npm run check` PASS (113 unit tests); `npm run e2e` PASS incl. a new check that the diagnostics describe a failed send without the prompt. |
| 2026-11-04 | Fixed the live es-ES send failure (root cause from the owner's diagnostics: no selector matched `button[aria-label="Enviar"]`). Localized label table; composer-form preference for the send button. Regression tests reproduce the live structure (and the old selector list reproduces the failure); E2E has an es-ES page variant, which fails on the previous build and passes now. | [VERIFIED] in tests below; owner to confirm on the live site. | `npm run check` PASS (125 unit tests); `npm run e2e` PASS. |
| 2026-11-05 | **First successful live validation** (owner, ChatGPT web, es-ES, max cycles 3): completion detected, three continuations submitted and confirmed, ChatGPT answered each, stopped exactly at 3. Recorded as Run 2 in `docs/LIVE_VALIDATION.md` (activity log not included in the report). M1 reassessed: sending exactly once now verified live; composer protection, conversation switching, error notices and hidden tabs still lack live evidence. | [VERIFIED] owner report. | Documentation only; `npm run check` PASS. |
| 2026-11-05 | Browser E2E runs in CI: separate `e2e` job (`npx playwright install --with-deps chromium`, `npm run e2e`); Playwright pinned as a dev dependency at 1.63.0, the version the tests were verified with. Existing `check` job unchanged. | [VERIFIED] locally; CI result recorded in the PR. | `npm run check` PASS (125); `npm run e2e` PASS with the project-local Playwright. |
| 2026-11-05 | Live test matrix added to section 5: every live test with its expected behaviour (checked against the code; e.g. S3 pauses at the end of the countdown, not when you start typing), the DoD item it proves and its status. Owner is configuring `e2e` as a required check. Owner decision: no T7, no new features; priority is the remaining live M1 tests. | Documentation only. | `npm run check` PASS. |
| 2026-11-05 | Live run 3 (owner report): S3, S4, D5, S5, S6 PASS. M1 reassessed item by item: 5 of 8 requirements met; open: D1/D3/D4/D6 (diagnostic-level, owner may accept as covered), N1–N3 (not observed live), S6 outcome detail, and P1. M1 **not** marked complete. | [VERIFIED] owner report. | Documentation only; `npm run check` PASS. |
| 2026-11-05 | M1 coverage assessment. D4 and D6 are covered by S3/S4 (same signals in real use). D1 and D3 are indirectly covered for behaviour, with safe failure modes. N1–N3 coverage and reasons documented. L2 is a documented exception. **Found:** notice patterns are English-only, so on es-ES usage-limit and error notices are not recognized; requirement 4 stays open pending owner decision. README language note corrected. M1 still not complete (open: requirement 4 language gap, S6 outcome, P1). | Documentation only. | `npm run check` PASS. |
| 2026-11-05 | Run 4 (owner): P1 PASS; S6 clarified (kept working, sent). Fixed the es-ES notice gap language-independently: unrecognized alert → pause (signal `unrecognizedNoticeFound`, all prechecks, the wait before clicking, detector reports); no generation within 60 s after a sent continuation → pause (`no_response`); a generation ending without a new answer → pause (`no_new_answer`). English detection unchanged. Research found no reliable Spanish notice texts, so none was added (D9). One T2 test now expects a pause instead of a silent continuation (ambiguous page). | [VERIFIED] in tests below; live Run 5 pending. | `npm run check` PASS (140 tests); `npm run e2e` PASS incl. a new es-ES unrecognized-notice scenario; the 7 new controller tests fail on the old state machine. |
| 2026-11-05 | Run 5 (owner, es-ES): three continuations, no unexpected pauses, no duplicates, stopped at 3: R5 PASS. **M1 marked complete** after a final item-by-item reassessment (documented exceptions: English and other languages not live-verified; N1–N3 not triggered live). Roadmap reassessed: M2 is current (two items left: T10 report export, T11 recoverable vs terminal); M3 blocked on an owner decision about reading the latest answer's text. | [VERIFIED] owner report. | Documentation only; `npm run check` PASS. |
| 2026-11-05 | T10 (M2): text-free diagnostic report export from the panel. | [VERIFIED] in tests below; live export by the owner pending (M2 DoD). | `npm run check` PASS (145 tests); `npm run e2e` PASS incl. the report button check. |
| 2026-11-05 | T11 (M2): halt guidance (Resume when ready / Fix first / Finished, with one action each) in the panel and the report. All M2 code items done; M2 waits only for the owner's live report export. | [VERIFIED] in tests below. | `npm run check` PASS (149 tests); `npm run e2e` PASS incl. the guidance check. |
| 2026-11-05 | Owner chose M3 (stop protocol) with strict privacy requirements. Technical design written and checked against the architecture and principles: `docs/design/m3-stop-protocol.md` (exact three-line grammar reused from the template, reading rules, outcomes, opt-in setting, privacy enforcement P1–P5 incl. a source-scan test, tests, risks). No implementation. | Design only. | `npm run check` PASS. |
| 2026-11-06 | Owner: M2 live check done (guidance made sense; diagnostic report had no conversation text), so **M2 complete**. Owner approved the M3 design with R9 (visible answer content only, else `unclear`) and R10 (precise privacy guarantee); both added to the design (isolation rules, `.markdown` marked unverified with live row M3-L0, P6 no retained state). M3 is current. | [VERIFIED] owner report. | Documentation only; `npm run check` PASS. |
| 2026-11-06 | T7 part 1 (M3): status-marker reader with R9 isolation and R10 privacy; `answerContent: ['.markdown']` added to `selectors.ts`, marked unverified (live row M3-L0); source-scan privacy test for all page-text reads. Not wired in: no behaviour change. | [VERIFIED] in tests below. | `npm run check` PASS (161 tests); `npm run e2e` PASS. |
| 2026-11-06 | T7 part 2 (M3): reader wired in. `stopOnMarker` setting and panel checkbox (off by default, with the privacy note); `signals.statusMarker` and `answerContentElements` (enum and count, validated); read only with the setting on and a finished answer; detector reports changes; state machine and both prechecks act on it; three halt reasons with guidance; report shows the setting and the enum. Resume after BLOCKED or unclear overrides that one response (an addition to the design, for user control; recorded here). | [VERIFIED] in tests below. | `npm run check` PASS (176 tests); `npm run e2e` PASS. |
| 2026-11-06 | T7 part 3 (M3): E2E scenarios (fake page with real `.markdown` answer content) and docs: R10 privacy wording in README, `CLAUDE.md`, sections 2–3; README section on the feature; template states the exact last-line rule; live rows M3-L0 to M3-L6. All M3 code and doc items done; M3 waits for live validation. | [VERIFIED] in tests below. | `npm run check` PASS (176 tests); `npm run e2e` PASS incl. 3 M3 scenarios. |
| 2026-11-09 | Live M3-L0 FAIL (owner): no `.markdown` on the live page. Not guessed. Added `docs/answer-structure-probe.js` (text-free structure of the latest answer: tags, classes, roles, data-* names, visibility, boxes, text lengths), with a sync unit test and an E2E check that it shows the structure but no text. README and live docs updated: keep the setting off until fixed. | [VERIFIED] probe in tests; live structure pending. | `npm run check` PASS (177 tests); `npm run e2e` PASS. |
| 2026-11-09 | Probe v1 result (owner): the assistant selector matches an `sr-only` `h4` turn heading, not the message; explains M3-L0 and indicates count-based live keys. Probe v2: walks up from the match to its turn (stopping before an ancestor with a second assistant match), reports every candidate selector's count and latest element, and dumps the turn's structure with which candidates match each node; still text-free. E2E: v2 on the fake page and on a hidden-heading test layout (a fixture, not a claim about ChatGPT). | [VERIFIED] probe in tests; live v2 output pending. | `npm run check` PASS (177 tests); `npm run e2e` PASS. |
| 2026-11-10 | Live message identification and answer isolation fixed from probe v2 evidence (see section 9): unit first, id-based keys, `[data-markdown-text-style="assistant-message"]`, widget, code-block and copy-exclude chrome skipped, notice exclusion narrowed to answer content, key-form migration guard on Resume. 15 new tests incl. a captured-structure fixture with a fake DOM, and an E2E run on that structure in Chromium. | [VERIFIED] in tests below; live M3-L0 repeat pending. | `npm run check` PASS (192 tests); `npm run e2e` PASS. |
| 2026-11-10 | Live M3-L0 PASS (owner, after #29): exactly one answer-content element and a uuid-based response key on the live page. Recorded without the owner's conversation and message ids. M3-L1 to L6 written up as exact steps with copy-paste prompts. | [VERIFIED] owner report. | Documentation only; `npm run check` PASS. |
| 2026-11-10 | Run 6 (owner): M1 S1–S2 after #29 PASS. Behavioural evidence (user-reported): worked, no issues; max 3, marker off, continuation prompt `hey`. No per-answer diagnostics recorded. M3 reassessed: code, tests, docs and M3-L0 are done; **M3-L1 to L6 have not been run**, so M3 is **not complete**. | [VERIFIED] owner report (behavioural). | Documentation only; `npm run check` PASS. |
| 2026-11-10 | Owner reported M3-L1 to L6, all PASS (recorded with behavioural and diagnostic evidence separated; no diagnostic value inferred; L1 and L4 behavioural only). Until this report the record had only M3-L0 and Run 6, so #31 marked L1–L6 NOT RUN. **M3 marked complete** after a final reassessment, with the residual gaps listed in section 5c. | [VERIFIED] owner report. | Documentation only; `npm run check` PASS. |
| 2026-11-10 | Owner chose M5 before M4. M5 audit and proposal written: `docs/design/m5-release-quality.md` (current state, 10 problems with priorities, changes C-1 to C-10, acceptance criteria, order, decisions D-1 to D-7). Notable findings: the README calls the required `notifications` permission optional; stored answered keys contain conversation and message ids but are not disclosed; a packed build was never tested (alarm minimum may differ). No implementation. | Proposal only. | `npm run check` PASS. |
| 2026-11-10 | Owner approved M5 with D-1 MIT (repository public: checked), D-2 0.3.0, D-3 1 s minimum delay, D-4 GitHub Releases only, D-5 axe-core, D-6 English, D-7 audit `chat.openai.com` first; and R-1 to R-5 (precise privacy table, CI ZIP but no automatic release, a live sub-30 s delay check on the installed ZIP, manual accessibility checks alongside axe, M1–M3 preserved). **No tag or public release until the owner approves the release candidate.** Design doc updated. | Decision record. | `npm run check` PASS. |
| 2026-11-10 | M5 C-2/C-3 (code part): `npm run package` (version check across package.json, lockfile and manifest; release build without source maps; `release/chatgpt-autopilot-<v>.zip`); version 0.3.0 (not tagged); CI packages, runs the E2E **on the unzipped ZIP** and uploads that ZIP as an artifact. CI has read-only permissions and no release step (tested). A test shows the delay never depends on the alarm. `docs/RELEASING.md`; live rows P-L1 to P-L4 for the installed ZIP. | [VERIFIED] in tests below; installed-ZIP rows pending (owner, at RC). | `npm run check` PASS (196 tests); E2E PASS against the unzipped release ZIP (locally). |
| 2026-11-10 | M5 C-1: `PRIVACY.md` (R-1): what is read; what is kept, where, retention and deletion, per item (prompt; conversation and message ids in `answeredKeys`, the last 200, kept across sessions; activity log, the last 40, extension-written; session; diagnostics switch in ChatGPT's `localStorage`; answer, message-box and notice text **not stored**); what leaves the extension; permissions; a code reference per claim. Also discloses that the panel shows the tab title (the conversation title, not stored). `test/privacyDoc.test.ts` fails on any undocumented permission, storage key, stored field or retention bound. README privacy section rewritten as an accurate summary, and the `notifications` wording fixed. D-7 code audit done; owner check D7-L1 added. | [VERIFIED] in tests below. | `npm run check` PASS (201 tests). |
| 2026-11-10 | M5 C-5 proposal: `docs/design/m5-copy-review.md`, one term per concept (continuation, answer, message box, status line, the ChatGPT tab) and current vs proposed wording for every status, detail, halt reason and guidance line, send-failure detail, refusal, log line, banner and notification. Wording only; nothing applied. | Proposal only (owner review pending). | `npm run check` PASS. |
| 2026-11-10 | M5 C-5 applied after the owner's review, with the owner's six edits: Running kept; Stopped by an error; Continuation in <countdown>; the unrecognized-notice safety clause (Nothing was sent.) kept; Reset confirmation text fixed (both settings and the continuation prompt; implemented in C-6); one accurate wording for Resume's one-time status-line override (it sends the continuation to that answer once, later answers are checked again; sending a message yourself does not resume). Every reason, guidance line, detail, refusal, log line, banner, notification and the toolbar tooltip follow the table; a reason reads "Reason: detail." with one final period (fixes the old double period after the usage-limit detail). Wording only, no behaviour change. New `test/copy.test.ts`. | [VERIFIED] in tests below. | `npm run check` PASS (206 tests); `npm run e2e` PASS. |
| 2026-11-10 | M5 C-6, settings: D-3 delay minimum 1 s (a stored 0 falls back to the default, 10 s); each invalid field marked in place (`aria-invalid`, `aria-describedby`, message under the field, focus on the first) and nothing sent until fixed; an empty number box is now invalid instead of being read as 0; *Unsaved changes* while the form differs from the saved settings (kept across refreshes); *Reset to defaults* asks first, inline, naming the settings and the continuation prompt (Escape or Cancel keeps everything); one line on when saved changes apply, checked against the code (the prompt is read at send time, the delay when a countdown starts). Two controller tests moved from a 0 s to the 1 s delay, same assertions. New `src/ui/settingsForm.ts` with unit tests; 12 new E2E checks. | [VERIFIED] in tests below. | `npm run check` PASS (211 tests); `npm run e2e` PASS (development build and the unzipped release ZIP). |
| 2026-11-10 | M5 C-4, first run: a *Getting started* card on a fresh install only (`onInstalled` reason `install`), five steps from the design, links to the `AUTOPILOT.md` template and `PRIVACY.md`, *Don't show again* (stored as `autopilot.gettingStarted` next to the settings, not inside them, so Save and Reset never bring it back; documented in PRIVACY.md and checked by `test/privacyDoc.test.ts`). Before Start, the panel asks the active ChatGPT tab whether its content script answers (it returns its cached observation, so the page is not read again); if not, Start is unavailable and the hint says to reload the tab. No new permission; no tabs opened. E2E covers the real case: a tab open *before* the extension is installed (installed over the DevTools protocol), then reloaded. | [VERIFIED] in tests below. | `npm run check` PASS (214 tests); `npm run e2e` PASS (development build and the unzipped release ZIP). |
| 2026-11-10 | M5 C-8, page check: a *Page* line in the Session card from the observed structure signals of the tab Autopilot works in (message box, Send or Stop button, answer count, interface language from `<html lang>`; new signal `interfaceLanguage`, a language tag only, enforced by the validator). "Not fully recognized" names what is missing and points to the diagnostic report. A missing Send button counts only while the message box has text: whether ChatGPT shows it for an empty box is not established live, so an empty box never warns (owner check PC-L1 added). No text read; no new message type. | [VERIFIED] in tests below; PC-L1 pending (owner). | `npm run check` PASS (220 tests); `npm run e2e` PASS. |
| 2026-11-11 | M5 C-7, accessibility: a visually hidden polite live region announces only real status, reason or guidance changes (never the countdown ticking); focus is never lost after an action (it stays on the control, or moves to the one that replaced it: Start→Pause→Resume→Pause, Stop→Start; else the status line); the *Fix first* border uses the `--warning` token (4.87:1 / 6.85:1, was a fixed colour at 2.24:1); text-field borders get `--control-border` (3.22:1 / 5.07:1, were 1.33:1 / 1.92:1, below WCAG 1.4.11); axe found the Activity log could not be scrolled by keyboard (now focusable, named). axe-core 4.14.0 pinned as a dev dependency (D-5; not in the ZIP) runs in the E2E in both themes: no violations. `docs/ACCESSIBILITY_CHECKLIST.md` for the manual keyboard, screen-reader and visual check (R-4), added to the RC rows as P-L5. | [VERIFIED] in tests below; manual checklist pending (owner, at RC). | `npm run check` PASS (222 tests); `npm run e2e` PASS (development build and the unzipped release ZIP). |
| 2026-11-11 | M5 C-9, documentation: README rewritten as a user guide (install from the release ZIP, first use, panel, safeguards, Stop on status marker, the project's AUTOPILOT.md, privacy summary, troubleshooting, known limitations; the stale M3 "pending live confirmation" note removed). Troubleshooting lists every halt with the panel's exact reason, label and guidance (`test/docs.test.ts` fails if they drift), plus other problems; one wrong claim about how the two delays combine was caught against the code and corrected before commit. Developer material moved to `docs/DEVELOPMENT.md`. `LICENSE` (MIT, copyright DarkonLikesCoffee, D-1), copied into every build so the ZIP carries it; `license` in package.json. `CHANGELOG.md` (0.3.0, release candidate; 0.1.0/0.2.0 were development-only) and draft release notes `docs/releases/0.3.0.md`. RELEASING updated. **No tag, no release.** | [VERIFIED] in tests below. | `npm run check` PASS (225 tests); `npm run e2e` PASS (development build and the unzipped release ZIP). |

## 12. Exact next action

- **Cloud:** none in M5 until the owner's results arrive. Release candidate 0.3.0 is the CI artifact `chatgpt-autopilot-release-zip` of the latest `main` commit. Then: record the results, fill in the release notes' verification section, act on D7-L1 (remove `chat.openai.com` if it only redirects) and PC-L1.
- **Owner (when convenient):** D7-L1 (does `chat.openai.com` end at chatgpt.com?); PC-L1 (is the Send button shown for an empty message box?).
- **Owner, now (release candidate):** install the CI ZIP (docs/RELEASING.md section 2) and run P-L1 to P-L5 in `docs/LIVE_VALIDATION.md` (P-L5: the accessibility checklist); then approve or reject publishing 0.3.0.
- **Never without the owner's explicit approval:** tagging `v0.3.0` or publishing a GitHub Release.
- **Reply status:** `AUTOPILOT STATUS: BLOCKED` (every remaining M5 step needs the owner: the release-candidate checks and the decision to publish)

## 13. Update protocol

After every meaningful task:
- record the exact change and evidence;
- update the current milestone and task queue;
- add newly discovered bugs and blockers;
- preserve old decisions and supersede them rather than deleting them;
- record checks as PASS, FAIL or NOT RUN;
- leave one exact next action.

Never invent work to keep an automation running. If no safe, meaningful task remains, report that clearly.
