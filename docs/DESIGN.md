# Design

## Authority model

GitHub `kissiel7/Chat-GPT-Notifier` is the master and authoritative repository.

Dropbox `/Projects/ChatGPT-Notifier` is a deployment mirror. The primary deployment target is the unpacked folder `/Projects/ChatGPT-Notifier/current`, which must be kept ready to load directly as an unpacked Chromium extension. Versioned ZIP snapshots may also be retained for traceability, but normal installation and updates must not require the user to unpack files manually.

Project changes must be committed to GitHub first and only then mirrored to Dropbox.

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
- stores lightweight runtime status in `chrome.storage.session`.

### Options page

Stores settings in `chrome.storage.local`, including the optional ntfy token. The token is never stored in source control or emitted to diagnostic logs.

### Popup

Shows current-tab title, whether it matches the scope rules, detector state, and notification-channel state.

## Detection state machine

`idle -> active -> verifying -> completed -> idle`

Exceptional terminal paths are `manual_stop` and `error`.

A cycle starts only after the extension observes a Stop-button appearance. This prevents old conversations or extension reloads from producing completion notifications.

The Stop button disappearing is only a completion candidate. Completion is confirmed after the assistant fingerprint remains stable for the configured window.

## Title matching

The background worker matches the normalized conversation title against one rule per line. Rules can be wildcard patterns or JavaScript regular expressions.

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
