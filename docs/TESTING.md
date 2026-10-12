# Manual test matrix

Run these tests in Brave after every detector change.

| Scenario | Expected result |
|---|---|
| Open old `Finanzblick 20` conversation | No notification |
| Generate a normal answer in `Finanzblick 20` | Exactly one notification |
| Generate a long/tool-using answer in `Finanzblick 20` | Exactly one notification after final completion |
| Generate in `Documents Storage 01` | Exactly one notification |
| Generate in an unrelated chat | No project notification |
| Click Stop manually during an in-scope response | No completion notification |
| Two in-scope tabs generate concurrently | One notification per completed tab |
| Rename an unrelated chat to `Finanzblick 21`, then generate | Notification after completion |
| Reload the extension while a response is already generating | Prefer no notification for that already-running cycle |
| ChatGPT shows an obvious generation error | No completion notification |
| Click Windows notification | Existing source tab/window is focused, or URL opens if tab is gone |
| ntfy test | One mobile notification; no response content is transmitted |

## Debug procedure

1. Click the extension icon in the affected ChatGPT tab.
2. Record **Chat**, **In scope**, **State**, and **Last event**.
3. Confirm the title matches the configured rule.
4. If state never reaches `active`, inspect current Stop-button markup.
5. If it reaches `active` but not `completed`, inspect assistant-message selectors and the stability transition.


## v0.1.5 popup and deployment checks

| Scenario | Expected result |
|---|---|
| Open toolbar popup | Version shows `v0.1.5` |
| Popup deployment diagnostic | `Deployment: OK · 0.1.5` |
| Click **Test Windows** | One Windows/browser test notification |
| Click **Test mobile** with ntfy enabled | One ntfy mobile test notification |
| Complete a monitored response | Windows/mobile rows show the latest per-channel delivery result |


## v0.1.6 dashboard and badge checks

| Scenario | Expected result |
|---|---|
| Open popup with multiple monitored ChatGPT tabs | Every open in-scope chat appears under **Monitored tabs** |
| Current monitored tab | Row is marked `current` |
| Click another monitored-chat row | Corresponding browser tab/window receives focus |
| One monitored response is generating | Toolbar badge shows `1`; dashboard shows `generating` |
| Two monitored responses generate concurrently | Toolbar badge shows `2`; both running rows are sorted first |
| One of two running responses completes | Badge decrements to `1` |
| All monitored responses complete | Badge clears |
| Monitored ChatGPT tab is closed or navigates away | It no longer contributes to the badge/dashboard |
| Popup remains open during generation | Dashboard state refreshes without reopening the popup |
| Deployment diagnostic | `Deployment: OK · 0.1.6` |


## v0.1.7 intermittent-failure diagnostics

| Scenario | Expected result |
|---|---|
| Open popup after deployment | Version shows `v0.1.7`; deployment shows `OK · 0.1.7` |
| Generate a monitored response | Diagnostics retain cycle/state/delivery events without message content |
| Successful Windows notification | **Last Windows** shows a timestamp |
| Successful ntfy notification | **Last mobile** shows a timestamp |
| Click **Copy diagnostics** | Clipboard receives a report containing settings/state/event history |
| Inspect copied report | No ChatGPT response text, ntfy topic value, or ntfy token value |
| Click **Clear diagnostics** | Rolling diagnostic history is cleared |

### Missed-notification capture procedure

1. When a monitored response finishes but no expected notification appears, keep that ChatGPT tab open.
2. Click the extension toolbar icon in the affected tab.
3. Expand **Diagnostics**.
4. Click **Copy diagnostics**.
5. Paste the entire copied report into the troubleshooting chat.
6. Avoid reloading the affected ChatGPT tab before copying if possible; the persistent event log survives, but live content-state evidence is more useful before reload.


| Monitored tab cannot be reached by content script | Dashboard shows `detector unavailable — refresh tab`, not `idle` |
| Refresh an unavailable ChatGPT tab | Dashboard returns to a live detector state and logs detector restoration |


## v0.1.8 dashboard responsiveness

| Scenario | Expected result |
|---|---|
| One or more ChatGPT tabs have stale/unreachable content scripts | Popup does not remain on `Loading…` indefinitely |
| Dashboard probe exceeds timeout | Popup shows an explicit dashboard timeout message |
| Several monitored tabs are open | Status probes complete in parallel and dashboard renders promptly |
| Unreachable monitored tab | Row reports `detector unavailable — refresh tab` rather than `idle` |


