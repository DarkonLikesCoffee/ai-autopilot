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
- [VERIFIED] The extension observes ChatGPT page structure and composer state, not conversation text. Evidence: `README.md`, `src/content/page.ts`.
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
10. Keep privacy minimal: do not read, store or transmit conversation contents.

## 4. Current implementation snapshot

- [VERIFIED] The extension has a configurable continuation prompt, delay, completion-confirmation delay, cycle limit and notifications. Evidence: `README.md`, `src/shared/settings.ts`.
- [VERIFIED] The detector waits for a confirmed non-generating state after observing generation. Evidence: `src/content/detector.ts`.
- [VERIFIED] The composer types and verifies the prompt, attempts one send, and checks whether the message was sent. Evidence: `src/content/composer.ts`.
- [VERIFIED] The session logic tracks answered responses and avoids retrying an ambiguous submission. Evidence: `src/shared/session.ts`.
- [VERIFIED] Unit tests cover the state machine/controller workflow; browser E2E tests run against a fake ChatGPT page. Evidence: `test/`, `e2e/extension.e2e.mjs`, `README.md`.
- [VERIFIED] CI runs typecheck, unit tests and build. Evidence: `.github/workflows/ci.yml`.
- [UNRESOLVED] The latest main-branch CI result and live ChatGPT compatibility must be checked at the beginning of each session; do not assume prior results remain current.

## 5. Current milestone

**Milestone M1 — Establish real-world interaction reliability**

Goal: prove that the extension can safely observe and continue a real ChatGPT conversation under realistic browser conditions, and fail safely when it cannot.

Status: [UNRESOLVED] **In progress — not complete.** Reassessed 2026-11-05 after live runs 2 and 3 (`docs/LIVE_VALIDATION.md`). Five of eight requirements are met; three still lack live evidence (listed under each).

### Definition of done

