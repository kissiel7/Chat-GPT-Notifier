# Design

## Authority model

GitHub `kissiel7/Chat-GPT-Notifier` is the master and authoritative repository.

Dropbox `/Projects/Chrome Extension-ChatGPT Notifier` is the unpacked deployment mirror and must be kept ready to load directly as a Chromium extension. Do not create or retain ZIP deployment artifacts; GitHub is the archive and source of version history.

Project changes must be committed to GitHub first and only then mirrored to Dropbox.

**Versioning rule:** every GitHub change mirrored to Dropbox requires an extension version bump, even when the change is documentation-only.

## Components

### `src/content.js`

Runs inside each ChatGPT tab. Its responsibilities are:

- derive the current conversation title;
- observe the ChatGPT DOM;
- detect generation start, assistant activity, manual Stop, obvious errors and stable completion;
- maintain per-tab generation-cycle state;
- report status/completion events to the service worker.

The content script does not decide whether a title is in scope and does not call ntfy.

### `src/background.js`

The Manifest V3 service worker is the policy and delivery layer. It:

- loads title-matching rules;
- suppresses out-of-scope completions;
- de-duplicates cycle notifications;
- sends desktop notifications;
- optionally publishes a minimal event to `ntfy.sh`;
- maps notification clicks back to the originating tab;
- maintains an action-badge count for monitored conversations that are currently running;
- provides a monitored-open-tabs snapshot to the popup and focuses a selected tab on request;
- stores lightweight runtime status in `chrome.storage.session`.

### Options page

Stores settings in `chrome.storage.local`, including the optional ntfy token. The token is never stored in source control or emitted to diagnostic logs.

### Popup

Acts as the primary quick-control menu. It shows current-tab title and scope state, can add an exact-title rule for the current chat, can remove that exact rule when it is the active match, shows Windows/mobile notification state and last per-channel delivery results, and provides direct notification test actions. It also shows every open in-scope ChatGPT tab, prioritizes running conversations, marks the current tab, and can focus any listed tab. Detector diagnostics stay under a collapsible section. Popup status retrieval is fault-tolerant so a content-script/background lookup failure does not prevent the menu from rendering.

The popup also compares the runtime manifest version with root `release.json`. A mismatch is surfaced as a deployment problem; this marker is intended to catch partial or stale Dropbox deployments.

## Detection state machine

`idle -> active -> verifying -> completed -> idle`

Exceptional terminal paths are `manual_stop` and `error`.

A cycle normally starts when the extension observes ChatGPT's composer control enter its stop role. A fallback can start a cycle from a send click/form submit if that role transition is missed.

On the primary path, the Stop control disappearing is only a completion candidate; completion is confirmed after the assistant fingerprint remains stable for the configured window. On the fallback path, assistant activity is mandatory and the stability window is longer.

## Title matching

The content script first prefers the current conversation's sidebar link as the canonical title, falling back to the browser document title. Titles and patterns are Unicode-normalized (NFKC), zero-width characters are removed, and whitespace is collapsed before matching.

The background worker matches the normalized conversation title against one rule per line. Rules can be wildcard patterns or JavaScript regular expressions. The matched rule and title source are exposed in the popup for diagnostics.

Initial rules enforce numeric suffixes:

- `/^Finanzblick\s+\d+$/i`
- `/^Documents Storage\s+\d+$/i`

## ntfy data boundary

When enabled, ntfy receives only:

- notification title containing the conversation name;
- a short completion-duration message;
- optional ChatGPT conversation URL.

Assistant response text is intentionally excluded.

## Known risks

ChatGPT DOM changes can invalidate Stop-button or assistant-turn heuristics. The detector keeps these heuristics in one file and exposes state through the popup to shorten troubleshooting.

A purely DOM-based detector cannot guarantee perfect completion semantics across every ChatGPT experiment or future UI revision. False-positive avoidance is prioritized.


## Running-state badge

The extension action badge is derived from background runtime state. Only in-scope tabs in `active` or `verifying` states count as running. The badge is recalculated on detector status changes, scope-setting changes, tab removal, navigation away from ChatGPT, startup, and dashboard refresh.


## Diagnostic capture

v0.1.7 adds evidence collection around the existing detector rather than changing completion semantics.

The content script emits low-volume diagnostic events only on meaningful transitions: composer/Stop snapshots, cycle start, state transition, verification scheduling/reset, first assistant activity, manual Stop, completion handoff/acknowledgement, and page unload. It never sends assistant/user message text as diagnostic payload.

The background worker serializes diagnostic-log writes to avoid read/modify/write races between multiple tabs and retains the newest 300 records in `chrome.storage.local`. Background events also cover completion receipt, de-duplication, scope outcome, desktop notification creation/error, ntfy delivery, and navigation.

`GET_DIAGNOSTICS` returns a sanitized per-tab report containing runtime state, content status, matching rules, enabled notification channels, and relevant logs. ntfy topic/token values are excluded; only configured/not-configured booleans are exposed.


## Automatic detector recovery

v0.1.9 removes the normal need to refresh already-open ChatGPT tabs after an unpacked-extension reload.

The background worker uses `chrome.scripting.executeScript` to inject `src/content.js` into a ChatGPT tab when `GET_CONTENT_STATUS` does not answer within the bounded probe window. Recovery operations are de-duplicated per tab so concurrent popup/dashboard/startup requests share one injection attempt.

Recovery flow:

1. Probe the existing detector.
2. If it responds, reuse it.
3. Otherwise mark the tab `recovering` and inject the content script.
4. Probe again after a short delay.
5. Mark the detector available on success or unavailable on failure.

The worker also scans open ChatGPT tabs on service-worker startup/install/browser startup and attempts recovery proactively.

When a content script initializes and sees the composer already in the Stop/generating state, it starts a `recovered-active` cycle. This allows tracking to continue from the recovery point without claiming knowledge of the response's true original start time. No retroactive completion is generated if injection occurs after the response has already finished.


## Dashboard collection policy

The popup dashboard must not make detector recovery part of its critical rendering path for every ChatGPT tab. It first identifies tabs whose stored/browser title matches a configured monitoring rule, then performs bounded status probes only for those monitored candidates.

If a monitored probe does not answer quickly, the dashboard uses the last background runtime state for display and starts recovery asynchronously. Popup refreshes are serialized so only one dashboard request can be active at a time. This prevents a slow detector from causing UI flapping or recovery storms.


## Recovery-status presentation

The popup distinguishes transport timing from actual detector failure. A missed direct probe or a popup-level recovery timeout is treated as transient and rendered neutrally as `Recovering detector…`. The popup continues bounded direct-status polling while background recovery proceeds.

A red unavailable state is only shown when the background runtime reports a persistent recovery failure (`detector-recovery-failed` or `detector-recovery-no-response`) after repeated unsuccessful checks. Any subsequent live content status immediately clears the warning and refreshes the current-tab controls.


## Adaptive notifier window

The Chromium action-popup surface has a browser-imposed maximum size and therefore cannot satisfy a full-screen-height growth policy. v0.1.14 uses `chrome.action.onClicked` to open/reuse `src/popup.html?panel=1&tabId=<origin>` in a dedicated `chrome.windows.create({type:'popup'})` window.

The originating ChatGPT tab ID is carried in the panel URL so the UI can continue to show the clicked tab even though the extension window itself becomes the focused window.

In panel mode, a `ResizeObserver` watches the UI content. The window's outer height is recalculated from document content height and browser chrome, capped at `screen.availHeight - 40px`. The window is positioned near the right edge of the available screen. Only after that height cap is reached does normal page scrolling become necessary.
