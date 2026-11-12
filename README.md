# ChatGPT Autopilot (Chrome extension)

A lightweight Chrome extension (Manifest V3) that keeps ChatGPT working on a
project: **each time ChatGPT finishes an answer, it waits a moment and then
sends the same continuation prompt**, until you pause or stop it.

It is a continuation trigger, not an agent. It does not decide what to work on,
does not read your repository, and does not judge ChatGPT's work. Your
repository's `AUTOPILOT.md` (read and updated by ChatGPT through its connected
GitHub tools) is the source of truth for what happens next.

**Contents:** [Install](#install) · [First use](#first-use) ·
[The control panel](#the-control-panel) · [Safeguards](#safeguards) ·
[Stop on status marker](#stop-on-status-marker-optional) ·
[Your project's AUTOPILOT.md](#your-projects-autopilotmd) ·
[Privacy](#privacy) · [Troubleshooting](#troubleshooting) ·
[Known limitations](#known-limitations) · [Licence](#licence)

## Install

Requires Chrome 116 or newer (or another Chromium browser with Manifest V3).

1. Download `chatgpt-autopilot-<version>.zip` from the
   [Releases page](https://github.com/DarkonLikesCoffee/ai-autopilot/releases)
   and unzip it into a folder you keep (Chrome loads the extension from it).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose that folder.
4. Reload any ChatGPT tabs that were already open, so Autopilot can connect to
   them. If you forget, the panel says so and Start stays unavailable until you
   do.
5. Pin the extension. Use the popup, or open the side panel (right-click the
   icon → *Open side panel*) to watch the countdown while you work.

To update, unzip the new version over the same folder (or into a new one) and
press the reload icon on the extension in `chrome://extensions`; then reload
your ChatGPT tabs. Building from source: see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## First use

1. Open a ChatGPT conversation that is connected to your GitHub repository.
2. Press **Start Autopilot** in the popup or side panel.
3. Send your first project prompt yourself (or start while ChatGPT is already
   answering).
4. When ChatGPT finishes, Autopilot confirms the answer is really finished,
   waits the configured delay, types the continuation prompt into the message
   box, checks the text, clicks **Send**, and confirms on the page that it was
   sent.
5. ChatGPT continues working; Autopilot waits for the next answer and repeats,
   with no action from you, until you **Pause** or **Stop**, the maximum
   number of continuations is sent, or a safeguard stops it.

After a fresh install the panel shows a short **Getting started** card with
these steps until you choose *Don't show again*.

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

The same prompt is sent every time; nothing is generated.

## The control panel

- **Status:** Running, Waiting for ChatGPT, Continuation in … (with the
  countdown), Paused, Stopped or Stopped by an error. When it is not running:
  the reason and what to do, labelled *Resume when ready*, *Fix first* or
  *Finished* (see [Troubleshooting](#troubleshooting)).
- **Controls:** Start Autopilot, Pause / Resume, Stop.
- **Session:** the conversation, continuations sent (of the maximum, or ∞),
  ChatGPT's state, the time to the next continuation, the last continuation,
  the last error, and a **Page** line: what Autopilot recognizes on the ChatGPT
  page (message box, Send or Stop button, number of answers, interface
  language), or "not fully recognized" with what is missing.
- **Settings:**
  - continuation prompt;
  - delay before sending (1–3600 s);
  - completion confirmation delay (1–120 s): how long a finished answer must
    stay finished before it counts;
  - maximum cycles, or **Unlimited** (no limit set by the extension; ChatGPT's
    own usage limits always apply);
  - notifications;
  - *Stop on status marker* (off by default, see below).

  An invalid value is marked next to its field and nothing is saved.
  *Unsaved changes* shows until you save. *Reset to defaults* asks first,
  because it also replaces your continuation prompt. Saved changes apply right
  away: a new prompt from the next continuation, a new delay from the next
  countdown (a countdown already running is not changed).
- **Activity:** a short log of what Autopilot did and why, and **Copy
  diagnostic report**: technical state only, for an issue report. It contains
  no prompt, conversation, message or notice text, nor conversation ids or
  titles.

The panel works with the keyboard and screen readers: status changes are
announced, and focus moves to the control that replaces the one you pressed.

## Safeguards

Autopilot sends at most one continuation per finished answer and prefers to
stop over guessing:

| Situation | What happens |
|---|---|
| An answer is still streaming, or streaming pauses briefly | Nothing; an answer only counts as finished after it stays finished for the completion confirmation delay |
| The same answer is shown again (re-renders, navigating back, an already-finished page) | Nothing; each answer is continued at most once, and only after ChatGPT was seen answering |
| ChatGPT starts answering during the delay (for example you sent something) | The pending continuation is cancelled |
| The finished answer changes on the page during the delay, without a new answer | The one pending continuation moves to it, with a fresh delay; an answer already continued is never targeted |
| The message box contains text (you are typing) | Paused; your text is never touched |
| You type, switch conversation, or ChatGPT starts answering while the continuation waits for the Send button | Send is not clicked; the continuation is removed only if the box holds exactly it; your text stays |
| The tab switches to another conversation | Paused; nothing is sent anywhere else |
| Usage limit, login prompt or an error notice | Stopped by an error; never retried automatically |
| A notice Autopilot does not recognize (for example in another language) | Paused; nothing sent |
| ChatGPT does not start answering a continuation within 60 s | Paused; nothing more sent |
| ChatGPT stops without a new answer | Paused; nothing sent |
| The continuation cannot be typed, Send is not available, or the click does not send | Stopped by an error; the continuation is removed from the box; not retried |
| It cannot be confirmed whether the continuation was sent | Paused; that answer is never continued again |
| The tab is closed, or the browser or Autopilot restarts | Paused; resume when the conversation is open again |
| Chrome stops the background worker during the delay | The delay is picked up again; no duplicate |
| The maximum number of continuations is sent | Stopped |
| Pause or Stop | Nothing more is sent |

Before every send, the background and then the page itself check the live
page again: same conversation, same latest answer, finished, not answering,
empty message box, no usage limit. The answer is recorded as continued
*before* the send is attempted, so a crash or restart can never send it twice.
Autopilot only uses the normal ChatGPT interface (typing and the Send button):
no undocumented APIs, no session tokens, no rate-limit workarounds.

## Stop on status marker (optional)

Off by default (Settings → **Stop on status marker**). When on, Autopilot looks
at the **last non-empty line** of ChatGPT's latest finished answer, outside
code blocks and quotes, and acts only on these exact lines:

| Last line of the answer | What Autopilot does |
|---|---|
| `AUTOPILOT STATUS: MILESTONE COMPLETE` | Stops (*Finished*) |
| `AUTOPILOT STATUS: BLOCKED` | Pauses (*Fix first*) |
| `AUTOPILOT STATUS: CONTINUE`, or no status line | Continues as usual |
| A malformed or ambiguous status line (other wording, a period, two status lines, one that is not last) | Pauses (*Fix first*) |

- Only the visible answer content is read: hidden, collapsed and interface
  elements, code, quotes and tool output are skipped. If the answer content
  cannot be isolated, the result is "unclear" and Autopilot pauses; nothing is
  guessed.
- After a BLOCKED or unclear pause, **Resume** is your override for that one
  answer: the continuation is sent to it once, and later answers are checked
  again. Sending ChatGPT a message yourself does not resume Autopilot; press
  Resume afterwards.
- A status line is ChatGPT's own report, not proof that the work is correct.
- The answer text is read only for this comparison and never stored, sent or
  logged ([PRIVACY.md](PRIVACY.md)).

## Your project's AUTOPILOT.md

[`templates/AUTOPILOT.md`](templates/AUTOPILOT.md) is a starting point for the
file in your repository. It defines the objectives, current milestone,
definition of done, rules, architecture constraints, prioritized tasks, known
bugs, verification commands, completed work with evidence, decisions, blockers
and the next recommended action, and labels claims as verified or assumed. Its
*Continuation protocol* tells ChatGPT to verify the repository state at the
start of each continuation, update the file after meaningful progress, and,
once the milestone is done or it is blocked, say so plainly (and end with the
matching status line) instead of inventing work. The extension never reads or
edits this file.

## Privacy

**Full details: [PRIVACY.md](PRIVACY.md)**: what is read, what is kept, where,
for how long, and how to delete it, with the code for each claim.

- **No server, no analytics, no telemetry.** Nothing is sent over the network.
- **Read on the ChatGPT page:** page structure (buttons, message counts and
  ids, turn markers, the interface language), whether the message box is
  empty or holds exactly the continuation, and short notice texts (matched
  against fixed patterns, then discarded). The answer text is read **only**
  with the opt-in *Stop on status marker*, temporarily, for an exact
  comparison.
- **Kept in `chrome.storage.local` (this computer):** your settings, including
  your continuation prompt; the session state; the last 200 continued answers
  as **ChatGPT conversation and message ids** (no text), so an answer is never
  continued twice; the last 40 activity-log lines (written by the extension);
  whether you dismissed Getting started. Uninstalling removes all of it.
- **Permissions:** `chatgpt.com`, `storage`,
  `alarms` (a fallback timer), `notifications` (required by the manifest;
  whether notifications are shown is your setting), `sidePanel`.

## Troubleshooting

**When Autopilot stops or pauses**, the panel shows the reason and what to do.
Every case:

| The panel says | Label | What to do |
|---|---|---|
| Paused by you. | Resume when ready | Press Resume to continue. |
| The maximum number of continuations was sent. | Finished | To continue, raise Maximum cycles in Settings and start again. |
| ChatGPT shows a usage limit. | Fix first | Wait until the limit is lifted, then press Resume. Autopilot never retries on its own. |
| ChatGPT asks you to log in. | Fix first | Log in in the ChatGPT tab, open the conversation, then press Resume. |
| ChatGPT shows an error. | Fix first | Check the ChatGPT tab and reload it if needed, then press Resume. |
| The ChatGPT tab now shows a different conversation. | Fix first | Go back to the original conversation and press Resume, or press Stop and start in the new one. |
| The ChatGPT tab was closed. | Fix first | Open the conversation again, then press Resume. |
| The browser or Autopilot restarted. | Fix first | Open the conversation again, then press Resume. |
| The message box already contained text. | Fix first | Send or clear your text, then press Resume. Your text was not changed. |
| The continuation could not be sent. | Fix first | Check the ChatGPT tab, then press Resume. If it happens again, copy the diagnostic report. |
| Autopilot could not confirm that the continuation was sent. | Fix first | Check the conversation: if the continuation is missing, send it yourself. Then press Resume; that answer is not continued again. |
| The ChatGPT tab did not respond. | Fix first | Reload the ChatGPT tab, then press Resume. |
| ChatGPT shows a notice that Autopilot does not recognize. Nothing was sent. | Fix first | Read the notice in the ChatGPT tab, then press Resume. If it is not in English, report its exact text. |
| ChatGPT did not start answering the continuation. | Fix first | Check the ChatGPT tab for a notice, then press Resume. |
| ChatGPT stopped without a new answer. | Fix first | Check the last answer (it may have ended with an error), then press Resume. |
| ChatGPT's status line says the milestone is complete. | Finished | Check the result yourself: the status line is ChatGPT's own report, not a verification. Start again for more work. |
| ChatGPT's status line says it is blocked. | Fix first | Read the last answer. Send ChatGPT what it needs yourself, then press Resume; or press Resume now to send the continuation to this answer once. Later answers are checked again. |
| The status line in ChatGPT's last answer is unclear. | Fix first | Its last line must be exactly one of the three status lines. Press Resume to send the continuation to this answer once. Later answers are checked again. |

A reason can be followed by a detail after a colon, for example "The
continuation could not be sent: the Send button was not available."

**Other problems:**

| Problem | What to do |
|---|---|
| Start is unavailable, with "Reload this ChatGPT tab so Autopilot can connect to it" | The tab was open before Autopilot was installed or updated. Reload it. |
| Start is unavailable, with "Open a ChatGPT conversation in this window" | Make the ChatGPT conversation the active tab of the window the panel belongs to. |
| The Page line says "not fully recognized" | ChatGPT's page changed in a way Autopilot does not know. Copy the diagnostic report (Activity) and open an issue; Autopilot will not send on a page it does not recognize. |
| Sending stops with "the Send button was not available" in another interface language | The Send button's label in that language is not known yet. See "Adding a language" in [docs/LIVE_VALIDATION.md](docs/LIVE_VALIDATION.md). |
| The continuation comes later than the delay | The countdown starts only after the answer has stayed finished for the completion confirmation delay, so the total wait is about the two delays added together. |
| No notifications | Turn on *Notifications* in Settings, and allow notifications for Chrome in your operating system. |

When asking for help, attach the diagnostic report (Activity → *Copy
diagnostic report*). It contains no conversation text.

## Known limitations

- ChatGPT's page changes over time. Autopilot is tested automatically against
  a fake page that mimics ChatGPT, and by hand on the live site
  ([docs/LIVE_VALIDATION.md](docs/LIVE_VALIDATION.md)). When the live page
  changes, detection or sending may stop working until the extension is
  updated; Autopilot then stops with an error rather than pretending to
  succeed.
- **Interface languages:** the Send and Stop buttons are recognized in English
  and Spanish (live-verified: Spanish, es-ES), and in any language where
  ChatGPT provides its language-independent attributes. Usage-limit, login and
  error notices are recognized by their English texts only; in other
  languages such a notice makes Autopilot pause instead of continuing. The
  panel itself is in English.
- The tab must stay open. It may be behind other tabs: Autopilot sends into the
  session's tab, never the active one. Whether typing and sending behave the
  same in a tab Chrome has throttled or frozen was not verified; if the
  continuation waited more than about 5 s for the Send button, Send is not
  clicked and Autopilot stops with an error. If Chrome discards the tab, the
  next send is refused and Autopilot stops with an error.
- Starting requires the conversation to be the active tab in the focused
  window.
- Automating the ChatGPT web interface may be subject to OpenAI's terms of
  use. You are responsible for how you use it; keep delays and cycle limits
  sensible.

## Licence

[MIT](LICENSE). Changes per version: [CHANGELOG.md](CHANGELOG.md).
Development, architecture and tests: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