- [ ] **Selectors and completion detection validated against the live site.** [VERIFIED] es-ES: completion detected for every response in runs 2–3 (D2), regenerated answers detected (D5), Send/Stop labels recognized (L1). **Open:** the diagnostic-level checks D1 (messages counted once, id-based key), D3 (user count +1), D4 (composer text detected) and D6 (key follows a conversation switch) were not run. Their end-to-end effects were observed (S1/S2 rely on D1/D3; S3 on D4; S4 on D6), so the owner may accept them as covered **or** run them (about 2 minutes with diagnostics on). English interface (L2) not run: English support stays unverified live.
- [x] **Sending validated, exactly once.** [VERIFIED] es-ES run 2: three continuations, each confirmed, one per finished response; stopped exactly at the limit. Regenerated answers did not cause a duplicate (D5, run 3).
- [x] **Composer protection when the user has typed text.** [VERIFIED] run 3, S3 PASS: typing during the countdown paused Autopilot and nothing was sent.
- [ ] **Conversation switching, usage-limit notices, login/error states and generation restarts fail safely.** [VERIFIED] conversation switching (S4) and generation restarts (D5), run 3. **Open:** usage-limit (N1), login/session-expired (N2) and ChatGPT error notices (N3) not observed live; covered only by unit and E2E tests. Needs either a live observation when they occur, or the owner explicitly accepting them as untestable on demand.
- [ ] **Background/hidden-tab behaviour understood and documented; unsupported conditions handled safely.** [VERIFIED] S5 (tab behind another tab: sent to the session's tab) and S6 (minimised browser) PASS, run 3. **Open:** for S6 the report does not say which safe outcome occurred (sent once, or stopped with a `tab_suspended` / send-unavailable error). "Understood and documented" needs that observation; README's hidden-tab limitation is updated once it is known.
- [x] **Unit tests, typecheck and build pass.** [VERIFIED] `npm run check` on `main` (125 tests), CI `check` job.
- [x] **Browser E2E passes for all relevant deterministic scenarios.** [VERIFIED] CI `e2e` job (fake page, incl. es-ES) on every PR; owner is making it a required check.
- [x] **No known high-severity regression.** [VERIFIED] none known; runs 2–3 found no failure.

Also required by the live-test minimum (section below), not a separate DoD line: **P1** (Pause/Resume/Stop during the countdown) — NOT RUN.

Do not claim the milestone complete based only on fake-page tests.

### Live test matrix (M1)

Authoritative status of every live test. Procedure and capture steps: `docs/LIVE_VALIDATION.md` (same IDs). Run in a throwaway conversation with **Maximum cycles = 2 or 3**. Record each run with date, interface language and build, and set the status here only from an observed result: **VERIFIED** (observed as expected), **FAILED** (with a link to the fix), **NOT RUN**.

| ID | Test (what you do) | Expected behaviour | DoD item | Status |
|---|---|---|---|---|
| D1 | Idle conversation with one finished answer; diagnostics on | `status: complete`; assistant messages counted once; response key ends in `id:…` | Detection | NOT RUN |
| D2 | Send a question yourself and let it stream | Generating for the whole stream, then complete once it ends; log shows "ChatGPT is generating a response." then "Response complete…" | Detection | **VERIFIED** es-ES (Run 2: three responses detected) |
| D3 | Compare `userMessageCount` before/after D2 | Increases by exactly 1 | Detection | NOT RUN |
| D4 | Type a draft, do not send; diagnostics on | `composerHasText: true` | Composer protection | NOT RUN |
| D5 | Regenerate the last answer while Autopilot runs | Generating, then complete; a regenerated answer with a new id gets **one** continuation, one with the same key gets none; never two | Generation restarts | **VERIFIED** (Run 3) |
| D6 | Switch conversation in the sidebar; diagnostics on | Response key path changes to the new `/c/<id>` | Conversation switching | NOT RUN |
| S1 | Start after an answer finished | After the delay exactly one continuation is sent and logged "Continuation N sent." | Sending exactly once | **VERIFIED** es-ES (Run 2) |
| S2 | Let it run to the limit | Stops at the maximum; never two messages for one answer | Sending exactly once | **VERIFIED** es-ES (Run 2: stopped at 3) |
| S3 | During the countdown, type into the message box | **At the end of the countdown** (not immediately): Paused, "The message box already contains text"; nothing sent; your text unchanged | Composer protection | **VERIFIED** (Run 3) |
| S4 | During the countdown, switch to another conversation | Paused at once, "The tab switched to a different conversation"; nothing sent in either conversation | Conversation switching | **VERIFIED** (Run 3) |
| S5 | During the countdown, open another tab in front (same window) | The continuation is still sent to the session's tab, once | Background tabs | **VERIFIED** (Run 3) |
| S6 | During the countdown, minimise the window or switch to another window, for longer than the delay | Either sent once, or stopped with an error ("…suspended or throttled…" / "the send button did not become available") and the prompt removed; never sent twice or late. Record which | Background tabs | **VERIFIED** safe (Run 3); outcome (sent vs stopped) not reported |
| P1 | During the countdown, press Pause; later Resume. Separately, press Stop | Pause/Stop: nothing sent. Resume: one continuation after a fresh delay | User control | NOT RUN |
| N1 | Usage-limit notice appears (when it happens naturally) | Error, "ChatGPT shows a usage limit"; nothing sent; not retried | Error states | NOT RUN (cannot be triggered on demand) |
| N2 | Logged out / session expired notice (naturally, or log out in another tab) | Error, "ChatGPT asks you to log in"; nothing sent | Error states | NOT RUN |
| N3 | ChatGPT error notice ("Something went wrong", network error) | Error, "ChatGPT shows an error"; nothing sent | Error states | NOT RUN (cannot be triggered on demand) |
| R1 | Close the ChatGPT tab during the countdown | Paused, "The ChatGPT tab was closed"; nothing sent | Recovery | NOT RUN |
| R2 | Quit and reopen the browser while running | Paused, "The browser or the extension restarted"; nothing sent until you resume | Recovery | NOT RUN |
| L1 | Spanish interface (es-ES) | Send (`Enviar`) and Stop (`Detener`) recognized | Detection / sending | **VERIFIED** (Run 2) |
| L2 | English interface | Same as S1/S2 | Detection / sending | NOT RUN |

M1's definition of done needs, at minimum: D1–D6, S1–S4 and P1 VERIFIED; S5/S6 observed and their behaviour documented; N1–N3 VERIFIED when they occur, or explicitly accepted as untestable on demand by the owner (they are covered by unit and E2E tests).

## 6. Prioritized roadmap

See `docs/ROADMAP.md` for milestone details. Current order:

1. **P0 — M1 reliability:** live compatibility, detection correctness, exactly-once sending, safe composer behavior, hidden-tab handling and diagnostics.
2. **P1 — M2 recovery and observability:** actionable diagnostics, session history, robust restart/recovery behavior and clearer error states.
3. **P1 — M3 stopping and control:** structured completion/blocked signals and predictable stop behavior, without pretending the extension can judge code quality.
4. **P2 — M4 multi-project sessions:** independent sessions and clear session identity, only after single-session reliability.
5. **P3 — M5 product polish:** onboarding, settings UX, accessibility, packaging and release process.
6. **Later exploration:** advanced automation only where it preserves the deterministic boundary and user control.

## 7. Actionable task queue

Choose the highest-priority task that remains valid after inspecting the current code, open PRs and CI. Update this list as tasks are completed or priorities change.

- [ ] **T1 (P0): Live-site compatibility investigation.** Live run 1 (es-ES) found the missing Spanish send label (fixed, #12); live run 2 (es-ES, 2026-11-05) PASSED detection, sending exactly once and the cycle limit. **Remaining:** live rows D1, D3–D6, S3–S6 (owner), and other interface languages when someone uses them.
- [x] **T2 (P0): Completion-detection test coverage.** Done 2026-11-04. Added deterministic tests for streaming that pauses and resumes, DOM replacement inside the confirmation window, response ids that change after completion, navigation away and back, and regenerated responses (new id vs same key). Found and fixed a silent stall: a finished response whose key changed without a new generation (a late message id, a re-render) left Autopilot "Running" but never continuing. The pending continuation now moves to the updated response with a fresh delay (at least the confirmation delay when the read was not confirmed); answered keys are never targeted. [ASSUMED] that ChatGPT really assigns ids late — not observed; the fix is safe either way.
- [x] **T3 (P0): Submission safety audit.** Done 2026-11-04 (#6 and follow-up). Done: the window between typing the prompt and clicking send (up to 3 s while the send button becomes available). Fixed: (1) text you typed during that wait was sent together with the prompt; (2) if the send button never became available, everything in the box was deleted, including your text; (3) no re-check of conversation, generation or usage limit before the click. Now every poll and the moment before the click re-check the page; the prompt is removed only while the box holds exactly the prompt; a prompt that vanished before the click is reported as uncertain (pause, never retried). New `test/composer.test.ts` (10 tests, fake DOM). Part 2 (after the click): more user messages appearing (older ones loading in, a re-render) while the prompt is still in the box was taken as "sent", leaving the prompt unsent and the session waiting forever; confirmation now also requires the prompt to have left the box. A send that happens after `confirmMs` empties the box, so it is reported as uncertain (never retried). The contenteditable (ProseMirror) path is covered by the Chromium E2E only, not by unit tests.
- [ ] **T4 (P0): Hidden/background tab behavior.** In progress (2026-11-04). Done: the send step's waits (Send button up to 3 s, confirmation up to 10 s) were counted in polls, so late timers could stretch them without bound while the background waited for the reply; they are now wall-clock bounded, and Send is never clicked if the attempt took more than `sendReadyMs + lateMarginMs` (5 s) — the prompt is removed and the run stops with a `tab_suspended` error. Experiments in headless Chromium (scratch scripts, not committed): a page frozen with CDP `Page.setWebLifecycleState` still answered messages and ran timers, so real freezing could not be reproduced; `chrome.tabs.discard` crashed headless Chromium. [ASSUMED] Chrome's documented intensive throttling of hidden tabs (chained timers about once a minute after 5 min hidden) applies to the content script; not observed here. **Remaining:** observe real hidden/frozen/discarded tabs in a headed browser (`docs/LIVE_VALIDATION.md` S5–S6) and decide the supported behavior from that evidence.
- [x] **T5 (P1): Diagnostics.** Done 2026-11-04. Audit of the activity log against the five stages: confirmed completion + scheduled continuation ("Response complete. Continuation N in Xs."), submission attempt ("Sending continuation N."), confirmed submission ("Continuation N sent.") were logged; **generation observed was never logged**, so a stalled run could not show whether ChatGPT was ever seen working. Added "ChatGPT is generating a response." once per response. A completion detected but not yet confirmed exists only in the content script (the panel shows the live ChatGPT state; the opt-in console diagnostics show it in detail); not added to the log, to avoid a new message type for a transient state. Test: a full cycle logs each stage once, in order. No conversation text in any message.
- [x] **T6 (P1): Session recovery.** Done 2026-11-04. Audited restart × phase: browser restart (all phases) and a worker restart during the delay were already handled and tested. **Fixed:** a worker restart *during an attempt* that woke within 60 s scheduled nothing; if the tab's result report never arrived (tab crashed or discarded), the session stayed "Running" in `submitting` forever. WAKE now schedules a check for when the result is overdue; DUE then pauses as uncertain (the response stays answered; a late result is still applied). Schema-version changes (extension update) were already safe (restored as stopped, answered keys kept); now pinned by a test.
- [ ] **T7 (P1): Structured stop protocol.** Evaluate a conservative, explicit assistant status signal for CONTINUE/BLOCKED/COMPLETE. Do not implement until M1 reliability is established; status text is not proof that the work itself is correct.
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

- [VERIFIED] **Live-site bug (owner report, 2026-11-04) — root cause found and fixed.** On the es-ES ChatGPT UI the only send control is `<button aria-label="Enviar" type="submit">`; all four send selectors matched nothing, so every continuation stopped with "the send button did not become available". The owner's live diagnostics showed insertion working (`holdsPrompt: true`, `proseMirror: true`, `execCommandReturned: true`): a selector issue, not an insertion or timing issue. Fix: localized labels live in one table (`LOCALIZED_LABELS` in `selectors.ts`, each with its observation source; `Enviar`/`Detener` for es), and a send-button match inside the message box's own form is preferred over one elsewhere (`sendButton.ts`). Insertion mechanism and timeouts unchanged. [UNRESOLVED] other UI languages: work only where ChatGPT exposes `data-testid`/`id`; labels are added only from live observations.

- [UNRESOLVED] `[data-talvt-turn-state="in_progress"]` counts as generating. If ChatGPT ever leaves a stale in-progress marker after an error, Autopilot waits forever (safe direction: no send). Check during live validation.
- [UNRESOLVED] Localized stop-button labels are matched one by one (only English variants and Spanish "Detener"); `data-testid="stop-button"` is the language-independent signal. Other UI languages are unverified.

- [UNRESOLVED] Automated E2E tests use a fake ChatGPT page; they do not prove live-site compatibility.
- [UNRESOLVED] ChatGPT can change DOM structure and selectors without notice.
- [UNRESOLVED] Hidden/background tab throttling may affect typing, timers or sending.
- [VERIFIED] ChatGPT usage limits are external constraints; the extension stops when it detects a usage-limit notice. Evidence: `README.md`.
- [VERIFIED] The extension cannot decide whether the AI's project work is correct or whether a project milestone is genuinely complete. Evidence: product architecture and `README.md`.
- [UNRESOLVED] A model can misunderstand instructions, repeat work, or report completion inaccurately. Evidence-based project state and CI reduce but do not eliminate this risk.

- [VERIFIED] A response whose key does not change when it is regenerated (no message ids, count-based keys) is not continued again; this is the safe direction. Evidence: `test/controller.test.ts` ("a regenerated response with a new id…").

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

## 12. Exact next action

M1 is not complete. To close it, the owner needs to:

1. **P1** — during a countdown press Pause (nothing sent), then Resume (one continuation after a fresh delay); separately press Stop (nothing sent).
2. **S6 detail** — say which safe outcome the minimised-browser test showed: the continuation was sent once, or Autopilot stopped with an error and removed the prompt.
3. **D1/D3/D4/D6** — either accept them as covered by S1–S4 (record the decision here), or run them with diagnostics on.
4. **N1–N3** — record them when they occur naturally, or explicitly accept them as untestable on demand (they stay covered by unit/E2E tests).
5. Optional: say which interface language run 3 used; L2 (English) only if English support should be claimed as live-verified.

After that: reassess M1 again; if complete, mark it and move to **M2 — Recovery and observability** (`docs/ROADMAP.md`), starting with T-items for an exportable text-free diagnostic report and clearer recoverable-vs-terminal states. Until then: no T7, no new features (owner decision, 2026-11-05).

- **Reply status:** `AUTOPILOT STATUS: BLOCKED` — waiting for the owner's answers above.

## 13. Update protocol

After every meaningful task:
- record the exact change and evidence;
- update the current milestone and task queue;
- add newly discovered bugs and blockers;
- preserve old decisions and supersede them rather than deleting them;
- record checks as PASS, FAIL or NOT RUN;
- leave one exact next action.

Never invent work to keep an automation running. If no safe, meaningful task remains, report that clearly.
