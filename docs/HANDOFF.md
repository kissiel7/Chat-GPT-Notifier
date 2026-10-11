# Handoff

## Current release

`0.1.11` stable monitored-tab dashboard with detector recovery.

## Source of truth

GitHub: `kissiel7/Chat-GPT-Notifier` (`main`)

## Deployment mirror

Dropbox: `/Projects/Chrome Extension-ChatGPT Notifier`

GitHub is authoritative. Dropbox is only the deployment mirror.

**Strict versioning rule:** every GitHub change that is mirrored to Dropbox requires a new extension version, including documentation-only or deployment-only changes.

The Dropbox project folder itself is the unpacked deployment. Future deployments should update it in place so Brave/Chrome/Edge can continue pointing directly at `/Projects/Chrome Extension-ChatGPT Notifier` with **Load unpacked**. Do not create ZIP deployment artifacts; GitHub history is the archive.

## Initial monitored chat names

- `Finanzblick <number>`
- `Documents Storage <number>`

Implemented as configurable regex rules.

## Implemented

- Manifest V3 Chromium extension.
- Conservative per-tab response-completion detector.
- v0.1.1: a fully observed Stop-button start/end cycle is sufficient for completion; assistant DOM activity is supporting evidence, not a hard requirement.
- Manual Stop suppression.
- Error suppression.
- Name-based scope filtering.
- Windows/browser notifications.
- Optional ntfy.sh publishing without response text.
- Notification click returns to the originating ChatGPT tab.
- Popup status UI.
- Options page and test buttons.

## v0.1.1 troubleshooting conclusion

The first live test showed that scope recognition and desktop test notifications worked, but natural completions produced no notification. The likely failure was the overly strict requirement that assistant-turn DOM markup must visibly change during the same cycle. ChatGPT's current DOM can change independently of that heuristic. v0.1.1 therefore keeps the Stop-button lifecycle, stabilization, manual-Stop suppression and error suppression, while removing assistant-DOM activity as a mandatory completion gate.

## Next validation step

Load `/Projects/Chrome Extension-ChatGPT Notifier` directly in Brave as an unpacked extension and run the scenarios in `docs/TESTING.md`, starting with:

1. Windows test notification.
2. Out-of-scope conversation response.
3. `Finanzblick 20` normal response.
4. `Finanzblick 20` long/tool-using response.
5. Manual Stop.

Do not tune selector logic until actual Brave/ChatGPT behavior has been observed and captured.


## v0.1.2 troubleshooting conclusion

Live v0.1.1 testing still produced no automatic completion notification even though the extension loaded without errors and the desktop test notification worked. v0.1.2 adds:

- explicit recognition of the current ChatGPT composer role flip between `data-testid="send-button"` and `data-testid="stop-button"`;
- a send-click/form-submit fallback so a generation cycle can begin even if the stop state is missed;
- fallback completion only after assistant activity and a longer stability window when no Stop state was observed;
- popup diagnostics for composer role, whether Stop was seen during the active cycle, last detector event, and background delivery acknowledgement.

The next live test should use these diagnostics to distinguish detector failure from notification-delivery failure.


## v0.1.3 troubleshooting conclusion

The user confirmed that newly added scope rules were saved and the ChatGPT page was refreshed, but a visibly matching chat title still did not behave as in-scope. The release therefore hardens title handling rather than changing the regex:

- prefer the current conversation sidebar link as the canonical title;
- fall back to `document.title`;
- normalize title and rule strings with Unicode NFKC;
- remove zero-width/invisible characters;
- expose the exact matched rule and title source in the popup.

After deployment, the first check is whether `Test chat` reports `In scope: Yes`, `Matched rule: /^Test chat$/i`, and `Title source: sidebar-current-link` (or `document-title` as fallback).


## v0.1.4

Requested workflow improvement:

- clicking the Brave toolbar extension icon should present a real control menu;
- an out-of-scope named ChatGPT conversation gets a one-click **Monitor this chat** action;
- the action appends an exact-title regex rule to the existing settings and takes effect immediately;
- when the exact rule is the active match, the popup offers **Stop monitoring this chat**;
- if a broader pattern already covers the chat, the popup reports that it is already monitored rather than editing the broader rule;
- detector diagnostics remain available under a collapsible **Diagnostics** section;
- popup loading is wrapped defensively so background/content-script lookup failures are visible instead of causing the menu to disappear.

Next validation: reload extension 0.1.4, refresh a ChatGPT tab, click the toolbar icon, and verify the popup appears. On an unrelated named chat, click **Monitor this chat** and verify **In scope** immediately changes to **Yes** without opening Settings.


## v0.1.5

Operational-hardening release after successful Windows, scope-control and ntfy setup:

