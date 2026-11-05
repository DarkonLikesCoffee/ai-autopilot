# ChatGPT Autopilot (Chrome extension)

A lightweight Chrome extension (Manifest V3) that keeps ChatGPT working on a
project: **each time ChatGPT finishes a response, it waits a moment and then
sends the same continuation prompt**, until you pause or stop it.

It is a continuation trigger, not an agent. It does not decide what to work on,
does not read your repository, and does not judge ChatGPT's work. The
repository's `AUTOPILOT.md` (read and updated by ChatGPT through its connected
GitHub tools) is the source of truth for what happens next.

## How it works

1. Open a ChatGPT conversation that is connected to your GitHub repository.
2. Click **Start Autopilot** in the extension's popup or side panel.
3. Send your first project prompt yourself (or start while ChatGPT is already
   answering).
4. When ChatGPT finishes, Autopilot confirms the response is really complete,
   waits the configured delay, then types the continuation prompt into the
   message box, checks the text, clicks **Send**, and confirms on the page that
   the message was sent.
5. ChatGPT continues working; Autopilot waits for the next response to finish
   and repeats, with no action from you, until you **Pause** or **Stop**, the
   maximum number of cycles is reached, or a safeguard stops it.

The default continuation prompt (editable in Settings):

> Continue working on the project.
>
> Read the repository's AUTOPILOT.md to understand the project's objectives,
> current state, instructions, rules, priorities, and remaining tasks.
>
> Review the current implementation and repository state. Determine the most
> appropriate next action and execute it.
>
> Work autonomously. Don't just analyze, suggest changes, or provide a plan:
> actually implement the necessary changes, run relevant tests and checks, fix
> any issues you discover, and commit your work when appropriate.
>
> Update AUTOPILOT.md to accurately reflect progress, completed tasks,
> discovered issues, decisions, and the next recommended action.
>
> Continue making meaningful progress. Only stop if the project milestone is
> complete, you're genuinely blocked, or human input is necessary.

The same prompt is sent every time; nothing is generated dynamically.

## Installation

```bash
npm ci
npm run build
```

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. Reload any ChatGPT tabs that were already open, so the extension can attach.
4. Pin the extension. Use the popup, or open the side panel (right-click the
   icon → *Open side panel*) to watch the countdown while you work.

Requires Chrome 116 or newer (or another Chromium browser with Manifest V3).

## The control panel

- **Status:** Running, Waiting for ChatGPT, Waiting before continuation, Paused,
  Stopped or Error, with the reason when it is not running.
- **Controls:** Start Autopilot, Pause / Resume, Stop.
- **Session:** current conversation, continuations sent (of the maximum, or ∞),
  ChatGPT's current state, time until the next continuation, the last
  continuation's time and the last error.
- **Settings:** continuation prompt, delay before sending, completion
  confirmation delay, maximum cycles (or **Unlimited**) and notifications.
- **Activity:** a short log of what Autopilot did and why.

**Unlimited** means no limit set by the extension. ChatGPT's own usage limits
always apply: when ChatGPT shows a usage-limit notice, Autopilot stops and
never retries on its own.

## Safeguards

Autopilot sends at most one continuation per finished response and prefers to
stop over guessing:

| Situation | What happens |
|---|---|
| A response is still streaming, or streaming pauses briefly between chunks | Nothing; a response only counts as finished after the page stays finished for the completion confirmation delay |
| The same response is reported again (re-renders, navigation back, an already-finished page) | Nothing; a completion only counts after a new generation was seen, and each response is answered at most once |
| ChatGPT starts generating during the delay (for example you sent something) | The pending continuation is cancelled |
| The finished response is updated on the page during the delay (a new message id, a re-render) without a new generation | The one pending continuation moves to the updated response, with a fresh delay; an already answered response is never targeted |
| The message box contains text (you are typing) | Paused; your text is never touched |
| You type, switch conversation, or ChatGPT starts generating while the prompt waits for the Send button | Send is not clicked; the prompt is removed only if the box holds exactly the prompt; your text stays |
| The tab switches to another conversation | Paused; nothing is sent anywhere else |
| Usage limit, login prompt or an error notice | Stopped with an error; never retried automatically |
| A notice Autopilot does not recognize (for example in a language without known notice texts) | Paused; nothing sent; never taken for a finished answer |
| A continuation was sent but ChatGPT does not start answering within 60 s | Paused; nothing more sent |
| ChatGPT generated, but no new answer is visible afterwards | Paused; nothing sent |
| The prompt cannot be typed, Send never becomes available, or the click does not send | Error; the prompt is removed from the box again; not retried |
| It cannot be confirmed whether the prompt was sent | Paused; that response is never answered again |
| The tab is closed, or the browser/extension restarts | Paused; resume when the conversation is open again |
| Chrome stops the background worker during the delay | The delay is picked up again (alarm + page timer); no duplicate |
| Maximum cycles reached | Stopped |
| Pause or Stop | Nothing more is sent |

