# Windows desktop integration smoke

Run: 2026-09-27T11:52:00.541Z
Electron: 40.2.1
Packaged executable: false

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
- FAIL: settings records keyboard events into draft, saves custom chord and resets to Right Alt — Shortcut UI did not settle
- FAIL: native fixture setup or cleanup — Controlled fixture needs foreground focus; native tests cannot run safely

Runs actual Electron with isolated project-contained test storage. Microphone test uses Chromium synthetic audio, not the physical microphone. ASR response comes from a loopback test server. Real speech/model inference is not verified by this test. Save-dialog selection is simulated; export uses actual IPC and filesystem writes. The optional OS global shortcut check requires two real key chords from the Computer Use driver, with its observed input focused in the controlled test fixture.
