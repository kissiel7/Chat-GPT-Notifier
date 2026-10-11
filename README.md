# ChatGPT Notifier

A small Chromium Manifest V3 extension that notifies you when selected ChatGPT conversations finish responding.

## Current scope

Version `0.1.10` monitors ChatGPT tabs and notifies only when the conversation title matches configured rules. The initial rules are:

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
- A toolbar popup with one-click **Monitor this chat** / **Stop monitoring this chat** controls plus collapsible diagnostics.

The extension never sends ChatGPT response text to ntfy. It sends the matching chat title, completion timing, and optionally the conversation URL.

## Install in Brave

1. Use the unpacked Dropbox deployment folder at `/Projects/Chrome Extension-ChatGPT Notifier`.
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

Dropbox `/Projects/Chrome Extension-ChatGPT Notifier` is the unpacked deployment mirror and is kept directly loadable with Chromium's **Load unpacked** command. Do not create ZIP deployment artifacts; GitHub history provides versioning and traceability. Dropbox is not the source of truth.

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


## v0.1.4 toolbar scope control

Clicking the extension icon opens a control popup for the current ChatGPT tab. If the chat is not already covered by a rule, **Monitor this chat** adds an exact-title regex rule for its current canonical name. If that exact rule is responsible for the match, **Stop monitoring this chat** removes it. Chats already covered by a broader rule are shown as already monitored and are not given a misleading per-chat remove action.

The popup loader is defensive: failures to read the content-script or background status are shown inside the popup instead of aborting its UI.


## v0.1.5 notification and deployment status

The toolbar popup now shows the extension version directly, separates Windows and mobile notification state, exposes the last delivery result for each channel, and provides **Test Windows** and **Test mobile** actions without opening Settings.

A root-level `release.json` marker carries the deployed release version. The popup compares it with the manifest version and reports `Deployment: OK` only when they agree. This is an additional guard against partial or stale Dropbox deployments.


## v0.1.6 monitored-tabs dashboard and badge

The toolbar popup now includes a **Monitored tabs** dashboard listing every open ChatGPT conversation currently covered by the scope rules. Running conversations are shown first, the current tab is marked, and clicking any dashboard row focuses that ChatGPT tab/window.

The extension action badge shows the number of monitored conversations currently in an active or completion-verification state. The badge clears when nothing monitored is running, when a tab closes, or when a ChatGPT tab navigates away. The dashboard refreshes while the popup is open.

The response detector itself is unchanged from the previously validated logic.


## v0.1.7 intermittent-notification diagnostics

This release adds diagnostics without intentionally changing the response-completion detector.

The extension keeps a rolling local history of up to 300 diagnostic events. It records lifecycle evidence such as generation-cycle start, composer/Stop-state transitions, state changes, verification scheduling, first assistant activity, manual Stop/error suppression, completion handoff to the background worker, scope matching, and Windows/ntfy delivery outcomes.

The popup diagnostics section now shows the last successful Windows and mobile notification timestamps and adds **Copy diagnostics** and **Clear diagnostics** actions. **Copy diagnostics** produces a text report for the current tab including extension/release versions, non-secret settings, current detector/background state, and the recent event timeline.

The diagnostic report deliberately excludes ChatGPT response text, ntfy topic value, and ntfy token value. It records only whether ntfy topic/token configuration is present.


### Detector availability in the dashboard

A monitored tab is no longer silently shown as `idle` when the popup cannot reach its content detector. v0.1.7 shows `detector unavailable — refresh tab` instead. This can occur after an unpacked-extension reload while an already-open ChatGPT tab has not itself been refreshed. Such a tab cannot be relied on for completion notifications until its detector is available again.


## v0.1.8 dashboard responsiveness fix

The monitored-tabs dashboard no longer waits indefinitely for stale or unreachable content scripts. Detector probes for all ChatGPT tabs now run in parallel with a short per-tab timeout. The popup itself also has a bounded dashboard request timeout, so it either renders the monitored-tab state quickly or shows a concrete timeout message instead of remaining on `Loading…`.

Tabs whose detector cannot be reached continue to be shown as `detector unavailable — refresh tab`; they are not misreported as idle.


## v0.1.9 automatic detector recovery

The extension can now restore missing ChatGPT content detectors without reloading the page. It requests Chromium's `scripting` permission and, when a detector does not answer, injects `src/content.js` into the existing ChatGPT tab, waits briefly, and probes again.

Recovery is attempted proactively when the service worker starts, after browser startup/install/update, when a ChatGPT tab finishes loading, when the popup needs the current-tab detector, and while collecting monitored-tab state.

If recovery happens while ChatGPT is already generating, the newly injected detector inspects the current composer state. A visible Stop/generating state initializes a `recovered-active` cycle so the remainder of that response can still be tracked and notified when it completes.

If the response already finished before recovery, the extension intentionally does not synthesize a retroactive completion notification because it cannot safely distinguish a new completion from an old conversation.

Dashboard states now distinguish `recovering detector…` from a genuine recovery failure. Manual page refresh remains only a fallback if script injection itself fails.


## v0.1.10 duplicate-notification fix

Diagnostics from a real failure showed that repeated detector recovery attempts had injected multiple independent copies of `src/content.js` into the same ChatGPT tab. Each copy tracked the same generation with its own cycle ID and therefore each emitted its own completion event, producing multiple Windows and ntfy notifications for one answer.

The content detector is now a per-tab singleton. A reinjection checks for an already-live detector instance and exits immediately instead of registering another MutationObserver, timer, click/submit handlers, and runtime message listener. A stale detector context from an older extension reload can still be replaced.

The completion heuristics themselves are unchanged.
