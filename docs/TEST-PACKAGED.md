# Windows desktop integration smoke

Run: 2026-09-27T10:47:42.659Z
Electron: 40.2.1
Packaged executable: true

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
- PASS: real Windows paste into controlled input via session -> loopback ASR -> clipboard -> SendInput
- PASS: changed focused input skips paste and retains transcript
- PASS: native capture rejects password and read-only test controls
- PASS: native clipboard hash mismatch sends no input
- PASS: renderer reload interrupts monitoring and prevents late ASR auto-paste

Runs actual Electron with isolated project-contained test storage. Microphone test uses Chromium synthetic audio, not the physical microphone. ASR response comes from a loopback test server. Real speech/model inference is not verified by this test. Save-dialog selection is simulated; export uses actual IPC and filesystem writes. The optional OS global shortcut check requires two real key chords from the Computer Use driver, with its observed input focused in the controlled test fixture.
