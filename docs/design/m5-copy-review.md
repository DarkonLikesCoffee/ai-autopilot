# M5 C-5: copy review of every user-visible text

Status: **Proposed (2026-11-10), for the owner's review.** Nothing is applied
until the owner approves (or edits) this table. Applying it changes wording
only: no state, reason, guidance kind or behaviour changes.

## Terms (one per concept)

| Concept | Use | Avoid |
|---|---|---|
| What Autopilot sends after an answer | **continuation** | "prompt" when the sent message is meant, "message" |
| The text that is sent | **continuation prompt** (Settings only) | — |
| ChatGPT's reply | **answer** | "response" (stays in code and the diagnostic report only) |
| The input field | **message box** | "composer", "text area" |
| ChatGPT's buttons | **Send button**, **Stop button** | "send control" |
| `AUTOPILOT STATUS: …` | **status line** | "marker" (stays in code and the report) |
| The browser tab with the conversation | **the ChatGPT tab** | "page", "the session's tab" |

Style: a reason is one short sentence saying **what happened**; the guidance
line says **what to do**; internal terms and codes appear only in the
diagnostic report. Sentences end with a period; no "please".

## 1. Statuses and status details (`src/ui/viewModel.ts`)

| Where | Current | Proposed |
|---|---|---|
| Status | Stopped / Running / Waiting for ChatGPT / Waiting before continuation / Paused / Error | Stopped / **Sending** (was Running, shown only while sending) / Waiting for ChatGPT / **Continuation in …** (was Waiting before continuation; the countdown is shown next to it) / Paused / **Stopped by an error** (was Error) |
| Detail: waiting, ChatGPT working | ChatGPT is working. The continuation is sent after it finishes. | ChatGPT is answering. Autopilot sends the continuation after the answer is finished. |
| Detail: waiting, nothing seen yet | Waiting for ChatGPT to start and finish a response. Send a message to begin. | Waiting for ChatGPT. Send your first message yourself to begin. |
| Detail: countdown | ChatGPT finished. The continuation prompt is sent when the countdown ends. | The answer is finished. The continuation is sent when the countdown ends. |
| Detail: sending | Sending the continuation prompt… | Sending the continuation… |
| Detail: stopped, idle | Start Autopilot in the ChatGPT conversation you want to continue. | Open the ChatGPT conversation you want to continue, then press Start. |
| Detail: paused by you | Paused by you. | (unchanged) |
| Start hint | Open a ChatGPT conversation in this window to start. | Open a ChatGPT conversation in this window, then press Start. |
| "ChatGPT" field | Unknown / Idle / Generating / Finished / Error shown / Usage limit shown | Not recognized / Idle / Answering / Answer finished / Shows an error / Shows a usage limit |

## 2. Halt reasons and guidance (`REASON_TEXT`, `HALT_GUIDANCE`)

| Reason | Current reason text | Proposed reason text | Proposed guidance (kind unchanged) |
|---|---|---|---|
| user | By you | Paused by you. | Press Resume to continue. |
| max_cycles | Maximum number of continuations reached | The maximum number of continuations was sent. | To continue, raise *Maximum cycles* in Settings and start again. |
| usage_limit | ChatGPT shows a usage limit | ChatGPT shows a usage limit. | Wait until the limit is lifted, then press Resume. Autopilot never retries on its own. |
| auth_required | ChatGPT asks you to log in | ChatGPT asks you to log in. | Log in in the ChatGPT tab, open the conversation, then press Resume. |
| page_error | ChatGPT shows an error | ChatGPT shows an error. | Check the ChatGPT tab and reload it if needed, then press Resume. |
| conversation_changed | The tab switched to a different conversation | The ChatGPT tab now shows a different conversation. | Go back to the original conversation and press Resume, or press Stop and start in the new one. |
| tab_closed | The ChatGPT tab was closed | The ChatGPT tab was closed. | Open the conversation again, then press Resume. |
| browser_restarted | The browser or the extension restarted | The browser or Autopilot restarted. | Open the conversation again, then press Resume. |
| composer_has_text | The message box already contains text | The message box already contained text. | Send or clear your text, then press Resume. Your text was not changed. |
| submit_failed | The continuation could not be sent | The continuation could not be sent. | Check the ChatGPT tab, then press Resume. If it happens again, copy the diagnostic report. |
| submission_uncertain | It is unclear whether the last continuation was sent | Autopilot could not confirm that the continuation was sent. | Check the conversation: if the continuation is missing, send it yourself. Then press Resume; that answer is not continued again. |
| tab_unreachable | The ChatGPT tab did not respond | The ChatGPT tab did not respond. | Reload the ChatGPT tab, then press Resume. |
| unrecognized_notice | ChatGPT shows a notice Autopilot does not recognize (check the page; nothing was sent) | ChatGPT shows a notice that Autopilot does not recognize. Nothing was sent. | Read the notice in the ChatGPT tab, then press Resume. If it is not in English, please report its exact text. |
| no_response | ChatGPT did not start answering the continuation | ChatGPT did not start answering the continuation. | Check the ChatGPT tab for a notice, then press Resume. |
| no_new_answer | ChatGPT finished without a new answer | ChatGPT stopped without a new answer. | Check the last answer (it may have ended with an error), then press Resume. |
| marker_complete | ChatGPT reports the milestone complete (status line in its last answer) | ChatGPT's status line says the milestone is complete. | Check the result yourself: the status line is ChatGPT's own report, not a verification. Start again for more work. |
| marker_blocked | ChatGPT reports it is blocked (status line in its last answer) | ChatGPT's status line says it is blocked. | Read the last answer and give ChatGPT what it needs. Press Resume to continue that answer once, or send it a message yourself. |
| marker_unclear | Unclear status line in ChatGPT's last answer | The status line in ChatGPT's last answer is unclear. | Its last line must be exactly one of the three status lines. Press Resume to continue that answer once. |

