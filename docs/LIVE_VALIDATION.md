# Live ChatGPT validation procedure

The automated tests run against a fake page. This procedure checks the
extension against the real ChatGPT site. It must be run by a person with a
ChatGPT account; a cloud development session cannot do it. Record each run in
`AUTOPILOT.md` (section 11) with the date, browser version, ChatGPT UI language
and the result of every step as PASS, FAIL or NOT RUN.

Use a throwaway conversation that is **not** connected to a real repository, and
set **Maximum cycles** to 2 so a fault cannot run away.

## Setup

1. `npm ci && npm run build`, load `dist/` unpacked (see README), reload ChatGPT tabs.
2. Open a new ChatGPT conversation and send a short first message yourself, so
   the URL becomes `/c/<id>`.
3. Open DevTools on that tab and turn on detection diagnostics:

   ```js
   localStorage.setItem('chatgpt-autopilot:debug', '1')
   ```

   Each change in what the extension detects is now logged as
   `[ChatGPT Autopilot] Page detection`. It contains status, response key,
   counts, booleans and a fixed list of attribute values (button `aria-label`
   and `data-testid`, turn/streaming markers). It never contains message or
   composer text. Nothing leaves the tab.

## Detection (no sending)

| # | Do | Expect in the diagnostic log |
|---|---|---|
| D1 | Idle conversation with one finished answer | `status: "complete"`, `composerFound: true`, `assistantMessageCount` equals the visible answers (not double), `responseKey` ends in `id:<…>` |
| D2 | Send a long question yourself and watch it stream | `status: "generating"` for the whole stream (`stopControlFound` or `streamingMarkerFound` true), then `complete` once it ends |
| D3 | Compare `userMessageCount` before and after D2 | Increases by exactly 1 |
| D4 | Type a draft into the box, do not send | `composerHasText: true` |
| D5 | Regenerate the last answer | `generating`, then `complete`; note whether `responseKey` changed |
| D6 | Switch to another conversation in the sidebar | `responseKey` path changes to the new `/c/<id>` |

If any row fails, save the logged diagnostic (it is text-free) and update
`src/content/selectors.ts`; add a unit test in `test/page.test.ts` that
reproduces the observed markup.

## Sending (Maximum cycles = 2)

| # | Do | Expect |
|---|---|---|
| S1 | Start Autopilot after an answer finished | After the delays, exactly one continuation is sent; Activity shows it confirmed |
| S2 | Let it run | It stops at 2 continuations; never two messages for one answer |
| S3 | Start again, type into the box during the countdown | Paused; your text untouched and not sent |
| S4 | Start again, switch conversation during the countdown | Paused; nothing sent in either conversation |
| S5 | Start, then move the tab behind another tab in the same window | Continuation still sent to the session's tab (record if it fails) |
| S6 | Start, then minimise the window or switch to another window | Record exactly what happens (hidden-tab behaviour is not yet established) |

Turn diagnostics off afterwards:

```js
localStorage.removeItem('chatgpt-autopilot:debug')
```

## When a continuation cannot be sent ("the send button did not become available")

Capture two things from the same ChatGPT tab and paste both into an issue or
the AUTOPILOT.md history. Neither contains message text, the prompt, the
message-box text or any button text.

**A. The extension's own record of the failing attempt**

1. In the ChatGPT tab's DevTools console:
   `localStorage.setItem('chatgpt-autopilot:debug', '1')`, then reload the tab.
2. Start Autopilot and let it fail as before.
3. In the console, filter for `Send step`. You should see `typed`,
   `waiting_for_send_button` (once per change) and `send_button_unavailable`.
4. Right-click the `send_button_unavailable` entry's object → **Copy object**
   (and the `typed` one).

**B. A baseline: what Send looks like when you type yourself**

1. Click into the empty message box and type a single word by hand. Do not send it.
2. Paste the contents of [`docs/send-probe.js`](send-probe.js) into the console
   and press Enter. Copy the JSON it returns.
3. Delete your word again.

How to read them:

| A shows | B shows | Meaning |
|---|---|---|
| `sendSelectors` all empty; `nearbyButtons` has no send-like button | a button that no `sendSelectors` entry matches | Selectors are outdated: B's attributes give the new selector |
| `chosen.usable: false` (or only a voice/dictation button), `composer.holdsPrompt: true` | a usable button matched by a selector | ChatGPT did not register the inserted text (editor state); see `insertion` and `hiddenTextarea` |
| `chosen` is a hidden or different button while another match is usable | — | The first-visible-match rule picks the wrong button |
| a usable button only late (`elapsedMs` > 3000) | — | The 3 s wait is too short |

### Adding a language

If B shows a send (or stop) button whose only identifying attribute is a
localized `aria-label`, add that label, copied exactly, to `LOCALIZED_LABELS`
in `src/content/selectors.ts` under the UI language (`uiLanguage` in B), with
where it was observed as `source`. Add the same selector to the `SEND` list in
`docs/send-probe.js` (a unit test checks they match) and a test in
`test/localizedSend.test.ts` built from the observed structure. Never add a
translation that was not observed, and never a generic selector such as
`button[type="submit"]`.

## Recorded runs

Only what the owner observed and reported is recorded here. A row not listed
was not run.

### Run 1 — 2026-11-04, es-ES — FAIL (fixed in #12)

- Interface: ChatGPT web, Spanish (`es-ES`). Build: `main` before #12.
- Result: detection worked; the prompt was inserted, then the run stopped with
  "The continuation could not be sent: the send button did not become available."
- Activity log as reported:

  ```
  13:14:02 ChatGPT is generating a response.
  13:14:09 Response complete. Continuation 1 in 10s.
  13:14:19 Sending continuation 1.
  13:14:23 Error: The continuation could not be sent (the send button did not become available).
  ```
- Diagnostics (A) as reported: `holdsPrompt: true`, `proseMirror: true`,
  `execCommandReturned: true`; all four send selectors matched nothing. The
  page's send control: `<button aria-label="Enviar" type="submit">`.
- Root cause: no selector for the Spanish label. Fixed in #12 (`LOCALIZED_LABELS`).

### Run 2 — reported 2026-11-05, es-ES — PASS

- Interface: ChatGPT web, Spanish (`es-ES`). Build: `main` after #12 (the
  exact commit was not stated). Maximum cycles: 3.
- Reported results:

  | Row | Result |
  |---|---|
  | D2 (completion detection) | PASS — each finished response was detected as complete |
  | S1 (one continuation per finished response) | PASS — three continuations were submitted, each confirmed as sent; ChatGPT answered each |
  | S2 (cycle limit) | PASS — stopped exactly at the maximum (3) |
  | D1, D3–D6, S3–S6 | NOT RUN |
- Activity log: not captured verbatim in this record (not included in the report).
- Not established by this run: composer protection (S3), conversation
  switching (S4, D6), background/hidden tabs (S5, S6), regenerated answers
  (D5), usage-limit/login/error notices, and any interface language other than
  Spanish.

## Not covered here

Usage-limit and login notices cannot be produced on demand; record them when
they happen naturally, with the diagnostic log line.
