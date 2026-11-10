# Privacy

ChatGPT Autopilot has **no server, no analytics and no telemetry**. It sends
nothing to any server, including its developer. Everything it keeps stays in
your browser on this computer. This page lists exactly what it reads, what it
keeps, where, for how long, and how to delete it. Each claim names the code
that implements it.

*Version 0.3.0. If anything here does not match the code, the code is wrong
or this page is: please report it.*

## What it reads on the ChatGPT page

| What | When | Kept? | Code |
|---|---|---|---|
| Page structure: whether the message box, Send and Stop buttons exist; how many messages there are and their ids; turn and streaming markers; the interface language from the page's `lang` attribute (a language tag such as `en-US`; the validator rejects anything else) | Continuously while a ChatGPT tab is open | Only as counts, booleans and ids inside the current observation (see "Identifiers" below) | `src/content/page.ts` |
| **Message-box text** | Before typing the prompt and while sending | **No.** Only compared ("is the box empty?", "does it hold exactly the prompt?") and discarded | `src/content/composer.ts`, `page.ts` (`hasText`) |
| **Notice text** (alerts, errors, usage-limit banners outside the conversation, up to 600 characters) | While observing | **No.** Matched against fixed patterns and discarded; only "matched / not matched" is kept | `src/content/page.ts` (`noticeMatches`, `unrecognizedNotice`) |
| **Answer text** of the latest finished answer: only its visible answer content, outside code and quotes | **Only if you turn on *Stop on status marker*** (off by default) | **No.** Read temporarily to compare its last line with three fixed lines; only the result (`none`, `continue`, `complete`, `blocked`, `unclear`) leaves that comparison | `src/content/statusMarker.ts`; enforced by `test/privacy.test.ts`, `test/statusMarker.test.ts`, `test/markerFlow.test.ts` |
| Other conversation text (your messages, older answers) | **Never** | — | `test/privacy.test.ts` lists every place that reads page text |

The panel also shows the **title of the ChatGPT tab** (which is the
conversation's title), read from the browser's tab information when the panel
is open. It is displayed only, never stored. Code: `src/background/index.ts`
(`info`), `src/ui/viewModel.ts`.

## What it keeps, where, and for how long

| Item | Contains | Where | Retention | Deleted when |
|---|---|---|---|---|
| **Settings** (`autopilot.settings.v2`) | `prompt` (**your continuation prompt, as text**), `delaySeconds`, `confirmSeconds`, `maxCycles`, `notifications`, `stopOnMarker`, `schemaVersion` | `chrome.storage.local` (this browser profile, this computer) | Until you change them | *Reset to defaults* resets them; uninstalling removes them |
| **Session state** (`autopilot.session.v2`): `run`, `phase`, `reason`, `detail`, `cycles`, `generationSeen`, `dueAt`, `submitStartedAt`, `lastStatus`, `lastContinuationAt`, `awaitingResponseSince`, `startedAt`, `updatedAt`, `tabId`, `schemaVersion` | Run state, counters, times, the browser's tab number | `chrome.storage.local` | Overwritten by each new session | Uninstalling removes it |
| **Identifiers** in the session: `conversation` (the conversation's path, `/c/<conversation id>`), `pendingKey`, `markerKey`, `markerAcknowledgedKey` and `answeredKeys` (each `/c/<conversation id>\|id:<message id>`, or `\|n:<count>`) | **ChatGPT conversation ids and message ids. No message text** | `chrome.storage.local` | `answeredKeys`: the **last 200** responses, **kept across sessions** (so an answered response is never answered again); the others: until the next session | Uninstalling removes them (Stop and Start do not) |
| **Activity log** (`log` in the session) | Up to the **last 40** entries: time plus a message written by the extension (e.g. "Continuation 2 sent.", "Paused: ChatGPT's status line says it is blocked."). Never page text or ids | `chrome.storage.local` | Kept across sessions, last 40 | Uninstalling removes it |
| Getting started card (`autopilot.gettingStarted`) | `'show'` after a fresh install, `'dismissed'` after *Don't show again* | `chrome.storage.local` | Until uninstalled | Uninstalling removes it (*Reset to defaults* does not change it) |
| Browser-session marker (`autopilot.browserSession`) | `true` | `chrome.storage.session` (memory, cleared when the browser closes) | Until the browser closes | Automatically |
| Diagnostics switch (`chatgpt-autopilot:debug`) | `'1'`, **only if you set it yourself** in the ChatGPT tab's console | ChatGPT's own `localStorage` (chatgpt.com) | Until you remove it | `localStorage.removeItem('chatgpt-autopilot:debug')` in that tab |
| Last send-step record | Structure only: selector match counts, attributes, lengths and flags (no text) | Memory of the ChatGPT tab | Until the tab is closed or reloaded | Automatically |
| **Answer content, message-box text, notice text** | — | **Not stored anywhere** | — | — |

Code: `src/shared/storage.ts` (keys, including `autopilot.gettingStarted`), `src/shared/settings.ts`,
`src/shared/session.ts` (`MAX_ANSWERED_KEYS = 200`, `MAX_LOG_ENTRIES = 40`),
`src/background/index.ts` (`autopilot.browserSession`),
`src/content/diagnostics.ts` (`chatgpt-autopilot:debug`),
`src/content/index.ts` (the last send-step record).

## What leaves the extension

- **Nothing is sent over the network** by the extension. It has no backend
  and no external service.
- **Inside the browser:** the ChatGPT tab sends the background worker
  observations (status, counts, booleans, ids, the status-marker result),
  never text. The validator rejects anything else (`src/shared/messages.ts`).
- **Notifications** (optional, setting *Notifications*): fixed texts written
  by the extension, e.g. "Autopilot stopped by an error" with "ChatGPT shows a usage limit."
- **Diagnostic report** (only when you click *Copy diagnostic report*): copied
  to your clipboard for you to share. It contains settings (the prompt only as
  its length), session state, the activity log and page signals. Conversation
  ids, message ids and tab titles appear only as kinds ("saved", "id") and
  counts. Code: `src/shared/report.ts`, `test/report.test.ts`.
- **Console diagnostics** (only with the switch above): structure only, in
  the tab's own developer console.

## Permissions

| Permission | Why |
|---|---|
| `https://chatgpt.com/*` | Observe the page and type and send the continuation in your ChatGPT tab |
| `https://chat.openai.com/*` | The older ChatGPT address. Kept until it is confirmed that it only redirects to chatgpt.com (decision D-7) |
| `storage` | Settings and session state (table above) |
| `alarms` | A fallback wake-up for the end of the delay if Chrome stops the background worker |
| `notifications` | Required by the manifest. Whether notifications are *shown* is your choice (setting *Notifications*) |
| `sidePanel` | The side panel view |

The extension does not request `tabs`, `scripting`, `cookies`, `history`,
`webRequest` or any other host.

## Deleting everything

Remove the extension in `chrome://extensions`: Chrome deletes its
`chrome.storage.local` and `chrome.storage.session` data. If you set the
diagnostics switch, also run
`localStorage.removeItem('chatgpt-autopilot:debug')` in a ChatGPT tab.
*Reset to defaults* resets only the settings, not the session, log,
identifiers or the Getting started choice.
