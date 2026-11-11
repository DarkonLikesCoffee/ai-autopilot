# Development

How to build, test and change ChatGPT Autopilot. The user guide is the
[README](../README.md); project state and rules are in `AUTOPILOT.md`,
`docs/ROADMAP.md` and `CLAUDE.md`.

## Build and load

```bash
npm ci
npm run build       # bundles into dist/ (with source maps)
```

In `chrome://extensions`: Developer mode → **Load unpacked** → `dist/`. After a
rebuild, press the reload icon on the extension and reload ChatGPT tabs.
`node build.mjs --watch` rebuilds on change.

## Checks

```bash
npm run typecheck   # strict TypeScript
npm test            # unit tests (node --test on the .ts files)
npm run check       # typecheck + test + build
npm run e2e         # real Chromium (Playwright, pinned) against a fake ChatGPT page
npm run package     # release ZIP in release/ (see docs/RELEASING.md)
```

`EXTENSION_DIR=<folder> npm run e2e` runs the E2E on another build, for
example the unzipped release ZIP (CI does this).

The E2E also runs axe-core (pinned dev dependency) on the panel in the light
and dark themes. It complements, never replaces, the manual
[accessibility checklist](ACCESSIBILITY_CHECKLIST.md).

Unit tests run TypeScript directly through Node's type stripping
(`erasableSyntaxOnly`): no parameter properties, enums or `<T>` casts.

## Architecture (`src/`)

- `content/` runs on ChatGPT.
  - `selectors.ts` holds every assumption about ChatGPT's page, including
    localized button labels.
  - `page.ts` turns the page into a text-free observation (status, response
    key, structure signals).
  - `detector.ts` coalesces DOM changes and applies the completion
    confirmation delay.
  - `composer.ts` checks, types, sends and confirms the continuation, and
    removes it again only if the box holds exactly it.
  - `statusMarker.ts` is the opt-in status-line comparison (M3); it keeps no
    state.
  - `diagnostics.ts` and `sendDiagnostics.ts` are the opt-in, text-free
    detection and send-step logs; `index.ts` wires it all to the extension.
- `shared/session.ts` is the continuation state machine (pure functions):
  phases *watching → delay → submitting* inside *running / paused / error /
  stopped*. `guidance.ts` maps every halt reason to what the user should do.
  `messages.ts` defines and validates every message. `report.ts` builds the
  text-free diagnostic report. `settings.ts` and `storage.ts` hold the
  settings and persistence.
- `background/controller.ts` applies events one at a time from persisted
  state, saves state before acting, checks the live page and asks the tab to
  send. `background/index.ts` wires the Chrome APIs (messages, alarms,
  notifications, badge, install and browser-restart detection).
- `ui/` is the control panel. `viewModel.ts` and `settingsForm.ts` are pure and
  tested; `app.ts` renders them.

## Tests

- `test/controller.test.ts` runs the whole workflow (the real state machine,
  controller and storage with a fake tab and clock), including every safeguard
  in the README.
- `test/privacy.test.ts` scans `src/content` for every place that reads page
  text; `test/privacyDoc.test.ts` checks PRIVACY.md against the manifest,
  storage keys, stored fields and retention bounds.
- `test/copy.test.ts` keeps user-visible texts free of internal codes;
  `test/docs.test.ts` keeps the README's troubleshooting table identical to
  the panel's texts.
- `test/liveStructure.test.ts` uses a captured live page structure
  (`test/fixtures/liveStructure.ts`).
- `e2e/extension.e2e.mjs` loads the built extension in Chromium against a
  local fake ChatGPT page and drives the real panel.

The fake page is not the live site. Live checks are manual:
[LIVE_VALIDATION.md](LIVE_VALIDATION.md).

## Changing selectors or adding a language

Change `src/content/selectors.ts` only from a live observation, never a guess:

- `docs/answer-structure-probe.js`, run in a ChatGPT tab, reports the answer
  structure (no text);
- `docs/send-probe.js` captures the send controls of a hand-typed message;
- `localStorage.setItem('chatgpt-autopilot:debug', '1')` in the ChatGPT tab
  turns on the text-free detection and send-step console logs (remove it with
  `localStorage.removeItem('chatgpt-autopilot:debug')`).

"Adding a language" in [LIVE_VALIDATION.md](LIVE_VALIDATION.md) has the steps.
Add a test with the captured structure for every selector change.

## Documents

| File | What |
|---|---|
| `AUTOPILOT.md` | Current state, history, next action (this repository's own) |
| `docs/ROADMAP.md` | Milestones |
| `docs/design/` | Design decisions per milestone (M3 stop protocol, M5 release quality, M5 copy review) |
| `docs/LIVE_VALIDATION.md` | Manual live checks and recorded runs |
| `docs/ACCESSIBILITY_CHECKLIST.md` | Manual keyboard, screen-reader and visual checks |
| `docs/RELEASING.md` | Packaging, testing the artifact, publishing (owner only) |
| `docs/releases/` | Release notes per version |
| `PRIVACY.md` | What is read and kept, with code references |
| `CHANGELOG.md` | Changes per version |
| `templates/AUTOPILOT.md` | Template for a user's project file |
