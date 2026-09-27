# Hidden Electron API configuration smoke

Date: 2026-09-27T16:40:30.262Z.

Command: `node scripts/launch.cjs --api-smoke-test`

Result: **14 passed, 0 failed**.

| Check | Result |
| --- | --- |
| Hidden isolated app, real preload and encryption available | PASS |
| siliconflow: UI preset defaults, save without key and reload | PASS |
| dashscope: UI preset defaults, save without key and reload | PASS |
| openai: UI preset defaults, save without key and reload | PASS |
| groq: UI preset defaults, save without key and reload | PASS |
| custom: UI preset defaults, save without key and reload | PASS |
| Provider draft switch clears ASR key and preserves polish/shortcut drafts | PASS |
| Real safeStorage encrypts ASR key and reopened store decrypts exact binding | PASS |
| Region changes do not reuse stored or unsaved ASR keys | PASS |
| Custom endpoint casing/default-port exact binding matches UI and reopened store | PASS |
| Same address under another provider cannot reuse a stored key | PASS |
| Invalid help requests reject; valid help never launches browser in fixture | PASS |
| Remove synthetic credentials; configuration creates no tasks or history | PASS |
| Capture hidden settings screenshot with empty key fields and no shown window | PASS |

The isolated `artifacts/api-smoke-workspace` uses the real main/preload/renderer, validation/store and Windows safeStorage. The existing shortcut controller uses fake listener backends only in this launch mode; no real global shortcut/native keyboard helper is invoked. The only BrowserWindow remains hidden; no tray or overlay is created. Resource sampling and background hardware scan are skipped. Side-effect IPC is blocked, media permission is denied, and valid help links are blocked before shell opening.

Synthetic credentials are encrypted into the isolated fixture and checked through a reopened real store; plaintext and ciphertext are not copied into this report or screenshot. No microphone/clipboard/paste/export/shell/network action is requested by the fixture. Settings changes do not create monitor tasks or history.

Screenshot, if its check passed: `artifacts/api-settings.png`, captured from hidden webContents with empty credential fields. This verifies configuration behavior, not real supplier authentication, billable API requests, microphone accuracy, native shortcuts or local model inference.