## v0.1.9 automatic detector recovery

| Scenario | Expected result |
|---|---|
| Reload unpacked extension with ChatGPT tabs already open | Existing tabs recover detectors without a manual page refresh |
| Open popup on a tab whose detector is missing | Popup/background inject the detector and obtain live state |
| Detector recovery succeeds while tab is idle | Dashboard returns to `idle` |
| Detector recovery occurs while ChatGPT is actively generating | Content detector starts a `recovered-active` cycle and dashboard shows `generating` |
| Recovered-active response finishes | Normal scoped notification path runs once |
| Recovery occurs only after a response already finished | No retroactive completion notification |
| Script injection fails | Dashboard reports detector recovery failure; manual refresh remains a fallback |
| Several stale ChatGPT tabs are open | Recovery attempts run independently and do not duplicate per tab |
| Deployment diagnostic | `Deployment: OK · 0.1.9` |


## v0.1.11 dashboard stability

| Scenario | Expected result |
|---|---|
| Many ChatGPT tabs are open but only a few are monitored | Dashboard probes only monitored tabs |
| Monitored response is generating | Dashboard stays on `generating` and does not flip to timeout |
| One monitored detector briefly misses a fast status probe | Last known state remains visible while recovery runs asynchronously |
| Popup remains open for a long response | No overlapping dashboard requests; state refreshes about every 2 seconds |
| Deployment diagnostic | `Deployment: OK · 0.1.11` |


## v0.1.12 title/scope freshness

| Scenario | Expected result |
|---|---|
| Open a named out-of-scope ChatGPT conversation whose initial runtime title was `ChatGPT` | Popup resolves the real title and shows **Monitor this chat** |
| Click **Monitor this chat** | Exact-title rule is added and popup immediately changes to in-scope |
| Content title changes from fallback `ChatGPT` to the real conversation name | Background runtime title is updated automatically |
| Dashboard candidate has stale cached fallback but current browser title is specific | Current specific title is used for scope matching |
| Deployment diagnostic | `Deployment: OK · 0.1.12` |


## v0.1.13 recovery-status UI

| Scenario | Expected result |
|---|---|
| Current-tab detector misses the first quick probe | Neutral `Recovering detector…`, no red error |
| Detector answers shortly afterward | Warning clears automatically and current-tab state refreshes |
| Dashboard already shows current tab `Idle` after recovery | No stale red recovery-failed message remains |
| Recovery repeatedly fails and background reports unavailable | Red `Detector unavailable` message appears |
| Persistent failure later recovers while popup remains open | Live status clears the recovery warning |
| Deployment diagnostic | `Deployment: OK · 0.1.13` |


## v0.1.14 adaptive window sizing

| Scenario | Expected result |
|---|---|
| Click toolbar icon | Dedicated ChatGPT Notifier popup window opens instead of the capped action dropdown |
| Re-click toolbar icon | Existing notifier window is reused for the newly clicked ChatGPT tab |
| Few monitored chats | Window shrinks to content; no unnecessary vertical scrollbar |
| More monitored chats / expanded diagnostics | Window grows vertically with content |
| Content fits within available screen height | No page scrolling is required |
| Content exceeds available screen height | Window stops near screen height and page scrolling becomes available |
| Click monitored-chat row | ChatGPT tab/window is focused; notifier window remains open |
| Deployment diagnostic | `Deployment: OK · 0.1.14` |


## v0.1.15 native popup sizing

| Scenario | Expected result |
|---|---|
| Click toolbar icon | Native anchored Chromium popup opens |
| Few monitored chats | Popup height fits the content; no unnecessary scrollbar |
| More monitored chats | Popup grows vertically with the list |
| Content remains below Chromium popup limit | Entire popup content is visible without scrolling |
| Content exceeds Chromium popup limit | Popup stops growing and one normal popup scrollbar is used |
| Monitored-tabs list | No separate internal 210 px scrollbar |
| Popup remains open while state rows update | No wobbling/shaking from explicit window resizing |
| Deployment diagnostic | `Deployment: OK · 0.1.15` |
