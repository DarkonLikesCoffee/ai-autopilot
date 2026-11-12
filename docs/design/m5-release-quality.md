# M5 proposal: release quality (audit and plan)

Status: **Approved by the owner (2026-11-10)** with decisions D-1 to D-7
(section 6) and requirements R-1 to R-5 (section 7). Implemented in focused
PRs in the order of section 5. **No public release and no `v0.3.0` tag
until the owner explicitly approves the release candidate.**

Ground rules: keep every reliability and privacy guarantee of M1–M3; no new
host permissions; no new runtime behaviour beyond what an item below states;
no features without a release-quality reason.

## 1. Current state (audited 2026-11-10, `main` at #32)

| Area | What exists today |
|---|---|
| **First run** | `onInstalled` only sets the side-panel behaviour. The panel opens as "Stopped" with one line ("Start Autopilot in the ChatGPT conversation you want to continue.") and, without a ChatGPT tab, "Open a ChatGPT conversation in this window to start." Key facts are only in the README: open tabs must be reloaded; what Autopilot does and never does; the default prompt expects an `AUTOPILOT.md` in the user's repository. A tab opened before install is detected only when Start fails ("Reload the ChatGPT tab, then start again"). |
| **Settings** | Prompt, delay (0–3600 s), confirmation delay (1–120 s), maximum cycles (1–100000, or *Unlimited*), notifications, *Stop on status marker* (off by default). `validateSettings` returns field-level issues, but the panel shows them only as one banner message: no field is marked invalid, and the form shows no unsaved-changes state. *Reset to defaults* resets the prompt too, without asking. When changed settings apply during a run is not explained. |
| **States and messages** | 6 panel statuses (Stopped, Running, Waiting for ChatGPT, Waiting before continuation, Paused, Error), 18 halt reasons with fixed texts, and guidance (*Resume when ready* / *Fix first* / *Finished*) for each. The texts were written one at a time over M1–M3 and were never reviewed together: tone, length and terms vary ("continuation", "prompt", "message", "status line"; some details are technical, such as the `tab_suspended` seconds). |
| **UI and accessibility** | One shared panel for popup and side panel; light and dark themes from colour tokens; `:focus-visible` outlines; labelled inputs; the banner is `role="status"`. **Status changes are not announced** (the status label is not a live region). Buttons are hidden and shown by state, so focus can land on a removed button after Start, Pause or Stop. `.guidance[data-kind="fix"]` uses a hard-coded colour outside the tokens. There is no accessibility check, manual or automated. The UI is English-only (the owner uses ChatGPT in Spanish). |
| **Install, build, packaging** | Developer install only: `npm ci && npm run build`, then *Load unpacked* `dist/`. `dist/` contains linked source maps. There is no package step (zip), no release artefact, no tags or GitHub releases, and the version (0.2.0 in both `package.json` and `manifest.json`, kept in sync by hand) predates M1–M3. Minimum Chrome 116; only Chromium was tested (CI E2E, unpacked). |
| **Privacy and permissions** | Permissions: `storage`, `alarms`, `notifications`, `sidePanel`; hosts `chatgpt.com`, `chat.openai.com`. The README privacy section is accurate on reading and sending, and the M3 guarantee (R10) is precise. But: (a) it calls `notifications` "optional", while the manifest **requires** it (only the setting is optional); (b) it does not say that `chrome.storage.local` keeps answered response keys, which contain the **conversation id and message ids**, the prompt, settings and the activity log; (c) the opt-in console diagnostics switch is stored in ChatGPT's own `localStorage`; (d) the disclosures are spread across four README sections and two docs. |
| **Documentation** | README (244 lines) mixes user guide, safeguards, privacy, M3 feature, developer notes and limitations, grown milestone by milestone. `docs/LIVE_VALIDATION.md` is a validation log, not user documentation. No `CHANGELOG.md`, no release notes, no `LICENSE`. |
| **Reliability and compatibility** | Live-validated on es-ES only (M1–M3). The selectors depend on ChatGPT markup: the unit `:assistant` suffix, Send/Stop labels for en and es only, and English-only notice texts. Unknown shapes fail safe (pause), but the user is not told *why the page is not recognized* until something fails. Tool, sources and thinking answers were never captured. **Per Chrome's documentation, packed extensions get a 30 s minimum for `chrome.alarms`, which unpacked builds do not** (not observed in this project; to be verified by C-3); the delay is also driven by a worker timer and a page ping, but a packed build was never tested. Using automation on the ChatGPT site may be subject to OpenAI's terms (the README says so). |

## 2. Problems identified

