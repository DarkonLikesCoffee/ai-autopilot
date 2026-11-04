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

Status: [UNRESOLVED] In progress.

### Definition of done

- [ ] Current selectors and completion detection are validated against the live ChatGPT site without relying on undocumented APIs.
- [ ] Sending is validated in a real ChatGPT conversation, including confirmation that the continuation was sent exactly once.
- [ ] Composer protection is verified when the user has typed text.
- [ ] Conversation switching, usage-limit notices, login/error states and generation restarts fail safely.
- [ ] Background/hidden-tab behavior is understood and documented; unsupported conditions are detected and handled safely.
- [ ] Unit tests, typecheck and build pass.
- [ ] Browser E2E coverage passes for all relevant deterministic scenarios.
- [ ] No known high-severity regression remains.

Do not claim the milestone complete based only on fake-page tests.

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

- [ ] **T1 (P0): Live-site compatibility investigation.** Partly done (2026-11-03): the manual procedure is `docs/LIVE_VALIDATION.md`; opt-in text-free diagnostics exist; selectors from the owner's live observations (`data-conversation-role`, `data-user-message-bubble`, `data-talvt-turn-state="in_progress"`, Spanish stop label "Detener") are in `selectors.ts`. **Remaining:** a person must run the procedure on the real site and record results. [ASSUMED] the new selectors match the live site — they come from the owner's branch `fix/live-chatgpt-detection`; no run is recorded.
- [x] **T2 (P0): Completion-detection test coverage.** Done 2026-11-04. Added deterministic tests for streaming that pauses and resumes, DOM replacement inside the confirmation window, response ids that change after completion, navigation away and back, and regenerated responses (new id vs same key). Found and fixed a silent stall: a finished response whose key changed without a new generation (a late message id, a re-render) left Autopilot "Running" but never continuing. The pending continuation now moves to the updated response with a fresh delay (at least the confirmation delay when the read was not confirmed); answered keys are never targeted. [ASSUMED] that ChatGPT really assigns ids late — not observed; the fix is safe either way.
- [x] **T3 (P0): Submission safety audit.** Done 2026-11-04 (#6 and follow-up). Done: the window between typing the prompt and clicking send (up to 3 s while the send button becomes available). Fixed: (1) text you typed during that wait was sent together with the prompt; (2) if the send button never became available, everything in the box was deleted, including your text; (3) no re-check of conversation, generation or usage limit before the click. Now every poll and the moment before the click re-check the page; the prompt is removed only while the box holds exactly the prompt; a prompt that vanished before the click is reported as uncertain (pause, never retried). New `test/composer.test.ts` (10 tests, fake DOM). Part 2 (after the click): more user messages appearing (older ones loading in, a re-render) while the prompt is still in the box was taken as "sent", leaving the prompt unsent and the session waiting forever; confirmation now also requires the prompt to have left the box. A send that happens after `confirmMs` empties the box, so it is reported as uncertain (never retried). The contenteditable (ProseMirror) path is covered by the Chromium E2E only, not by unit tests.
- [ ] **T4 (P0): Hidden/background tab behavior.** In progress (2026-11-04). Done: the send step's waits (Send button up to 3 s, confirmation up to 10 s) were counted in polls, so late timers could stretch them without bound while the background waited for the reply; they are now wall-clock bounded, and Send is never clicked if the attempt took more than `sendReadyMs + lateMarginMs` (5 s) — the prompt is removed and the run stops with a `tab_suspended` error. Experiments in headless Chromium (scratch scripts, not committed): a page frozen with CDP `Page.setWebLifecycleState` still answered messages and ran timers, so real freezing could not be reproduced; `chrome.tabs.discard` crashed headless Chromium. [ASSUMED] Chrome's documented intensive throttling of hidden tabs (chained timers about once a minute after 5 min hidden) applies to the content script; not observed here. **Remaining:** observe real hidden/frozen/discarded tabs in a headed browser (`docs/LIVE_VALIDATION.md` S5–S6) and decide the supported behavior from that evidence.
- [x] **T5 (P1): Diagnostics.** Done 2026-11-04. Audit of the activity log against the five stages: confirmed completion + scheduled continuation ("Response complete. Continuation N in Xs."), submission attempt ("Sending continuation N."), confirmed submission ("Continuation N sent.") were logged; **generation observed was never logged**, so a stalled run could not show whether ChatGPT was ever seen working. Added "ChatGPT is generating a response." once per response. A completion detected but not yet confirmed exists only in the content script (the panel shows the live ChatGPT state; the opt-in console diagnostics show it in detail); not added to the log, to avoid a new message type for a transient state. Test: a full cycle logs each stage once, in order. No conversation text in any message.
- [ ] **T6 (P1): Session recovery.** Audit browser restart, service-worker suspension, stale sessions and storage migration; add regression tests.
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

## 12. Exact next action

- **Next task:** T6 — session recovery audit: browser restart, service-worker suspension during each phase (watching, delay, submitting), stale sessions and storage-schema migration.
- **Why:** Next P1 task; existing tests cover browser restart and a worker restart during the delay, but not a worker restart *during submitting* or a schema version change.
- **First step:** Read `restoreSession` / the normalization at the end of `src/shared/session.ts` and `handleWake`/`handleStartup` in `src/background/controller.ts`; write a test per phase × restart kind; fix what fails.
- **Owner (blocked for cloud sessions):** run `docs/LIVE_VALIDATION.md` (T1, T4 remainders).
- **Reply status:** `AUTOPILOT STATUS: CONTINUE`

## 13. Update protocol

After every meaningful task:
- record the exact change and evidence;
- update the current milestone and task queue;
- add newly discovered bugs and blockers;
- preserve old decisions and supersede them rather than deleting them;
- record checks as PASS, FAIL or NOT RUN;
- leave one exact next action.

Never invent work to keep an automation running. If no safe, meaningful task remains, report that clearly.
