# Configurable recording shortcut

Date: 2026-09-27. This contract supersedes the shortcut default/grammar in SPEC.md. No models or dependencies are downloaded.

## Two-pass review and source of truth

Pass 1: keyboard -> native Right Alt tap listener or Electron accelerator -> main recording toggle -> existing recording session -> guarded original-input paste. Settings recording is a temporary input capture, not a recording trigger.

Pass 2: review settings validation, atomic state migration, preload IPC, renderer draft and navigation, native process lifetime, tray/HUD/footer, monitoring health, hotkey repeat gate, reload/quit paths, portable packaging, history/export and test fixtures. History/export/task records retain their existing schemas: no raw keyboard events or capture tokens are persisted or logged.

Main/store owns `settings.general.shortcut`. Default is `RightAlt`. The renderer owns only an unsaved draft. A main-owned controller serializes shortcut reconfiguration and temporary capture suspension. Failed registration or persistence keeps the prior saved setting and restores its listener; a failed restoration is visible as unavailable, never claimed registered.

The existing store commit is synchronous and atomic; the controller does not await between commit and adopting the prepared binding. Main rechecks recording/busy state inside that commit callback. Equivalent modifier aliases/order share one canonical OS registration, while the saved display spelling is retained. A native failure latch prevents a ready-then-exit race from being marked healthy.

## Contracts

- Canonical validation accepts `RightAlt`, standalone F1-F24 except reserved F12, and modifier combinations (Control/Ctrl/CommandOrControl, Alt, Shift, Super/Command) with Space, A-Z, 0-9, F1-F24 except F12, or Tab/Enter/Backspace/Delete/Insert/Home/End/PageUp/PageDown/Up/Down/Left/Right. Duplicate modifier aliases, plain text keys, Ctrl+V and common OS-reserved combinations are rejected. Fn is not exposed by standard keyboard events. Ordinary combinations do not distinguish left/right modifiers; standalone Right Alt does.
- Right Alt toggles once on a clean release. Holding it cannot repeatedly toggle. A chord with another key cancels the tap; AltGr sequences must not trigger recording. Injected paste events do not activate the native listener. The hook passes ordinary typing through and must avoid activating the target's Alt menu on a consumed recording tap. Native implementation details and their validation are recorded before acceptance.
- Native helper is a hidden project-local executable, with a ready handshake, minimal hook callback, bounded stdout messages containing only ready/activation/error, stdin EOF and parent-process lifetime cleanup. Main stops it on suspension/reconfiguration/quit. There is no keyboard event log. Failure is visible; no silent alternate shortcut.
- `beginShortcutCapture()` -> `{token:string}` after the old listener has stopped. Only when app focused and no recording/inference is active. One capture at a time; short bounded lease. `endShortcutCapture({token})` -> snapshot. Stale tokens cannot resume another capture. Main also releases capture on blur/hide/reload/renderer crash/lease expiry. Capture state is ephemeral.
- Snapshot runtime adds `shortcutSuspended:boolean`. Monitoring describes capture as temporarily paused rather than broken registration. Main uses current effective setting for tray and HUD.
- UI has a read-only key display, a record button, and reset to Right Alt. Wait for suspension acknowledgement before accepting keyboard events; ignore repeats/composition; commit a candidate only after release. Escape/blur/navigation cancel capture. Captured shortcut changes only the draft until Save; preserve other unsaved settings and API key drafts. Pending capture ignores global toggle events.
- Store adds private root `migrations.rightAltDefault:1`. Missing marker migrates only literal old default `CommandOrControl+Alt+Space` once; other custom values are preserved. Mark all valid old states once, atomically with existing autoPaste/delivery migration. New files include marker. Later choosing the former default is preserved. Unknown/corrupt migration state is rejected without overwriting the file. This cannot distinguish an explicitly selected literal old default from the original default.
- Load compatibility: stored shortcuts with valid grammar that are now reserved remain readable and displayable, so the application can open and the user can choose a replacement. Only store initialization calls `validateSettings(value,{allowReservedShortcut:true})`; `formatShortcut` also permits reserved values. Ordinary `parseShortcut`, runtime registration and `saveSettings` remain strict. Unrecognized or malformed shortcuts still fail without replacing the file. Retained reserved values must appear unavailable rather than registered, and a failed attempt to restore that old listener after key capture must not discard the user's valid replacement candidate.

## Connected file checklist