Ordered by release impact. *P0* = release blocker, *P1* = should fix for the release, *P2* = optional.

| # | Problem | Priority |
|---|---|---|
| P-1 | The privacy disclosure is inaccurate on `notifications` and incomplete on what is stored locally (ids in answered keys, the prompt, the log) and where the diagnostics switch lives. It is spread across sections. | P0 |
| P-2 | No release artefact or process: no package step, source maps ship, the version is stale and synced by hand, no tag or release notes. A user cannot install a known version. | P0 |
| P-3 | A packed build was never run, and the alarms minimum differs between packed and unpacked builds. Delay behaviour in a distributed build is unverified. | P0 |
| P-4 | No first-run guidance. The three most common first-run failures are explained only in the README or after a failure: a tab opened before install, no `AUTOPILOT.md` workflow, and the marker setting being off. | P0 |
| P-5 | State and error texts were never reviewed as a set; terms and tone are inconsistent, and some details are technical. | P1 |
| P-6 | Settings errors are not tied to fields, there is no unsaved-changes indication, Reset needs no confirmation, and when changes take effect during a run is not explained. | P1 |
| P-7 | Screen readers miss status changes; focus can be lost when buttons swap; one colour bypasses the theme tokens; no accessibility check exists. | P1 |
| P-8 | The page is not recognized → the user learns it only by a failure. There is no visible "page check" of what Autopilot can see (message box, Send control, answers). | P1 |
| P-9 | The README is hard to use as a user guide; there is no changelog, no release notes and no licence. | P1 (licence: owner decision) |
| P-10 | English UI only; other ChatGPT interface languages unverified (Send/Stop labels, notice texts). | P2 / owner decision |

## 3. Proposed changes

Each change keeps M1–M3 behaviour and the privacy guarantees; none adds a host permission.

