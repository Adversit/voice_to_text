# Windows input helper test record

Date: 2026-09-27. Host: Windows x64, existing .NET Framework 4 compiler.

Command: `node --test tests/windows-input.test.cjs`

Latest result: **8 passed, 0 failed, 0 skipped**, approximately 1.13 seconds.

Automated checks:

- Bounded HWND/PID/process-start/UIA-runtime-ID token validation.
- Missing native executable returns capture/paste fallback without throwing into the desktop UI.
- Invalid token, self-target and invalid clipboard hash refuse paste.
- Helper executable paths cannot leave this project.
- Actual local compilation of `Murmur.Input.exe` and the isolated `Murmur.PasteTarget.exe` test fixture using the existing C# compiler; no packages or runtimes downloaded.
- Actual hidden C# process rejects malformed/oversized input, unsupported command, missing owner PID and invalid target/hash before clipboard or input access.
- Actual hidden native paste process rejects a nonexistent target window; no external live application receives keys.
- Canceling an active native capture terminates its child before resolving a fallback result; the pending-child map is empty afterward. Main process can call `cancelPending()` on navigation, crash or quit.
- `key-release` validates a virtual key code in 1..255 and checks its physical key state without injecting keys. The actual native F24-up check returned true; invalid codes/missing helper returned false; canceling a pending check returned false after child exit. Native held-key polling is bounded to 3 seconds; a physically held shortcut/repeat sequence still needs OS integration verification.

Native safeguards implemented: capture foreground HWND, PID, process-start UTC ticks and focused UIA element runtime ID; reject application-self, elevated, disabled, non-editable and password targets; revalidate the same currently focused target; compare clipboard UTF-8 SHA256; wait at most 900 ms for Shift/Ctrl/Alt/Windows-key release; recheck focus, clipboard sequence and modifiers immediately before one Ctrl+V input batch. It never activates a user window, reads existing target text or sends Enter. Target identifiers are ephemeral and not written to history.

Actual pasted text, no-Enter behavior, changed-input identity, password/read-only target rejection and clipboard-race behavior require the desktop/fixture integration test. The tests above establish safe negative paths and native build, not full successful delivery. Native `pasted` means Windows accepted the four-key batch; the helper deliberately does not read target contents to confirm whether an arbitrary third-party application consumed the shortcut.

## Controlled fixture

Build: `node scripts/build-native.cjs --fixture`, or `buildNative({includeFixture:true})`.

Run `runtime/native/Murmur.PasteTarget.exe --output <absolute-project-contained-path>` with optional `--password` or `--read-only`. Its multiline primary textbox writes current UTF-8 text to the output path on changes, and `<path>.ready.json` contains its PID, HWND and whether initial foreground activation succeeded. The fixture accepts stdin `exit` to close, plus JSON lines for `focus`, `clipboard` and `read` commands documented in `native/PasteTarget.cs`. It has no network connection and sends no messages.

## References

- [Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput): batch delivery, held-key interference and integrity-level restrictions.
- [Microsoft UIA runtime IDs](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.getruntimeid): runtime IDs are opaque and may be reused, so the helper also binds HWND/PID/process-start identity.
- [Microsoft ValuePattern.IsReadOnly](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.valuepatterninformation.isreadonly): editable-control metadata checks.
