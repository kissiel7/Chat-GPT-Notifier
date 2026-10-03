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