**C-1 Privacy disclosure (P-1).** A new `PRIVACY.md`, written so it can serve as a store privacy policy, with:
- what is read (structure; the opt-in marker check per R10);
- what is stored locally and for how long: settings incl. the prompt; session state; answered keys, i.e. conversation and message ids, bounded to the last N; the activity log, bounded;
- what is never sent anywhere;
- the diagnostics switch in ChatGPT's `localStorage`;
- each permission and why it is needed;
- how to remove everything (uninstall; or Stop plus the browser's extension-storage clearing).

The README privacy section shrinks to a summary linking to it, and the `notifications` wording is fixed. No code change, unless the owner chooses D-4.

**C-2 Packaging and versioning (P-2).** `npm run package`:
1. builds without source maps;
2. checks that `package.json` and `manifest.json` versions match (fails otherwise);
3. writes `release/chatgpt-autopilot-<version>.zip` from `dist/`.

A CI step runs it and uploads the zip as a workflow artefact. A short `docs/RELEASING.md` covers: bump the version, update `CHANGELOG.md`, run `check`, `e2e` and `package`, do the release-candidate live check (C-9), tag `v<version>`, and attach the zip to a GitHub release. Version proposal: **0.3.0** (see D-2).

**C-3 Packed-build verification (P-3).** The E2E also loads the packed (`package`) output. One live check runs on that output: the delay, a short delay, a continuation. If the 30 s alarm minimum changes behaviour, fix it at the point where the alarm is scheduled, so that the timer and page ping stay primary and the alarm is only the fallback, with a test. No other change.

**C-4 First-run guidance (P-4).** On first install only (`onInstalled` reason `install`), the panel shows a dismissible **Getting started** card of 4–5 short steps:
1. Reload any ChatGPT tab that was already open.
2. Open the conversation and press Start.
3. Send your first message yourself.
4. What the continuation prompt expects (`AUTOPILOT.md`, linking the template), and that it can be changed.
5. Stop on status marker is off by default.

The card has a link to `PRIVACY.md` and a "Don't show again" choice, stored with the settings. *(As built: stored next to the settings in `chrome.storage.local`, under its own key `autopilot.gettingStarted`, not inside the settings object, so that saving or resetting the settings never brings the card back.)* Also a proactive hint before Start: if the active ChatGPT tab has no connected content script (the existing `GET_OBSERVATION` gets no answer), show "Reload this tab so Autopilot can connect", instead of failing at Start. No new permission; no opening of tabs.

**C-5 States and messages copy review (P-5).** One table in `docs/design/` lists every status, halt reason, detail, guidance line, banner and start refusal: current text, proposed text, and the term used. Then apply it, with:
- one term per concept ("continuation" for what Autopilot sends, "answer" for ChatGPT's reply, "status line");
- each reason as a short sentence saying what happened;
- the guidance line saying what to do;
- technical details only in the diagnostic report.

Tests pin the reason → kind mapping (exists) and that no text is empty or contains an internal code.

**C-6 Settings clarity and validation (P-6).**
- Show each validation issue next to its field (`aria-invalid`, `aria-describedby`).
- Show "Unsaved changes" while the form differs from the saved settings, and keep the form while a refresh arrives (already the case; to be tested).
- *Reset to defaults* asks for confirmation and says it resets the prompt.
- Add one line on when changes apply: the next delay or continuation; a running countdown is not changed.

No new settings; ranges unchanged unless D-3 decides otherwise.

**C-7 Accessibility pass (P-7).**
- The status label and guidance become a polite live region.
- After Start, Pause, Resume or Stop, focus moves to the button that replaced it (or the status).
- The guidance colour moves to the tokens, with dark-mode contrast checked.
- A written keyboard and screen-reader checklist in `docs/`.
- Optional (D-5): an automated axe-core check of the panel in the E2E, as a pinned dev dependency.

Target: no WCAG 2.2 AA failures in the panel for contrast, names, roles, keyboard and focus.

**C-8 Page check (P-8).** A compact "Page" line in the Session card, built from the signals already observed (message box found, Send control found, assistant answers recognized, interface language from `lang`). If something isn't recognized: "This ChatGPT page is not fully recognized (Send button not found)", plus the advice to copy the diagnostic report. It reads no text and adds no message type beyond the existing observation.

**C-9 Documentation and release notes (P-9).**
- Restructure the README into a user guide: what it is, install, first use, controls, safeguards, Stop on status marker, privacy summary, limitations, troubleshooting.
- Move the developer material to `docs/DEVELOPMENT.md` (build, tests, architecture, selectors, probes).
- Add `CHANGELOG.md`, starting at 0.3.0 with M1–M3 in user terms.
- Release notes per version, and a short troubleshooting section built from the guidance table.
- A `LICENSE` per D-1.
- **Release-candidate live check:** S1–S2 and M3-L3 on the packaged build, recorded in `docs/LIVE_VALIDATION.md`.

**C-10 Language support (P-10), only if the owner wants it (D-6).** Either (a) document "UI in English; ChatGPT interface languages verified: Spanish", which is the default and no change; or (b) translate the panel with `chrome.i18n` (English and Spanish), a contained but real scope addition. Notice texts and Send labels for other languages stay evidence-only (D9).

**Not proposed** (scope control): a backend, analytics or telemetry; new automation features; programmatic injection into open tabs (it would need the `scripting` permission); a "clear data" button (only if D-4 is chosen); M4 multi-session work.

## 4. Acceptance criteria

| Change | Done when |
|---|---|
| C-1 | `PRIVACY.md` lists every permission, every stored item with its bound, every read, and the deletion path; a reviewer can check each claim against the code (a table with file references). The README links it; the `notifications` wording matches the manifest. A test fails if a permission is added to the manifest without a `PRIVACY.md` entry. |
| C-2 | `npm run package` produces a zip without source maps; it fails on a version mismatch (tested); CI uploads the zip; `docs/RELEASING.md` exists; the version is bumped per D-2. |
| C-3 | The E2E passes against the packaged build; a live run on the packaged build confirms the delay (configured value ± a few seconds) and one continuation per answer. If a fix was needed, it has a test. |
| C-4 | A fresh install shows Getting started once; Dismiss persists; an unconnected tab shows the reload hint before Start; unit and E2E tests cover these; no new permission in the manifest. |
| C-5 | The copy table is reviewed by the owner; every text in the UI matches it; tests check that no reason or guidance text is empty or contains an internal code. |
| C-6 | Each invalid field is marked and described in place (tested); the unsaved state is shown; Reset asks first; the apply-timing line exists. |
| C-7 | Status changes are announced (live region); focus is never lost after a control action (E2E); contrast checked in both themes; the checklist exists and is completed; optionally axe reports no serious issues. |
| C-8 | The page line shows a recognized and an unrecognized state (unit tests from existing signals; E2E on the fake page with the Send button removed); no text is read. |
| C-9 | The README is a user guide (troubleshooting covers every *Fix first* reason); `docs/DEVELOPMENT.md` holds the developer material; `CHANGELOG.md` and the 0.3.0 release notes exist; the licence per D-1; the RC live check is recorded. |
| All | `npm run check` and CI `e2e` green; `test/privacy.test.ts` unchanged or stricter; no M1–M3 test weakened. |

## 5. Suggested implementation order

1. **C-2 packaging and C-3 packed-build verification.** Everything after this is tested on what users would install, and C-3 may surface a real behaviour difference.
2. **C-1 privacy disclosure.** A blocker; documentation only. It also gives C-4 the link it needs.
3. **C-5 copy review.** One table, owner review, then applied. C-4, C-6 and C-8 reuse its terms.
4. **C-6 settings.**
5. **C-4 first run.**
6. **C-8 page check.**
7. **C-7 accessibility pass.** Last among the UI items, so it covers the final UI.
8. **C-9 docs, changelog, release notes, RC live check, then tag 0.3.0.**
9. **C-10** only if D-6 says so.

Each step is one focused PR with tests, through the usual CI and auto-merge workflow.

## 6. Decisions (owner, 2026-11-10)

| # | Decision | Owner's choice | Notes |
|---|---|---|---|
| D-1 | Licence | **MIT**, provided the repository stays public and reusable | The repository is public (checked 2026-11-10). Copyright holder: the GitHub account `DarkonLikesCoffee` |
| D-2 | Version | **0.3.0** | `package.json` and `manifest.json` move to 0.3.0 for the release candidate. **No tag** until the owner approves the release candidate |
| D-3 | Delay minimum | **1 second** | `LIMITS.delaySeconds.min` from 0 to 1. Stored settings with 0 are normalized to the default (as for any out-of-range value); the user sees the change in Settings |
| D-4 | Distribution | **GitHub Releases only** | Installed by unzipping and *Load unpacked* |
| D-5 | axe-core | **Yes**, a pinned dev dependency | Runs in the E2E; complements, never replaces, the manual checks (R-4) |
| D-6 | UI language | **English for 0.3.0** | Documented; ChatGPT interface languages verified live: Spanish |
| D-7 | `chat.openai.com` | **Audit first; remove if demonstrably unnecessary** — done: D7-L1 (2026-11-11) showed it always redirects to chatgpt.com, so it was removed | See C-1. The audit needs one owner observation, because OpenAI sites are not reachable from cloud sessions |

## 7. Additional requirements (owner, 2026-11-10)

| # | Requirement | How the plan meets it |
|---|---|---|
| R-1 | The privacy documentation must accurately distinguish locally stored **prompts, identifiers, activity logs and answer content**, with storage locations, retention and deletion; no broader claims than the code supports | C-1: one table row per stored item, giving the storage area (`chrome.storage.local` key, `chrome.storage.session`, ChatGPT's own `localStorage` for the diagnostics switch, in-memory only), what it contains, the bound or retention, when it is deleted, and a code reference for each claim. Answer content: **not stored** (M3 reads it only temporarily). A test keeps the table in step with the storage keys and manifest permissions |
| R-2 | CI generates a ZIP artifact but **never publishes a GitHub Release automatically** | C-2: the CI job uploads the ZIP as a workflow artifact only. No `release` or `tag` step, no `contents: write` permission. The owner tests the exact artifact; publishing is a manual step in `docs/RELEASING.md` |
| R-3 | The packed-build alarm behaviour must be verified **with an actual installed ZIP**, especially delays **below 30 s**; development-build tests do not count | C-3: the owner downloads the CI artifact, installs it, and times delays of 5 s and 20 s (live rows P-L1 and P-L2). In addition, the delay must not *depend* on `chrome.alarms` for sub-30 s values: the worker timer and the page ping are the primary triggers, and the alarm is a fallback. This is tested, so a clamped alarm cannot delay the continuation. Note: per Chrome's documentation the 30 s minimum applies to packed (store or CRX) installs; a ZIP installed with *Load unpacked* is an unpacked extension. The live rows settle it for the way 0.3.0 is actually installed |
| R-4 | Automated accessibility checks complement, never replace, keyboard and screen-reader checks | C-7: axe in the E2E, **and** `docs/ACCESSIBILITY_CHECKLIST.md` (keyboard-only walkthrough; screen-reader walkthrough with NVDA or VoiceOver) completed by a person for the release candidate; both are part of the RC acceptance |
| R-5 | Preserve all existing M1–M3 guarantees and tests | No existing test is removed or weakened; `test/privacy.test.ts` stays as strict or stricter; every M5 PR runs `check` and `e2e` |

## Release-candidate acceptance (before any tag or public release)

1. All M5 changes merged; CI green on `main`.
2. The owner installs the **exact CI ZIP artifact** and passes: P-L1/P-L2 (delays of 5 s and 20 s), S1–S2, M3-L3, and the accessibility checklist (R-4).
3. The owner explicitly approves the release candidate. Only then: tag `v0.3.0` and publish the GitHub Release with that ZIP.
