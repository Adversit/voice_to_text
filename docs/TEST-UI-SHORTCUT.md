# Shortcut settings UI verification

Date: 2026-09-27. Contract: SHORTCUT-SPEC.md. These checks concern renderer capture/draft behavior. Native key delivery, Windows registration and physical keyboard acceptance are documented separately by the main agent.

## Changes

- Replaced editable accelerator text with read-only keycaps, a capture button, Cancel and reset to RightAlt.
- Shared renderer formatter displays RightAlt as 右 Alt and formats footer/workbench/settings consistently; retained legacy reserved strings remain displayable.
- Capture waits for main suspension acknowledgement, uses event.code, ignores repeat/composition, handles AltGraph explicitly and waits for all keys to release.
- A candidate changes only the unsaved shortcut draft. Other settings and API-key drafts remain intact. Save remains the persistence action.
- Capture blocks recording toggles throughout acquisition, active capture and release. Escape, blur, hide, navigation, reset, save, unload and lease expiry release or cancel capture. A canceled pending acquisition releases the eventual token.
- Ordinary modifier combinations are side-insensitive; standalone Right Alt is side-specific. Unsupported and reserved candidates remain editable through another attempt without replacing the draft.

## Executed results

Command: `node --test tests/ui-shortcuts.test.cjs`

Result: 11 tests passed, 0 failed, 0 skipped; exit 0. Includes 1,184 combinations compared with core/shortcuts.cjs canonical validation.

1. Renderer/core display parity, including legacy reserved values.
2. Capture/core grammar parity for supported keys and modifier sets.
3. Standalone Right Alt release, held-key repeat suppression and side-insensitive ordinary modifiers.
4. Full chord release, Escape reset, AltGraph rejection and composition handling.
5. Pending IPC ignores keys/toggles and releases a late token after cancellation.
6. Accepted candidate preserves other unsaved settings and API-key drafts.
7. Reserved candidate preserves draft and allows another attempt.
8. Escape, blur and navigation release the lease without replacing other edits.
9. Main lease expiry closes active capture and preserves edits.
10. Save ends capture before persistence; reset changes only the shortcut draft; unload releases its token.
11. Blur during an in-flight release drops the candidate rather than replacing the draft.

The helper tests are deterministic event/state checks. The integration-style tests evaluate actual app.js functions and event handlers in a Node VM with fake DOM, fake timers and envelope-returning IPC. No keyboard events are sent to Windows, and no microphone or model is used.

Static verification:

- `node --check renderer/app.js`: exit 0.
- `node --check renderer/shortcuts.js`: exit 0.
- Fatal UTF-8 reread passed for app.js, shortcuts.js, styles.css and ui-shortcuts.test.cjs. No replacement character or runs of four question marks. CJK counts: 4549, 148, 0, 0 respectively.
- Search confirmed removal of the old raw shortcut input, old-default literal and separate CommandOrControl display replacement from app.js.

## Pending outside this record

Actual Electron key capture and screenshot, system focus/blur timing, helper-unavailable restoration, native clean Right Alt tap/hold/chord/AltGr behavior, actual user-keyboard input and rebuilt portable package. Passing the VM checks does not prove those behaviors.