- Core: core/contracts.cjs, core/shortcuts.cjs, core/store.cjs, tests/core.test.cjs and shortcut validation/migration tests.
- Native: native/ShortcutBridge.cs, native shortcut fixture/self-tests; no weakening of FocusBridge.cs paste checks.
- Desktop: desktop/shortcut-controller.cjs, desktop/main.cjs, desktop/preload.cjs, desktop/hotkey.cjs, scripts/build-native.cjs, scripts/package-win.cjs, packaging/controller tests.
- UI: renderer/app.js, renderer/shortcuts.js, renderer/styles.css; capture and draft tests.
- Validation/docs: desktop/smoke.cjs, desktop/native-smoke.cjs, dedicated shortcut smoke tests, README.md, agent.md, SPEC.md and test records.

## Old logic removal

Remove raw accelerator text entry, old-default labels/tooltips and direct synchronous binding in main. Keep Electron registration for ordinary accelerators and its physical-release repeat gate; Right Alt uses its own native release semantics. Do not leave two listeners active for one setting. Do not overwrite custom settings at every startup. Historical test reports retain their original shortcut and date.

## Acceptance and failure checklist

1. New install defaults Right Alt; exact old default migrates once; custom shortcuts/secrets/history survive; migration write failure preserves bytes and keeps store unready.
2. Right Alt clean tap starts/stops from a controlled external input without opening its menu or stealing focus; left Alt, holds, chords, AltGr and injected Ctrl+V do not cause unwanted toggles.
3. UI records Right Alt, supported combinations and function keys; reset, Escape, blur, navigation, save, reload and stale lease paths restore listening. No recording starts while capturing. Invalid/reserved/busy shortcuts show useful errors and retain old configuration.
4. Save rollback, helper missing/timeout/crash, startup readiness and app exit are handled without leaked listeners. Runtime/health reflects actual status. Retry is an explicit save/restart, not a busy loop.
5. Existing automatic paste target/clipboard/focus/privileged-control checks remain intact; no Enter is sent. Session/history/export/monitor behavior regresses cleanly.
6. Unit tests, actual Windows native + Electron checks, UTF-8 re-read and rebuilt portable EXE results are recorded in project docs before any tested claims. Clearly distinguish synthetic keyboard/state-machine tests from physical keyboard checks.

Reference: [Microsoft low-level keyboard hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), [keyboard hook flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct), [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey).

## Native listener detail

`native/ShortcutBridge.cs` builds to `Murmur.Shortcut.exe`. `listen <ownerPid>` installs keyboard and mouse low-level hooks on its own message-loop thread. The callback maintains only held-key bits and a clean-tap flag; it never writes stdout synchronously, reads window text, records keys, or suppresses/replays ordinary typing. Other key events and mouse buttons/wheel cancel the candidate. Injected events cannot arm/activate; their modifier state is still tracked so AltGr's manufactured Ctrl cancels a Right Alt tap. Startup seeds held state and never arms a key already down.

On a clean Right Alt release, the callback sends unassigned `VK_E8` down/up before forwarding the original Alt release, to prevent the normal Alt menu action. This follows the documented [AutoHotkey menu-mask technique](https://raw.githubusercontent.com/AutoHotkey/AutoHotkeyDocs/v2/docs/lib/A_MenuMaskKey.htm); no AutoHotkey source is copied. [Microsoft currently lists E8 as unassigned](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes). Failure to inject the mask stops the listener and reports unavailable; it does not activate recording. Actual MenuStrip/focus behavior requires Windows fixture acceptance and is not established by the state-machine test alone.

Stdout is bounded NDJSON `{type:'ready'}`, `{type:'activate'}`, or `{type:'error',code:string}`. The adapter waits up to three seconds for ready, fails closed on malformed messages or exit, and performs bounded EOF/kill cleanup without automatic retries. EOF and owner process exit remove hooks. `self-test` exercises deterministic state transitions without installing hooks or injecting input.

In isolated smoke mode only, `listen <ownerPid> --test-mode` accepts stdin `{type:'testTarget',pid:number}` and treats fixture-tagged synthetic events as trusted only while that PID is foreground. The fixed tag is `0x4D555254`; menu masks use a separate tag. `PasteTarget.cs` offers only named fixed scenarios and checks its own foreground HWND before injecting. Production omits test mode and ignores those events. Synthetic fixture tests are reported separately from physical keyboard checks. Native ownership: `native/ShortcutBridge.cs`, `native/PasteTarget.cs`, `desktop/native-shortcut.cjs`, and `tests/native-shortcut.test.cjs`; existing paste helper checks remain unchanged.
