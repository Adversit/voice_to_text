# Windows desktop integration smoke

此文件保留中间开发轮次的失败诊断。测试夹具焦点和重载等待问题的后续处理见 TEST-RECORD.md；最终 17 项全部通过的实际 Windows 包结果见 [TEST-PACKAGED.md](TEST-PACKAGED.md)。

Run: 2026-09-27T10:41:45.610Z
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
- FAIL: real Windows paste into controlled input via session -> loopback ASR -> clipboard -> SendInput — 当前控件无法确认可编辑，请手动粘贴。

false !== true

- FAIL: changed focused input skips paste and retains transcript — Expected values to be strictly equal:

false !== true

- PASS: native capture rejects password and read-only test controls
- FAIL: native clipboard hash mismatch sends no input — 当前控件无法确认可编辑，请手动粘贴。
- FAIL: renderer reload interrupts monitoring and prevents late ASR auto-paste — Expected values to be strictly equal:

false !== true


Runs actual Electron with isolated project-contained test storage. Microphone test uses Chromium synthetic audio, not the physical microphone. ASR response comes from a loopback test server. Real speech/model inference is not verified by this test. Save-dialog selection is simulated; export uses actual IPC and filesystem writes. The optional OS global shortcut check requires two real key chords from the Computer Use driver, with its observed input focused in the controlled test fixture.
