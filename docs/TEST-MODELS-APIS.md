# Models and API preparation integration record

Date: 2026-09-28 (Asia/Shanghai), Windows 11 x64, Node.js 22.14.0.

## Recorded results

- Final `node --test tests/*.test.cjs`: **178 passed, 0 failed, 0 skipped**, 4131.6245 ms. Raw output: ignored `artifacts/tests-models-apis.tap`. Covers prior recording/shortcut/delivery/history/monitor paths and new settings, protocols, UI and downloader behavior. The earlier 174/174 checkpoint preceded additional download locking/recovery regressions. Native compile probes ran after all Electron and model fixtures exited.
- Final `.venv/Scripts/python.exe -B tests/python-wheel-cache.py`: **3 passed**, 0.020 seconds, including interrupted/atomic wheel-cache writes.
- Final `node scripts/check.cjs`: syntax and UTF-8 re-read passed for **58 JavaScript files and 31 documents**. `git diff --check` passed; Git only reported configured CRLF/LF conversion notices.
- Hidden real Electron configuration fixture: **14 passed, 0 failed**, detailed in [TEST-API-DESKTOP.md](TEST-API-DESKTOP.md). Uses real preload/IPC/store/safeStorage and isolated project data; test listeners replace OS shortcuts and the window stays hidden. No recording, clipboard, cloud call or foreground desktop operation occurs.
- Credential migration and bad-state preservation: [TEST-API-STATE.md](TEST-API-STATE.md).
- Protocol request/response fixtures and Python selection: [TEST-SPEECH-APIS.md](TEST-SPEECH-APIS.md).
- UI draft isolation and provider metadata: [TEST-UI-APIS.md](TEST-UI-APIS.md).
- Actual model files and runtime preparation: [TEST-LOCAL-MODELS.md](TEST-LOCAL-MODELS.md). Real offline pipeline: **7 passed, 0 failed**, recorded in [TEST-LOCAL-INFERENCE.md](TEST-LOCAL-INFERENCE.md). An 11-second public English recording transcribed identically through production providers on CPU int8 (3.206 s) and CUDA float16 (3.163 s); these times include startup and are not a general benchmark. Silero accepted speech and rejected silence. Isolated history/monitor records also passed. No special CUDA/ISA override was used.
- The initial Anaconda-based environment crashed in model construction with both CTranslate2 4.7.1 and 4.8.2. The final project environment was recreated using an existing non-Conda CPython 3.12.14 base, the same verified model files and cached dependencies. Actual transcription passed only after this environment repair; prior failures remain documented. Global Python/system DLLs were not changed.

## Scope

No user API keys were supplied. Real cloud authentication, service reachability/quotas, billable transcription quality and physical microphone speech remain unverified. Qwen file verification is separate from loading it in a local text service. This increment does not repeat the prior foreground native paste acceptance; its historical result remains in TEST-PACKAGED-SHORTCUT-PASS.md. The current hidden fixture does not establish new OS shortcut/paste compatibility.

## Packaged application and model files

- `node scripts/package-win.cjs`: passed; rebuilt the Windows helpers and `dist/Murmur/Murmur.exe` with its original application icon. Raw build output is `artifacts/build-models-apis.log`.
- Packaged `dist/Murmur/Murmur.exe --api-smoke-test` launched through a hidden Node child process: **14 passed, 0 failed, exit 0**. Raw output: `artifacts/api-packaged-smoke.log`. The same fixture automatically overwrote TEST-API-DESKTOP.md with these results; its displayed development command is the equivalent fixture invocation, while this final run used the packaged EXE.
- Package byte comparison: all **40** files under core, desktop, renderer, assets, package.json and runtime/local_inference.py match their project sources. No models, data, cache or .venv directory is in resources/app. An initial one-line comparison command had a JavaScript parenthesis typo; corrected probe returned the above result without changing application files.
- Visually inspected the packaged hidden settings capture: provider/region/model controls, pending-key status and active Settings navigation are visible without plaintext secrets or layout overflow. Shareable isolated-fixture image: `docs/images/api-settings.png`.
- Final catalog/receipt check: exactly the three prepared models are discovered as installed: whisper-small, silero-vad and qwen-1.5b. Their verified files including license/readme total **1,605,879,904 bytes** under project models/. Main hashes match the pinned manifest; individual receipt timestamps and actual inference outcomes are in TEST-LOCAL-MODELS.md. No user settings were changed to select them automatically.
