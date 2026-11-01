# AUTOPILOT.md — Project State

<!--
This file is the single source of truth for this project's development.
ChatGPT reads it at the start of every continuation and updates it at the end.

RULES FOR WHOEVER EDITS THIS FILE (ChatGPT or a human):
1. Read the whole file before choosing work. Do not repeat completed work.
2. Every statement carries one of these labels:
     [VERIFIED]    – backed by evidence recorded here (command + result, commit, file path)
     [ASSUMPTION]  – believed true but not checked
     [PROPOSAL]    – a suggestion that has not been agreed or implemented
     [UNRESOLVED]  – an open problem or question
3. Never mark a task done without evidence: the exact command you ran and its
   result, the commit SHA, or the file and line that shows it. If a check could
   not be run, say so and leave the task open.
4. Preserve decisions. To change one, add a new decision that supersedes it;
   do not delete the old one.
5. Keep "Current state" short and current. Keep "Session history" to the last
   10 sessions; fold older entries into a one-line summary.
6. Update this file after every meaningful piece of work, in the same commit
   when possible.
7. End every session by filling in "Exact next recommended action".
-->

## 0. Continuation protocol (read first, every time)

Development runs in repeated continuations. After each of your replies, the
ChatGPT Autopilot extension sends the same short, generic prompt telling you to
continue from this file. The prompt never says what to do next: **this file is
the only source of truth for objectives, rules, priorities and progress.** The
extension does not read or edit this file and does not check your work.

**At the start of every continuation:**
1. Read this whole file.
2. Verify the repository state before changing anything: current branch, latest
   commits, uncommitted changes, open pull requests and CI status. If what you
   find disagrees with this file, trust the repository, record the discrepancy
   in section 12 and correct this file first.
3. Choose the next task from section 16 (or, if it is done, the highest-priority
   open task in section 9).

**During the continuation:** implement, run the checks in section 10, and fix
what you break. Do one meaningful unit of work, not a plan.

**After meaningful progress (and at the end of every continuation):** update
this file in the same commit when possible: completed tasks with evidence
(section 11), new bugs (12), decisions (13), blockers (14), the session row (15)
and the next action (16). Label every claim `[VERIFIED]` (with evidence) or
`[ASSUMPTION]`.

**When to stop:** if the milestone's definition of done is met and verified, or
you are genuinely blocked, or a decision needs the owner, say so plainly and end
with the matching status line. Because the extension keeps sending the
continuation prompt until the owner stops it, **on later continuations do not
invent work:** re-check the repository, and if nothing changed, reply briefly
with the same status line.

## 1. Project overview and objectives

- **Project:** <name>
- **Repository:** <https://github.com/owner/repo> (default branch: `main`)
- **Purpose:** <one or two sentences on what this software does and for whom>
- **Objectives:**
  - [ASSUMPTION] <objective 1>
  - [ASSUMPTION] <objective 2>

## 2. Current milestone

- **Milestone:** <short name>
- **Goal:** <what this milestone delivers>
- **Status:** [UNRESOLVED] In progress

## 3. Definition of done (for the current milestone)

The milestone is complete only when **every** item is checked **and** has evidence.

- [ ] <criterion 1> — evidence: <command/result, commit, or file>
- [ ] <criterion 2> — evidence:
- [ ] All tests pass (`<test command>`) — evidence:
- [ ] Build succeeds (`<build command>`) — evidence:
- [ ] No open regressions in section 12 — evidence:

When all items are checked, set the milestone status to `[VERIFIED] Complete` and
end the reply with `AUTOPILOT STATUS: MILESTONE COMPLETE`.

## 4. Mandatory project rules

1. Do not claim success that was not verified. Report failures as failures.
2. Do not delete or rewrite unrelated code or files.
3. Keep changes small and focused on one task per continuation.
4. Run the checks in section 10 before marking a task complete.
5. Do not add paid services, secrets or credentials to the repository.
6. If a task needs a decision from the owner, record it in section 14 and stop that task.
7. <add project-specific rules>

## 5. Architecture and design constraints

- [VERIFIED/ASSUMPTION] <language, framework, runtime versions>
- [VERIFIED/ASSUMPTION] <module boundaries, data flow, persistence>
- [ASSUMPTION] <constraints: performance, security, compatibility>

## 6. Coding conventions

- <formatting / linting tool and config>
- <naming, file layout, error handling, logging>
- <test conventions: location, naming, frameworks>

## 7. Functional requirements

| ID | Requirement | Status |
|----|-------------|--------|
| FR-1 | <requirement> | [UNRESOLVED] not started |
| FR-2 | <requirement> | [UNRESOLVED] not started |

## 8. Prioritized roadmap

1. **P0** — <must-have for this milestone>
2. **P1** — <important>
3. **P2** — <nice to have / later milestone>

## 9. Actionable task checklist

Pick the highest-priority unchecked task whose dependencies are done.

- [ ] T1 (P0) <task> — depends on: — acceptance: <how to verify>
- [ ] T2 (P0) <task> — depends on: T1 — acceptance:
- [ ] T3 (P1) <task> — depends on: — acceptance:

## 10. Build, test, lint and verification commands

| Purpose | Command | Last known result |
|---------|---------|-------------------|
| Install | `<command>` | [UNRESOLVED] not run yet |
| Lint | `<command>` | |
| Type check | `<command>` | |
| Test | `<command>` | |
| Build | `<command>` | |

If a command cannot be run in your environment, write `NOT RUN — <reason>` instead of a result.

## 11. Completed tasks and supporting evidence

Newest first. Each entry: task id, what changed, evidence.

- _(none yet)_

## 12. Known bugs, technical debt and regressions

- [UNRESOLVED] <description> — found: <date/session> — impact: <low/medium/high>

## 13. Decisions and their rationale

Never delete entries; supersede them.

| # | Date | Decision | Rationale | Status |
|---|------|----------|-----------|--------|
| D1 | <YYYY-MM-DD> | <decision> | <why> | Active |

## 14. Blockers and unresolved questions

- [UNRESOLVED] <question or blocker> — needs: <owner input / external access / …> — safe next action meanwhile: <…>

If a blocker stops all useful work, end the reply with `AUTOPILOT STATUS: BLOCKED`.

## 15. Session history (last 10 sessions)

Older sessions: <one-line summary, or "none">.

| Session | Date | Task(s) | Outcome | Checks run |
|---------|------|---------|---------|------------|
| 1 | <YYYY-MM-DD> | <T1> | <done / partial / failed> | <tests passed / not run — reason> |

## 16. Exact next recommended action

- **Next task:** <task id and one sentence>
- **Why this one:** <priority / dependency reasoning>
- **First step:** <the first concrete action>
- **Status line for the reply:** `AUTOPILOT STATUS: CONTINUE`

<!-- Status lines are for the owner reading the conversation; the extension does
not parse them. Use CONTINUE, MILESTONE COMPLETE or BLOCKED. -->