- display manifest version in the toolbar popup;
- display Windows and mobile notification state separately;
- persist and display the last real completion delivery result for each channel;
- add **Test Windows** and **Test mobile** buttons directly to the popup;
- add root `release.json` with release version and source-repository metadata;
- popup reports deployment `OK` only when `manifest.json` and `release.json` versions match;
- detector logic is intentionally unchanged from the working v0.1.4 path.

Deployment validation must verify the live Dropbox cloud copies of both `manifest.json` and `release.json`, plus all changed runtime files, before a release is reported complete.


## v0.1.6

Usability release after the core Windows + ntfy workflow was validated:

- popup lists all open ChatGPT tabs whose canonical titles match the configured scope;
- running tabs are sorted first and the current tab is visibly marked;
- clicking a dashboard row focuses the corresponding browser tab/window;
- the toolbar/action badge shows the number of monitored chats in `active` or `verifying` state;
- badge state is refreshed on detector updates, settings changes, tab close, navigation away from ChatGPT, startup, and dashboard refresh;
- popup dashboard refreshes approximately every 1.2 seconds while open;
- detector/completion heuristics are intentionally unchanged.

Validation should include two monitored ChatGPT tabs generating concurrently: the badge should show `2`, the dashboard should list both as generating, clicking either row should focus it, and the badge should decrement as each response finishes.


## v0.1.7

Intermittent missed notifications were reported after the core workflow was otherwise working. This release is diagnostic-first: detector timing/decision rules are intentionally not tuned yet.

Added:

- rolling local diagnostic log increased to 300 events;
- serialized log writes to reduce loss during concurrent tab activity;
- content-side evidence for composer/Stop transitions, cycle source, state transitions, verification scheduling/reset, first assistant activity, manual Stop, completion handoff/acknowledgement and page unload;
- background evidence for completion receipt, scope matching, desktop notification creation/error, ntfy delivery and tab navigation;
- last successful Windows and mobile notification timestamps retained in per-tab runtime state;
- popup **Copy diagnostics** and **Clear diagnostics** controls;
- copied report contains version/deployment info, sanitized settings, content/background state and the relevant event timeline;
- response text, ntfy topic value and ntfy token value are excluded.

When a notification is missed, leave the affected ChatGPT tab open if possible, click the extension icon, expand **Diagnostics**, click **Copy diagnostics**, and paste the complete report into ChatGPT. Do not change detector behavior until at least one missed case has been captured unless a separate deterministic bug is found.


### Important v0.1.7 dashboard correction

v0.1.6 treated failure to contact a tab's content script as `idle`. That masked a potentially important cause of missed notifications after extension reloads. v0.1.7 now marks that condition as `detector unavailable — refresh tab` and logs detector unavailable/restored transitions. A genuinely idle tab and an uninstrumented tab are therefore distinguishable.


## v0.1.8

The v0.1.7 popup could remain on **Loading monitored chats…** when one or more ChatGPT tabs had stale/unreachable content scripts. The dashboard queried tabs sequentially and had no upper bound on a stalled message.

Fix:
- content-status probes run in parallel;
- each tab probe is bounded to 650 ms;
- popup content-status lookup is bounded;
- the whole dashboard request is bounded to 1.8 seconds;
- timeout is shown explicitly instead of an indefinite loading state;
- detector/completion heuristics remain unchanged.

After reloading an unpacked extension, refresh existing ChatGPT tabs once so their content detectors are active.


## v0.1.9

The user asked to obtain correct monitored-tab state without manually refreshing ChatGPT tabs after extension reloads.

Implemented:

- added Chromium `scripting` permission;
- missing content detectors are automatically reinjected into the existing ChatGPT tab;
- recovery attempts are de-duplicated per tab;
- proactive recovery scan runs on service-worker start, browser startup/install/update, and completed ChatGPT page loads;
- popup current-tab lookup can request immediate detector recovery;
- monitored-tab collection also attempts recovery instead of immediately reporting an unavailable detector;
- content script initialization detects an already-running response and starts a `recovered-active` cycle when Stop/generating state is present;
- dashboard can show `recovering detector…` and explicit recovery failure;
- manual page refresh is now a fallback rather than the normal recovery procedure.

Important semantic boundary: if the detector was absent for the entire response and recovery occurs only after the response finished, no retroactive completion is emitted. That avoids false notifications for old conversation state.


## v0.1.11

A live popup showed alternating states: a valid monitored-tab view followed by `Dashboard timed out`. Diagnostics showed 13 ChatGPT tabs but only 2 monitored tabs.

Fix:
- filter by scope before detector probing;
- dashboard probes only monitored tabs;
- a missed quick probe reuses cached runtime state and starts recovery asynchronously;
- dashboard refreshes cannot overlap;
- refresh interval increased from 1.2 s to 2 s;
- proactive recovery scans now target monitored tabs only;
- detector/completion semantics remain unchanged.

Expected result: while a monitored response runs, the popup should remain stable at `generating` instead of alternating with timeout messages.
