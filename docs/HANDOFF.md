# Handoff

## Current release

`0.1.5` notification controls and deployment marker.

## Source of truth

GitHub: `kissiel7/Chat-GPT-Notifier` (`main`)

## Deployment mirror

Dropbox: `/Projects/ChatGPT-Notifier`

GitHub is authoritative. Dropbox is only the deployment mirror.

**Strict versioning rule:** every GitHub change that is mirrored to Dropbox requires a new extension version, including documentation-only or deployment-only changes.

The Dropbox project folder itself is the unpacked deployment. Future deployments should update it in place so Brave/Chrome/Edge can continue pointing directly at `/Projects/ChatGPT-Notifier` with **Load unpacked**. Do not create ZIP deployment artifacts; GitHub history is the archive.

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

Load `/Projects/ChatGPT-Notifier` directly in Brave as an unpacked extension and run the scenarios in `docs/TESTING.md`, starting with:

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
