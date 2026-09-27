# Windows global shortcut and paste verification

Run: 2026-09-27T10:10:37.241Z
Electron: 40.2.1

- PASS: isolated preload and initial snapshot
- PASS: real hardware detection
- PASS: explicit demo routes through IPC, persists and copies
- PASS: settings round trip independent stages
- PASS: empty audio rejected, not replaced with demo
- PASS: Windows encrypted credential round trip without exposing key
- PASS: synthetic microphone records PCM16 16k WAV and releases every track
- PASS: renderer contains navigation and populated content
- PASS: recording session rejects stale/empty readiness and cancels cleanly
- PASS: all five desktop pages render and expose functional controls
- PASS: OS global shortcut starts and stops synthetic microphone with external input focused
- PASS: real Windows paste into controlled input via session -> loopback ASR -> clipboard -> SendInput
- PASS: changed focused input skips paste and retains transcript
- PASS: native capture rejects password and read-only test controls
- PASS: native clipboard hash mismatch sends no input

Runs actual Electron with isolated project-contained test storage. Two global shortcut chords were sent through the Computer Use driver with the observed controlled fixture input focused. The complete renderer microphone, IPC, loopback response and native paste chain passed; the fixture contents were asserted. Microphone audio was synthetic, not physical speech. Real speech/model inference is not verified by this test.

A later packaged run was stopped when the user pressed Escape. Its processes were closed and that interrupted run was not counted as a passing packaged verification. Subsequent application-owned automated runs are recorded separately.
