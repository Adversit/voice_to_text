# Core verification record

Date: 2026-09-27. Platform: Windows. Workspace: `G:\AI_projects\voice_to_text`.

## Automated contracts and persistence

Command: `node --test tests/core.test.cjs`

Result: **12 passed, 0 failed, 0 skipped**. Reported elapsed duration: 1033.0438 ms.

Follow-up run after enforcing coherent ASR mode/engine combinations: **12 passed, 0 failed, 0 skipped**, elapsed 1000.1693 ms. Cloud requires the OpenAI-compatible engine; local offers faster-whisper or whisper.cpp.

Explicit UTF-8 reread: all 7 owned source/test/report files decoded with fatal UTF-8 validation; no replacement characters or runs of question marks found.

Covered: traversal and sibling-prefix rejection; Windows ADS/trailing-space rejection; real directory junction and dangling-junction confinement; offline cache/TEMP environment; settings schema/endpoint validation; encrypted credential persistence, redaction, omission/removal; unavailable encryption and failed encryption preserving state; corrupt/unknown-schema files preserved; failed atomic rename preserving memory and cleaning temporary files; UTF-8 Chinese history round-trip; maximum history length and defensive copies; complete model-file inventory with junction rejection; low RAM/disk/unknown hardware recommendation branches; safe error envelopes.

Tests use temporary project-contained fixtures under `cache/`, removed after completion. Credential tests use an AES-256-GCM test codec; actual Electron safeStorage is an integration check owned by the desktop test record.

## Limits

No models, inference runtimes or packages were downloaded by core implementation or tests. Model presence checks mean nonempty required files exist; they do not prove loadability. RAM/VRAM thresholds are product estimates, not measured performance. Recognition, real microphone use, CUDA execution and packaged desktop behavior are not covered by this core test run.

Reference model pages inspected for catalog format and file conventions: [faster-whisper base](https://huggingface.co/Systran/faster-whisper-base/tree/main), [Qwen 2.5 1.5B GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/tree/main), [Silero VAD](https://github.com/snakers4/silero-vad). Sizes are rounded reference values.

## Actual hardware scan

Command: Node invoking detectHardware(createPaths(process.cwd())). Completed successfully.

```json
{
  "os": "Microsoft Windows 11 家庭中文版 10.0.26100 (x64)",
  "cpu": {
    "name": "AMD Ryzen 9 7940HX with Radeon Graphics",
    "cores": 32
  },
  "memory": {
    "totalGB": 15.2,
    "freeGB": 3
  },
  "gpus": [
    {
      "name": "OrayIddDriver Device",
      "vramGB": null
    },
    {
      "name": "NVIDIA GeForce RTX 4070 Laptop GPU",
      "vramGB": 8
    },
    {
      "name": "AMD Radeon(TM) 610M",
      "vramGB": null
    }
  ],
  "disk": {
    "freeGB": 857.5
  },
  "detectedAt": "2026-09-27T09:41:01.948Z",
  "warnings": [
    "部分显卡的独立显存未知；未使用可能截断的 WMI AdapterRAM 值。"
  ]
}
```

## Focused desktop/packaging review

2026-09-27: executed the actual preparation/packaging source in isolated project-contained VM fixtures (no runtime downloads or native process launch).

- REPRODUCED: prepare() returns an executable outside its project through runtime/electron junction; no path guard runs.
- REPRODUCED: prepare() treats an electron.exe-only directory as a prepared runtime; missing DLL/resources are not checked.
- REPRODUCED: package-win writes its full fixture bundle outside the project through a dist parent junction. Native icon invocation was mocked; filesystem copies were real.

Fixture directories were removed after assertions. Findings sent to root agent; these are reproduced pre-fix behaviors, not acceptance passes.

## Packaging regression verification after fixes

Command: `node --test tests/packaging.test.cjs`

Result on Windows: **9 passed, 0 failed, 0 skipped**, elapsed 207.9946 ms.

The actual updated preparation and packaging source was executed in isolated fixtures. Verified: external runtime junction rejection before trusting an executable; nested locale junction rejection; incomplete/empty/wrong-version runtime rejection; executable-only partial extraction now fails usefully and is preserved; missing local archive does not trigger extraction; nonempty partial extraction directories are preserved; recursive source/destination/nested-output junction escapes are rejected without altering external targets; normal recursive copies preserve UTF-8 content; packaging refuses a dist parent junction before writing; successful fixture packaging creates a root-relative marker resolving correctly and excludes data/model directories.

The two earlier reproduced issues are covered by these regression passes. Native ZIP extraction, actual EXE icon resource editing and launching the produced executable are not simulated as successful here: subprocess calls were observed through stubs in fixture tests. Actual desktop/package verification remains in the main test record. No model downloads occurred.

## Automatic-paste schema and delivery persistence

Command: `node --test tests/core.test.cjs`

Result on Windows after the automatic-paste extension: **19 passed, 0 failed, 0 skipped**, elapsed 1208.4908 ms.

Added coverage: explicit boolean autoPaste validation; default true; missing-field schema-1 migration committed once across repeated/reopened initialization; explicit false preserved; old history delivery normalized and persisted; existing settings, ciphertext and transcript text preserved; invalid persisted delivery rejected without overwrite; migration rename failure preserves original file and leaves store uninitialized; strict delivery statuses/reason limits; target handles/tokens/window-title/process-name fields discarded; delivery updates modify only delivery/warnings in place, retain identity/text/order, persist across reopen and do not duplicate records; missing record returns null; unchanged updates avoid additional commits; immutable-field updates rejected; failed delivery commit preserves previous state.

This run verifies storage and contracts only. Actual Windows focus capture, clipboard insertion and keyboard delivery are owned by the native/desktop integration checks and are not claimed from these tests.

## Native helper launch/package integration regression

Command: `node --test tests/core.test.cjs tests/packaging.test.cjs`

Result on Windows: **31 passed, 0 failed, 0 skipped**, elapsed 1160.3873 ms (19 core tests and 12 packaging/launch tests).

Packaging fixtures now observe buildNative calls and create a stub helper, verifying its bytes are included under resources/app/runtime/native/Murmur.Input.exe while user data/model directories remain excluded. Added assertions that packaging stops on helper compilation failure, development launch requests helper preparation, removes ELECTRON_RUN_AS_NODE before spawning Electron, and still starts in clipboard mode with a visible warning when helper compilation is unavailable. The actual source for both launch and package scripts is evaluated; compiler, icon tool and GUI subprocess calls are stubbed and are not native execution verification.

## Reserved paste shortcut regression

Command: `node --test tests/core.test.cjs`

Latest result: **22 passed, 0 failed, 0 skipped**, elapsed 1207.2392 ms.

Recording shortcuts now reject Ctrl+V, Control+V and CommandOrControl+V even when automatic paste is disabled, preserving the combination used by both manual paste and native delivery. Modifier aliases are compared using Electron's Windows mapping: Control/Ctrl/CommandOrControl are equivalent, and Command/Super are equivalent. Repeated modifiers or equivalent aliases are rejected regardless of order. Valid extra-modifier combinations remain accepted with their original display spelling; the existing primary-key whitelist remains unchanged.

Regression checks exercise each reserved alias, enabled/disabled auto-paste, reordered/duplicate aliases, valid extra-modifier alternatives and unsupported primary-key spellings. A real store test confirms a rejected reserved shortcut cannot change durable settings, in-memory shortcut or existing encrypted credentials. This is settings/persistence verification; no actual system shortcut or key injection is performed by these tests.

Mapping reference: [Electron keyboard identifier implementation](https://github.com/electron/electron/blob/main/shell/common/keyboard_util.cc).
