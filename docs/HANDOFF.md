# Handoff

## Current release

`0.1.0` initial implementation.

## Source of truth

GitHub: `kissiel7/Chat-GPT-Notifier` (`main`)

## Deployment mirror

Dropbox: `/Projects/ChatGPT-Notifier`

GitHub is authoritative. Dropbox is only the deployment mirror.

The preferred deployment form is now an unpacked, directly loadable extension at:

`/Projects/ChatGPT-Notifier/current`

Future deployments should update that folder so the user can point Brave/Chrome/Edge directly at it with **Load unpacked** and does not have to extract a ZIP manually. Versioned ZIPs may remain for archive/traceability only.

## Initial monitored chat names

- `Finanzblick <number>`
- `Documents Storage <number>`

Implemented as configurable regex rules.

## Implemented

- Manifest V3 Chromium extension.
- Conservative per-tab response-completion detector.
- Manual Stop suppression.
- Error suppression.
- Name-based scope filtering.
- Windows/browser notifications.
- Optional ntfy.sh publishing without response text.
- Notification click returns to the originating ChatGPT tab.
- Popup status UI.
- Options page and test buttons.

## Next validation step

Load `/Projects/ChatGPT-Notifier/current` directly in Brave as an unpacked extension and run the scenarios in `docs/TESTING.md`, starting with:

1. Windows test notification.
2. Out-of-scope conversation response.
3. `Finanzblick 20` normal response.
4. `Finanzblick 20` long/tool-using response.
5. Manual Stop.

Do not tune selector logic until actual Brave/ChatGPT behavior has been observed and captured.
