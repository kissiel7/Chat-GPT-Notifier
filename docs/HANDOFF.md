# Handoff

## Current release

`0.1.1` detector compatibility fix.

## Source of truth

GitHub: `kissiel7/Chat-GPT-Notifier` (`main`)

## Deployment mirror

Dropbox: `/Projects/ChatGPT-Notifier`

GitHub is authoritative. Dropbox is only the deployment mirror.

The Dropbox project folder itself is the unpacked deployment. Future deployments should update its runtime files in place so Brave/Chrome/Edge can continue pointing directly at `/Projects/ChatGPT-Notifier` with **Load unpacked**, with no manual extraction. Versioned ZIPs may remain for archive/traceability only.

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
