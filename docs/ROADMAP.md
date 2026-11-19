# Development Roadmap

This roadmap describes the intended evolution of ChatGPT Autopilot. It is directional, not permission to implement every idea immediately. The active milestone and verified state live in the root `AUTOPILOT.md`.

## Product north star

A user should be able to start a ChatGPT conversation connected to a software project, enable Autopilot, leave the browser session open, and return to meaningful project progress — without the extension sending duplicate prompts, corrupting user input, switching conversations, or hiding failures.

The extension should remain small and deterministic. ChatGPT is the reasoning engine; the extension is the reliable trigger and control surface.

## M1 — Real-world interaction reliability (P0) — complete 2026-11-05

Completed with live validation on the es-ES interface (runs 1–5 in `docs/LIVE_VALIDATION.md`). Carried forward as known limitations: other interface languages are not live-verified, and notice texts are English-only (unrecognized notices pause).

**Outcome:** The core detect → wait → validate → type → send → confirm loop behaves safely under realistic conditions.

Work areas:
- Validate the current ChatGPT DOM assumptions and selectors against the live site.
- Test response completion detection across streaming pauses, re-renders, regenerated answers, DOM replacement and navigation.
- Audit exactly-once behavior and crash/restart windows around submission.
- Verify composer text is never overwritten and a pending continuation is cancelled when the user starts typing or sends another message.
- Understand background/hidden-tab throttling and discarded-tab behavior.
- Make failures actionable and observable.

Exit criteria are defined in `AUTOPILOT.md`. Fake-page tests alone are insufficient evidence for live compatibility.

## M2 — Recovery and observability (P1) — complete 2026-11-06

Delivered: text-free diagnostic report export, recoverable-vs-terminal guidance,
stage history, recovery tests and live owner check. See the M2 evidence in
`AUTOPILOT.md`.

**Outcome:** Users and developers can understand what happened and recover from
expected browser lifecycle events.

Do not add telemetry or a remote backend just to obtain diagnostics.

## M3 — Explicit stopping and control protocol (P1) — complete 2026-11-10

Delivered as the opt-in "Stop on status marker" (design: `docs/design/m3-stop-protocol.md`), validated live (M3-L0 to L6). The historical notes below are kept for context.

Prerequisite decision: recognizing a status marker means reading the text of ChatGPT's latest answer, which the current privacy principle rules out. The owner decides whether and how narrowly to allow it (for example: only the last answer, only an exact marker on its own line, never stored or sent).

**Outcome:** Repeated continuation stops predictably when the project workflow is complete or blocked.

Explore:
- A small, explicit status convention in the assistant's final response, such as CONTINUE, BLOCKED or MILESTONE COMPLETE.
- A conservative parser for the latest assistant response, with tests for malformed, quoted, missing and ambiguous status markers.
- A clear user-visible reason when a status marker stops the run.
- Manual override and pause/stop always take precedence.

Important limitation: a status marker is a control signal, not proof that the underlying code or milestone is correct. Verification still belongs to tests, repository state and human judgment. Do not make this feature a substitute for M1 reliability.

## M4 — Multiple independent project sessions (P2) — current

Next task: T8, design proposal and threat/race-condition analysis before implementation.

**Outcome:** A user can manage more than one project/conversation without cross-contamination.

Before implementation, design:
- Stable session identity and conversation binding.
- Per-session prompt, cycle cap, delay and status.
- Isolation of timers, answered-response keys and diagnostics.
- Behavior when multiple ChatGPT tabs target the same or different conversations.
- Recovery and cleanup of closed/discarded tabs.
- Clear UI for selecting, pausing and stopping individual sessions.

Do not begin this milestone until M1 and the relevant M2 foundations are reliable.

## M5 — UX, onboarding and release quality — complete (0.3.0 published 2026-11-19)

Approved design: `docs/design/m5-release-quality.md`. Implementation C-1 to C-9
completed 2026-11-11. Owner published the 0.3.0 release on 2026-11-19.
Installed-ZIP verification: P-L1, P-L2, D7-L1 and PC-L1 PASS; P-L3, P-L4
and P-L5 remain **NOT RUN** and are disclosed in the release notes.

**Outcome:** A new user can understand the extension and operate it safely. M5
work is complete for this release; remaining live checks are disclosed follow-up,
not release blockers.

## Later exploration — Advanced automation

Only consider capabilities that reinforce the product's core purpose without turning the extension into an opaque agent.

Possible explorations:
- Better scheduling and backoff for known transient browser failures.
- Optional task/session summaries that do not require reading conversation contents.
- A pluggable continuation policy, provided deterministic safeguards remain mandatory.

Not currently approved:
- Direct GitHub API integration inside the extension.
- A hosted backend or database.
- API-key-based model calls or local model execution.
- Automatic bypass of ChatGPT limits or anti-abuse controls.
- Autonomous changes to permissions, security policy or repository settings.
- Multi-agent orchestration before single-session reliability is established.

## Prioritization rules

1. Fix correctness and safety before adding features.
2. Prefer reproducible bugs and measurable acceptance criteria.
3. Avoid parallel tasks that edit the same core state machine or composer flow.
4. Each change should have tests and a focused PR.
5. Revisit priorities when evidence from real usage contradicts assumptions.
6. Keep the active milestone and exact next action in `AUTOPILOT.md`.
