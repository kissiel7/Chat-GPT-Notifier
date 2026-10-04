# Design

## Authority model

GitHub `kissiel7/Chat-GPT-Notifier` is the master and authoritative repository.

Dropbox `/Projects/ChatGPT-Notifier` is the unpacked deployment mirror and must be kept ready to load directly as a Chromium extension. Do not create or retain ZIP deployment artifacts; GitHub is the archive and source of version history.

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
- stores lightweight runtime status in `chrome.storage.session`.

### Options page

Stores settings in `chrome.storage.local`, including the optional ntfy token. The token is never stored in source control or emitted to diagnostic logs.

### Popup

Acts as the primary quick-control menu. It shows current-tab title and scope state, can add an exact-title rule for the current chat, can remove that exact rule when it is the active match, shows Windows/mobile notification state and last per-channel delivery results, and provides direct notification test actions. Detector diagnostics stay under a collapsible section. Popup status retrieval is fault-tolerant so a content-script/background lookup failure does not prevent the menu from rendering.

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
