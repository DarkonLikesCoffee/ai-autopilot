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

## Not covered here

Usage-limit and login notices cannot be produced on demand; record them when
they happen naturally, with the diagnostic log line.
