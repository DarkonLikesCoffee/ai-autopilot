# Accessibility checklist (manual)

The E2E runs axe-core (pinned dev dependency, decision D-5) on the panel in the
light and dark themes and fails on any serious or critical WCAG 2.2 AA issue.
That does not replace a person using the panel (requirement R-4): axe cannot
tell whether focus order makes sense, whether an announcement is useful, or
whether a screen reader reads the panel in a usable way. A person completes
this checklist on the **release candidate** (the installed ZIP), and the result
is recorded in `docs/LIVE_VALIDATION.md`.

Use the side panel and the popup once each. Mark each row PASS, FAIL (with what
happened) or NOT RUN (with why).

## A. Keyboard only (no mouse)

| # | Steps | Expected |
|---|---|---|
| K1 | Open the panel, press Tab repeatedly through the whole panel | Every control is reached in reading order (Getting started if shown, Start, Settings, each field, Save, Reset, Activity log, Copy diagnostic report); the focus ring is always visible |
| K2 | With a ChatGPT conversation as the active tab: focus Start, press Enter | Autopilot starts; focus is on **Pause** |
| K3 | Press Enter on Pause, then on Resume | Focus moves to **Resume**, then back to **Pause** |
| K4 | Tab to Stop, press Enter | Autopilot stops; focus is on **Start** |
| K5 | Open Settings (Enter or Space on its heading), set the delay to 0, press Enter in the field or on Save | The delay field is focused and its message is read or visible; nothing is saved |
| K6 | Press Reset to defaults | The confirmation appears and **Cancel** is focused; Escape closes it and focus returns to Reset |
| K7 | Tab to the Activity log and use the arrow keys | The log scrolls |
| K8 | On a fresh install: Tab to *Don't show again*, press Enter | The card disappears; focus is on the status line, not lost |

## B. Screen reader (NVDA with Chrome on Windows, or VoiceOver with Chrome on macOS)

| # | Steps | Expected |
|---|---|---|
| S1 | Open the panel and read it from the top | The status, its detail, the buttons (by name), the Session facts (name and value), Settings fields (by their labels) are read |
| S2 | Press Start | The new status is announced once ("Waiting for ChatGPT. …"), without moving focus |
| S3 | Let an answer finish so the countdown runs | "Continuation in …" is announced once, **not** every second |
| S4 | Pause | "Paused. Paused by you. Resume when ready: …" is announced |
| S5 | Cause a halt (for example type a draft in the message box during the delay) | The reason and the *Fix first* guidance are announced |
| S6 | Save an invalid setting | The invalid field is announced as invalid, with its message |
| S7 | Save valid settings | "Settings saved." is announced |

## C. Visual

| # | Steps | Expected |
|---|---|---|
| V1 | Switch the system to dark mode and back | All text, field borders, the focus ring and the guidance border stay clearly visible in both themes |
| V2 | Zoom the panel to 200 % (Ctrl/Cmd +) | Nothing is cut off or overlaps; no horizontal scrolling in the side panel |

## Contrast (computed, M5 C-7)

Text contrast is checked by axe in both themes. Non-text contrast (WCAG 1.4.11,
at least 3:1) was computed for the colour tokens in `static/styles.css`:

| Element | Light | Dark |
|---|---|---|
| Focus ring (`--focus`) against the card | 5.19:1 | 5.58:1 |
| *Fix first* guidance border (`--warning`) against the card | 4.87:1 | 6.85:1 |
| Text-field border (`--control-border`) against the field | 3.22:1 | 5.07:1 |
| Text-field border against the card | 3.45:1 | 4.64:1 |

Before C-7 the text-field border (`--border`) was 1.33:1 (light) and 1.92:1
(dark), and the guidance border a fixed `#d4a72c` (about 2:1 on white).
