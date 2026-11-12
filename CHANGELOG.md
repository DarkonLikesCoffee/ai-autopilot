# Changelog

Changes that users notice, per version. Versions 0.1.0 and 0.2.0 existed only
during development and were never released.

## 0.3.0 — release candidate (not yet released)

The first public release. Install it from the release ZIP
([README](README.md#install)).

### Continuing a conversation

- Each time ChatGPT finishes an answer, Autopilot waits the delay and sends
  your continuation prompt, until you pause or stop it, the maximum number of
  continuations is sent, or a safeguard stops it.
- An answer only counts as finished after it stays finished for the
  completion confirmation delay, and only after ChatGPT was seen answering.
- Each answer is continued at most once, even after re-renders, a worker or
  browser restart, or a failed send; the answer is recorded before the send.
- Before every send the live page is checked again: same conversation, same
  answer, finished, empty message box, no notice.
- Your text in the message box is never overwritten; Autopilot pauses
  instead.
- Autopilot never continues in a different conversation, never retries after
  a usage limit, login prompt or error, and pauses on any notice it does not
  recognize.
- The delay keeps working if Chrome stops the background worker, and when the
  tab is behind other tabs.
- Recognizes ChatGPT's interface in English and Spanish (live-verified: Spanish,
  es-ES).

### Stop on status marker (optional, off by default)

- With the setting on, the last line of ChatGPT's latest answer can stop
  (`AUTOPILOT STATUS: MILESTONE COMPLETE`) or pause
  (`AUTOPILOT STATUS: BLOCKED`) Autopilot; anything unclear pauses.
- Only the visible answer content is read, outside code and quotes, and only
  for this comparison; the text is never stored, sent or logged.
- After such a pause, Resume sends the continuation to that answer once.

### The panel

- Status with the reason and what to do (*Resume when ready*, *Fix first*,
  *Finished*), a countdown, an activity log, and a text-free diagnostic
  report.
- A *Page* line shows what Autopilot recognizes on the ChatGPT page.
- *Getting started* after a fresh install; a hint when a ChatGPT tab must be
  reloaded before Start.
- Settings show each invalid value next to its field, show unsaved changes,
  and ask before *Reset to defaults* (which also resets the continuation
  prompt). The minimum delay is 1 second.
- Clear, consistent wording for every status, reason and message.
- Keyboard and screen-reader support: status changes are announced and focus
  follows the controls. Contrast is checked against WCAG 2.2 AA in light and
  dark mode (automated check and computed contrast; the manual check is part
  of the release candidate).

### Privacy

- No server, analytics or telemetry. [PRIVACY.md](PRIVACY.md) lists exactly
  what is read and kept, where, for how long, and how to delete it.
- Site access: `chatgpt.com` only. The older `chat.openai.com` is not
  requested, because it always redirects to `chatgpt.com`.

### Known limitations

See [README → Known limitations](README.md#known-limitations).