Guidance labels (unchanged): *Resume when ready* / *Fix first* / *Finished*.

## 3. Details shown after a failed or uncertain send (`composer.ts`, `controller.ts`)

These follow the reason text after a colon. Proposed: shorter, no internal terms.

| Case | Current | Proposed |
|---|---|---|
| no_composer | the message box was not found | the message box was not found |
| composer_disabled | the message box is disabled | the message box was disabled |
| insert_failed | the prompt could not be typed into the message box reliably | the continuation could not be typed into the message box |
| send_unavailable | the send button did not become available | the Send button was not available |
| tab_suspended | the tab was suspended or throttled for Ns while the prompt waited (a hidden or frozen tab), so send was not clicked | the ChatGPT tab was paused by the browser (Ns), so nothing was sent |
| not_sent | clicking send did not send the message | clicking Send did not send the continuation |
| vanished | the prompt left the message box before Autopilot clicked send | the continuation left the message box before Autopilot clicked Send |
| emptied | the message box was emptied but no sent message or response appeared | the message box was emptied, but no sent message or answer appeared |
| no tab answer | the ChatGPT tab did not answer | the ChatGPT tab did not respond |

## 4. Refusals (banner after a button press)

| Case | Current | Proposed |
|---|---|---|
| Invalid settings | Fix the settings first: … | Fix the settings first: … (then the field messages, see C-6) |
| No ChatGPT tab | Open your ChatGPT conversation in this window and make it the active tab, then start Autopilot. | Open the ChatGPT conversation in this window and select its tab, then press Start. |
| Tab not connected | Autopilot is not connected to that tab yet (it was open before the extension was installed or updated). Reload the ChatGPT tab, then start again. | Autopilot is not connected to this tab yet. Reload the ChatGPT tab, then press Start. |
| Already active | Autopilot is already active. Stop it before starting a new session. | Autopilot is already running. Press Stop first to start again. |
| Usage limit at Start | ChatGPT is showing a usage limit. Start Autopilot once it is lifted. | ChatGPT shows a usage limit. Press Start once it is lifted. |
| Login at Start | ChatGPT asks you to log in first. | ChatGPT asks you to log in. Log in, then press Start. |
| No message box | The ChatGPT message box was not found in this tab. | The message box was not found in this tab. Reload it, then press Start. |
| Pause when not running | Only a running session can be paused. | Autopilot is not running. |
| Resume when not paused | Only a paused or stopped-by-error session can be resumed. | There is nothing to resume. |
| Resume without the tab | Open the conversation this session belongs to, then resume. | Open the conversation Autopilot was working in, then press Resume. |
| Resume in another conversation | This tab shows a different conversation. Go back to the session's conversation, or stop and start a new session. | This tab shows a different conversation. Go back to the original one, or press Stop and start again. |
| Resume with a usage limit | ChatGPT still shows a usage limit. | ChatGPT still shows a usage limit. |
| Stop when stopped | Autopilot is not active. | Autopilot is not running. |
| Internal (not normally seen) | The continuation is no longer pending. / A continuation was already sent for this response. | The continuation is no longer pending. / A continuation was already sent for this answer. |

## 5. Activity log lines (`session.ts`)

| Current | Proposed |
|---|---|
| Autopilot started. Waiting for ChatGPT to finish a response. | Started. Waiting for ChatGPT's answer. |
| ChatGPT is generating a response. | ChatGPT is answering. |
| Response complete. Continuation N in Xs. | Answer finished. Continuation N in X s. |
| The finished response was updated on the page; continuation N in Xs. | The answer changed on the page. Continuation N in X s. |
| ChatGPT started generating again; the pending continuation was cancelled. | ChatGPT started answering again. The pending continuation was cancelled. |
| Sending continuation N. | Sending continuation N. |
| Continuation N sent. | Continuation N sent. |
| The page refused the continuation; nothing was sent. | The ChatGPT tab refused the continuation. Nothing was sent. |
| The new chat was saved as a conversation; following it. | The new chat was saved as a conversation. Following it. |
| Resumed. / Resumed despite the status line; that answer is continued once. | Resumed. / Resumed despite the status line. That answer is continued once. |
| Response identification changed since the last continuation; waiting for ChatGPT's next answer. | Waiting for ChatGPT's next answer (answers are identified differently since the update). |
| The ChatGPT tab was closed. / The browser restarted. | (unchanged) |
| Halt lines ("Paused: …", "Stopped: …", "Error: …") | "Paused: …", "Stopped: …", **"Stopped by an error: …"** |

## 6. Banners and notifications

| Case | Current | Proposed |
|---|---|---|
| Settings saved | Settings saved. | (unchanged) |
| Settings reset | Settings reset to the defaults. | Settings reset to the defaults, including the continuation prompt. |
| Report copied | Diagnostic report copied. It contains no conversation text. | (unchanged) |
| Report fallback | Copy the diagnostic report below (Ctrl+C / Cmd+C). | (unchanged) |
| Notification title | Autopilot paused / stopped / error | Autopilot paused / Autopilot stopped / **Autopilot stopped by an error** |

## Acceptance (C-5)

- Every text in the UI, log and notifications matches the approved table.
- The existing tests pinning reasons, kinds and guidance stay green, updated
  only for wording.
- A new test checks that no reason, guidance or detail text is empty, contains
  an internal code (`marker_`, `composer`, `tab_suspended`, …) or lacks a final
  period where the table has one.
