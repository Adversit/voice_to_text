# Windows packaged shortcut integration — completed run

Run: 2026-09-27T11:53:26.879Z. Electron 40.2.1. Packaged executable: true. Result: **22 PASS, 0 FAIL**. This preserves the completed run observed in the test process output before a later attempt replaced the latest-run report.

- PASS: isolated preload and initial snapshot
- PASS: real hardware detection
- PASS: explicit demo routes through IPC, persists and copies
- PASS: JSON/TXT export and cancellation through IPC with simulated save selection
- PASS: settings round trip independent stages
- PASS: empty audio rejected, not replaced with demo
- PASS: Windows encrypted credential round trip without exposing key
- PASS: synthetic microphone records PCM16 16k WAV and releases every track
- PASS: renderer contains navigation and populated content
- PASS: recording session rejects stale/empty readiness and cancels cleanly
- PASS: monitoring IPC samples real resources, pauses and records content-free tasks
- PASS: all six desktop pages render and expose functional controls
- PASS: shortcut capture IPC suspends recording, rejects stale lease and restores on blur
- PASS: settings records keyboard events into draft, saves custom chord and resets to Right Alt
- PASS: Right Alt native hook ignores left Alt, AltGr, chords and untrusted synthetic input
- PASS: Right Alt release and repeat suppression preserve menu focus through actual hook -> recording -> paste
- PASS: custom F8 accelerator saves, toggles and returns to native Right Alt
- PASS: real Windows paste into controlled input via session -> loopback ASR -> clipboard -> SendInput
- PASS: changed focused input skips paste and retains transcript
- PASS: native capture rejects password and read-only test controls
- PASS: native clipboard hash mismatch sends no input
- PASS: renderer reload interrupts monitoring and prevents late ASR auto-paste

Storage is isolated inside the project. Keyboard events use a fixed synthetic fixture tag accepted only in smoke mode for the foreground test PID. Microphone audio is synthetic and ASR is a loopback response. Computer Use activated the observed test window; no physical user keyboard, real speech or model inference was tested.

After this run, only shortcut label contrast and the screenshot settling delay changed. The subsequent build passed the 14 checks before native fixture setup; its foreground check could not proceed after Computer Use was stopped with Escape. See [latest attempt](TEST-PACKAGED.md) and [full explanation](TEST-SHORTCUT.md). That later attempt is not recorded as a complete pass.
