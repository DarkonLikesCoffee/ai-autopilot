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

- [ ] **T1 (P0): Live-site compatibility investigation.** Identify a safe, repeatable manual validation procedure for the current ChatGPT UI; document which selectors and states were actually verified. Do not claim success without a real run.
- [ ] **T2 (P0): Completion-detection test coverage.** Audit detector edge cases (streaming pauses, regenerated responses, DOM replacement, conversation navigation and delayed UI updates); add deterministic tests for uncovered cases.
- [ ] **T3 (P0): Submission safety audit.** Audit composer typing, send-button detection and sent-message confirmation for duplicate/lost-message race conditions; add tests for each discovered issue.
- [ ] **T4 (P0): Hidden/background tab behavior.** Investigate timer throttling, tab visibility and discarded tabs; define and test a safe supported behavior.
- [ ] **T5 (P1): Diagnostics.** Ensure the activity log clearly distinguishes detected completion, confirmed completion, scheduled continuation, submission attempt and confirmed submission, without exposing conversation text.
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

- [UNRESOLVED] Automated E2E tests use a fake ChatGPT page; they do not prove live-site compatibility.
- [UNRESOLVED] ChatGPT can change DOM structure and selectors without notice.
- [UNRESOLVED] Hidden/background tab throttling may affect typing, timers or sending.
- [VERIFIED] ChatGPT usage limits are external constraints; the extension stops when it detects a usage-limit notice. Evidence: `README.md`.
- [VERIFIED] The extension cannot decide whether the AI's project work is correct or whether a project milestone is genuinely complete. Evidence: product architecture and `README.md`.
- [UNRESOLVED] A model can misunderstand instructions, repeat work, or report completion inaccurately. Evidence-based project state and CI reduce but do not eliminate this risk.

## 10. Decisions

| ID | Decision | Rationale | Status |
|---|---|---|---|
| D1 | Keep the extension a deterministic continuation trigger, not an AI agent. | Keeps scope, permissions and failure modes understandable. | Active |
| D2 | Use the normal ChatGPT UI rather than undocumented APIs. | Avoids fragile/private interfaces and credential handling. | Active |
| D3 | Keep GitHub/repository operations outside the extension. | The AI's connected GitHub workflow handles project files; extension only handles browser continuation. | Active |
| D4 | Prefer stopping over retrying an ambiguous send. | Avoids duplicate prompts and unintended actions. | Active |
| D5 | Validate single-session reliability before multi-session support. | Prevents multiplying unresolved state and race conditions. | Active |
| D6 | Development PRs should target `main`; automatic merging is allowed only after required CI checks pass. | Enables unattended contributions without bypassing verification. | Active |

## 11. Session history

| Date | Work | Outcome | Checks |
|---|---|---|---|
| 2026-11-03 | Established persistent Claude Code development context and roadmap. | [VERIFIED] Added `CLAUDE.md`, `AUTOPILOT.md` and `docs/ROADMAP.md` on a dedicated branch. | Documentation-only change; code checks not run. |

## 12. Exact next action

- **Next task:** T1 — investigate live-site compatibility and define a safe validation procedure.
- **Why:** The fake-page tests cannot establish that the core product works against the real ChatGPT UI.
- **First step:** Inspect `src/content/selectors.ts`, `page.ts`, `detector.ts` and `composer.ts`; compare every assumed selector/state with current observable behavior, then document what can and cannot be validated in the cloud environment.
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
