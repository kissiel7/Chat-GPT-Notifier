# ChatGPT Notifier

A small Chromium Manifest V3 extension that notifies you when selected ChatGPT conversations finish responding.

## Current scope

Version `0.1.3` monitors ChatGPT tabs and notifies only when the conversation title matches configured rules. The initial rules are:

- `/^Finanzblick\s+\d+$/i`
- `/^Documents Storage\s+\d+$/i`

It supports:

- Windows/browser notifications.
- Optional mobile notifications through `ntfy.sh`.
- Multiple ChatGPT tabs independently.
- Clicking a Windows notification to return to the corresponding tab.
- Clicking an ntfy notification to open the ChatGPT conversation when link inclusion is enabled.
- Completion detection based primarily on ChatGPT's composer role flip from send to stop and back, with a submit/assistant-activity fallback and stabilization delay.
- Suppression after a manual Stop click and on obvious error states.
- A small popup showing the current chat title, matched scope rule, title source, and detector/delivery state.

The extension never sends ChatGPT response text to ntfy. It sends the matching chat title, completion timing, and optionally the conversation URL.

## Install in Brave

1. Use the unpacked Dropbox deployment folder at `/Projects/ChatGPT-Notifier`.
2. Open `brave://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the Dropbox project folder containing `manifest.json`.
6. Open a ChatGPT conversation and click the extension icon to verify its title and scope state.
7. Open **Settings** from the popup and use **Test Windows notification**.

For Chrome use `chrome://extensions/`; for Edge use `edge://extensions/`.

## ntfy mobile setup

1. Install the ntfy mobile app.
2. Subscribe to a long, hard-to-guess topic, or reserve/protect a topic in an ntfy account.
3. In extension settings, enable ntfy and enter the same topic.
4. If the topic is protected, enter an access token.
5. Use **Test ntfy notification**.

The first release supports hosted `https://ntfy.sh` only. Self-hosted ntfy can be added later with an explicit host permission.

## Pattern syntax

Patterns are matched against the ChatGPT conversation title. One pattern is entered per line.

- `Finanzblick *` uses a wildcard.
- `Documents Storage ??` uses single-character wildcards.
- `/^Finanzblick\s+\d+$/i` uses JavaScript regular-expression syntax.

Regex rules are useful when the numeric suffix should be enforced.

## Completion detection

The detector intentionally prefers an occasional missed notification over false notifications.

The primary completion path observes ChatGPT's composer control changing to `data-testid="stop-button"`, then returning to a non-stop state, followed by a stable response window (default 1700 ms). A secondary path starts from a send click/form submit and requires assistant activity plus a longer stable window if the stop state was missed.

Manual Stop clicks and obvious error states suppress completion notifications. Opening an old conversation does not notify because no new generation cycle was observed.

## Repository and deployment model

**GitHub `kissiel7/Chat-GPT-Notifier` is authoritative.** Source changes are made and committed there first.

Dropbox `/Projects/ChatGPT-Notifier` is the unpacked deployment mirror and is kept directly loadable with Chromium's **Load unpacked** command. Do not create ZIP deployment artifacts; GitHub history provides versioning and traceability. Dropbox is not the source of truth.

**Versioning rule:** every GitHub release state that is mirrored to Dropbox must have a new extension version, including documentation/deployment-only releases.

## Privacy and permissions

The extension requests:

- `notifications` for Windows/browser notifications.
- `storage` for settings, detector status and diagnostic events.
- `tabs` to return to the correct ChatGPT tab.
- host access to ChatGPT and `ntfy.sh` only.

There is no analytics or project backend.


## v0.1.3 title-scope hardening

Scope matching now normalizes Unicode (including invisible zero-width characters), prefers the current conversation's sidebar link as the canonical chat name, and exposes the matched rule and title source in the popup. This is intended to avoid cases where the browser tab title looks identical to a configured rule but contains transient or invisible differences.