Before every send, the background and then the page itself re-check, on the
live page: same conversation, the same latest response, finished, not
generating, empty message box, no usage limit. The response is recorded as
answered *before* the send is attempted, so a crash or restart can never send it
twice. It only uses the normal ChatGPT interface (typing and the Send button): no
undocumented APIs, no session tokens, no rate-limit workarounds.

## Permissions and privacy

| Permission | Why |
|---|---|
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | Observe the page state and send the continuation in your ChatGPT tab |
| `storage` | Settings and session state, on this computer only |
| `alarms` | Wake up when the delay ends, even if Chrome paused the background worker |
| `notifications` | Tell you when Autopilot pauses or stops (optional) |
| `sidePanel` | The side panel view |

The extension does not access GitHub, cookies or any other site, has no backend
and no external AI service, and stores no credentials. It never reads, stores or
sends the text of your conversation: it reads page structure (buttons, message
counts and ids, notices) and whether the message box is empty.

## AUTOPILOT.md

`templates/AUTOPILOT.md` is a starting point for the file in your repository. It
defines the objectives, current milestone, definition of done, rules,
architecture constraints, prioritized tasks, known bugs, verification commands,
completed work with evidence, decisions, blockers and the next recommended
action, and labels claims as verified or assumed. Its *Continuation protocol*
tells ChatGPT to verify the repository state at the start of each continuation,
update the file after meaningful progress, and, once the milestone is done or it
is blocked, say so plainly instead of inventing work while Autopilot keeps
prompting. The extension never reads or edits this file.

## Development

```bash
npm run typecheck   # strict TypeScript
npm test            # unit tests (node --test)
npm run build       # bundles into dist/
npm run check       # all three
npm run e2e         # real-browser test (Playwright + Chromium; also runs in CI)
```

Architecture (`src/`):

- `content/` — runs on ChatGPT. `selectors.ts` holds every assumption about
  ChatGPT's page; `page.ts` turns the page into a text-free observation;
  `detector.ts` coalesces DOM changes and applies the completion confirmation
  delay; `composer.ts` types, verifies, sends and confirms the continuation;
  `diagnostics.ts` and `sendDiagnostics.ts` are the opt-in, text-free detection and send-step logs; `index.ts` wires
  it to the extension.
- `shared/session.ts` — the continuation state machine (pure functions): phases
  *watching → delay → submitting* inside *running / paused / error / stopped*.
- `background/controller.ts` — applies events one at a time from persisted state,
  saves state before acting, checks the live page, and asks the tab to send;
  `background/index.ts` wires Chrome APIs (messages, alarms, notifications,
  badge, browser-restart detection).
- `ui/` — the control panel (`viewModel.ts` is pure and tested).

Tests: `test/controller.test.ts` runs the whole workflow (the real state machine,
controller and storage with a fake tab and clock), including all safeguards
above. `e2e/extension.e2e.mjs` loads the built extension in Chromium against a
local fake ChatGPT page and drives the real panel.

## Known limitations

- **Not verified against the live ChatGPT site** in this repository's automated
  tests: those use a fake page that mimics ChatGPT's structure. ChatGPT's page
  changes over time; if detection or sending stops working, update
  `src/content/selectors.ts`. Autopilot stops with an error rather than
  pretending to succeed. `docs/LIVE_VALIDATION.md` is the manual procedure
  for checking the real site, using opt-in, text-free detection diagnostics
  (`localStorage.setItem('chatgpt-autopilot:debug', '1')` in the ChatGPT tab).
  The same switch logs each stage of the send step ("Send step" in the
  console); `docs/send-probe.js` captures a hand-typed baseline to compare.
- Some ChatGPT interface languages identify the Send and Stop buttons only by
  a translated label. Recognized: English and Spanish (`Enviar`, `Detener`,
  observed on es-ES). Live-verified: Spanish (es-ES) only. Usage-limit, login
  and error notices are recognized by their English texts only. On other
  interface languages such a notice makes Autopilot pause ("a notice Autopilot
  does not recognize") instead of continuing. Other languages work when ChatGPT provides its
  language-independent `data-testid`/`id`; otherwise sending stops with "the
  send button did not become available" until the label is added
  (`docs/LIVE_VALIDATION.md` → "Adding a language").
- The tab must stay open. It may be behind other tabs: Autopilot sends into the
  session's tab, never the active one (tested). Whether typing and sending behave
  the same in a truly hidden tab, where Chrome throttles timers, was not
  verified (headless test browsers report every tab as visible, and freezing a
  page through DevTools did not stop its timers). The send step measures its
  waits in wall-clock time, so a throttled or frozen tab cannot stretch them:
  if the prompt waited more than about 5 s for the Send button, Send is not
  clicked, the prompt is removed and Autopilot stops with an error. If Chrome
  discards the tab, it cannot answer, so the next send is refused and Autopilot
  stops with an error.
- Starting requires the conversation to be the active tab in the focused window.
- Automating the ChatGPT web interface may be subject to OpenAI's terms of use.
  You are responsible for how you use it; keep delays and cycle limits sensible.
