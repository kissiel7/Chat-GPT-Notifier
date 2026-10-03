# ChatGPT Notifier

A small Chromium Manifest V3 extension that notifies you when selected ChatGPT conversations finish responding.

## Current scope

Version `0.1.0` monitors ChatGPT tabs and notifies only when the conversation title matches configured rules. The initial rules are:

- `/^Finanzblick\s+\d+$/i`
- `/^Documents Storage\s+\d+$/i`

It supports:

- Windows/browser notifications.
- Optional mobile notifications through `ntfy.sh`.
- Multiple ChatGPT tabs independently.
- Clicking a Windows notification to return to the corresponding tab.
- Clicking an ntfy notification to open the ChatGPT conversation when link inclusion is enabled.
- Conservative completion detection based on a real Stop-button generation cycle plus assistant-message activity and a stabilization delay.
- Suppression after a manual Stop click and on obvious error states.
- A small popup showing the current chat title, scope and detector state.

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

A completion notification requires all of the following in the same observed cycle:

1. ChatGPT transitions from no Stop button to a Stop button.
2. The latest assistant response changes during the cycle.
3. The Stop button disappears.
4. The assistant response remains stable for the configured stability window (default 1700 ms).
5. No manual Stop click or obvious error was detected.

Opening an old conversation does not notify because no generation cycle was observed.

## Repository and deployment model

**GitHub `kissiel7/Chat-GPT-Notifier` is authoritative.** Source changes are made and committed there first.

Dropbox `/Projects/ChatGPT-Notifier` is a deployment mirror. The Dropbox project folder itself is kept as the unpacked, directly loadable extension for Chromium's **Load unpacked** command. Versioned ZIP snapshots may also be kept for traceability, but manual extraction should not be required for normal updates. Dropbox copies are not the source of truth.

## Privacy and permissions

The extension requests:

- `notifications` for Windows/browser notifications.
- `storage` for settings, detector status and diagnostic events.
- `tabs` to return to the correct ChatGPT tab.
- host access to ChatGPT and `ntfy.sh` only.

There is no analytics or project backend.
