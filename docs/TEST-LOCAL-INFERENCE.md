# Real offline local inference acceptance

Recorded: 2026-09-27T17:10:34.716Z.

Command: `node scripts/verify-local-models.cjs`. This command does not download fixtures, weights or dependencies.

Result: **7 passed, 0 failed**.

| Check | Result | Elapsed | Free RAM before → after |
| --- | --- | --- | --- |
| Pinned fixture and inference model hashes | PASS | 0.53 s | 3.36 → 3.34 GiB |
| Project PyAV offline audio conversion | PASS | 0.29 s | 3.34 → 3.33 GiB |
| Silero ONNX detects public speech | PASS | 0.37 s | 3.33 → 3.31 GiB |
| Silero ONNX rejects two-second silence | PASS | 0.30 s | 3.31 → 3.31 GiB |
| Production provider CPU int8 ASR | PASS | 3.21 s | 3.31 → 3.3 GiB |
| Production provider CUDA float16 ASR | PASS | 3.16 s | 3.3 → 3.3 GiB |
| Isolated history and content-free monitor trace | PASS | 0.00 s | 3.3 → 3.3 GiB |

## Earlier acceptance attempts

- 2026-09-27T16:55:33.572Z: CTranslate2 4.7.1; 5 passed / 2 failed. Production provider CPU int8 ASR: RUNTIME_RESPONSE (native exit 0xC0000005); Production provider CUDA float16 ASR: RUNTIME_RESPONSE (native exit 0xC0000005)
- 2026-09-27T17:03:10.009Z: CTranslate2 4.8.2; 5 passed / 2 failed. Production provider CPU int8 ASR: RUNTIME_RESPONSE (native exit 0xC0000005); Production provider CUDA float16 ASR: RUNTIME_RESPONSE (native exit 0xC0000005)

The initial 4.7.1 runtime completed imports and NumPy audio conversion, then crashed with Windows access violation at `ctranslate2.models.Whisper` construction. A separate faulthandler diagnostic also reproduced this after clearing PYTHONHOME/PYTHONPATH and disabling the user site. The failure was recorded as 5 passing checks and 2 failed ASR checks before the project-only runtime update; it is not erased by later success. This observation does not prove the exact upstream defect responsible.

## Source and inputs

The existing [OpenAI Whisper JFK fixture](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/tests/jfk.flac) is pinned to revision `86098128c0b4f24f0e2aa2994de830614b474227`, 1,152,693 bytes and Git blob `e44b7c13897eae7f78beb220c61fe77429a3961d`. The driver verifies it before conversion. Its SHA256 is `63a4b1e4c1dc655ac70961ffbf518acd249df237e5a0152faae9a4a836949715`. Missing or mismatched input fails; no replacement download occurs.

PyAV converted 176000 samples (11 seconds) to 16 kHz mono PCM16 WAV in memory. Silence is a separate two-second all-zero WAV. Versions: python 3.12.14, av 16.1.0, numpy 2.5.3, onnxruntime 1.20.1, faster-whisper 1.2.1, ctranslate2 4.8.2.

Before the final passing run, the project `.venv` was rebuilt on CPython 3.12.14 instead of the Anaconda Python 3.12.4 base, using the same cached dependency wheels. The previous environment was preserved under `cache/venv-anaconda-backup-20260928`. Updating CTranslate2 alone had not resolved the crash. The new environment passed actual inference; these checks do not independently prove which old interpreter/CRT component caused the access violation. Preparation details and dependency provenance are recorded in `TEST-LOCAL-MODELS.md`. No production inference code was changed to obtain this pass.

ASR inference files and Silero ONNX are compared with the pinned project manifest before loading. File hashes and stage outputs are stored in ignored `artifacts/local-model-check/inference-results.json`. Qwen GGUF is not loaded; it still requires a separate local polish server.

## Real execution and limits

All stages run serially through production `runLocal`/`runtime/local_inference.py`; ASR additionally uses production `createProviders`, a real isolated store and monitor trace. The literal `python` setting is resolved to project `.venv/Scripts/python.exe`. No production/user settings or history are changed. Test history and monitor files stay under `artifacts/local-model-check/inference-store`. No Electron, microphone, clipboard, keyboard helper or cloud/polish service participates.

Python uses production `inferenceEnv`; the runner reasserts project-contained cache/temp directories, offline flags and socket denial. The driver also blocks Node HTTP/HTTPS/fetch calls. CPU runs int8; CUDA runs float16. Both use the inherited default PATH without a test-specific CUDA DLL override. A capability probe alone is not treated as successful GPU inference.

- Production provider CPU int8 ASR: "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."
- Production provider CUDA float16 ASR: "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."

Timings include process/model startup and do not establish steady-state throughput. The public English fixture is a limited functional check; Chinese speech quality, physical microphone capture, long sessions, arbitrary audio, real cloud APIs and local text-polish inference are not established. Structured errors are retained rather than replaced with demo text or a cloud fallback.

The reproducible script passed Node syntax checking. Script and report were explicitly read back with fatal UTF-8 decoding, with no replacement characters or repeated-question-mark damage. All model processes had exited before returning execution control to the main task.
