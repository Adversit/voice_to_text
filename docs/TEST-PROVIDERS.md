# Provider test record

Date: 2026-09-27 (Windows, local project workspace).

Command: `node --test tests/providers.test.cjs`

Latest result after optional monitoring traces: **21 passed, 0 failed, 0 skipped**, total duration approximately 1.35 seconds (1353.1468 ms).

Covered behavior:

- Actual WAV parsing: PCM16 mono 16 kHz, additional chunks, typed-array offsets, duration derived from samples, malformed/truncated/empty/short/long/silent/oversized input.
- Local endpoint restriction, pinned localhost, cloud HTTPS requirement and rejection of credentials/query strings in URLs.
- Explicit sample demonstration independent of provider configuration; sample identification and history opt-out.
- Missing project model, independent VAD modes, no local-to-cloud fallback and no credential access for local requests.
- Loopback whisper.cpp multipart route and language; simulated cloud multipart route, API model name and authorization header. Cloud test redirects the transport internally to a local test server; it sends no real cloud traffic.
- Local text polishing request; polishing failure retains the original text and gives a warning; transcription history preserves raw text after failed polishing.
- Redirect refusal, HTTP errors without exposing response bodies, malformed JSON, response-size limit, absolute request timeout and absence of automatic retries.
- Concurrent task refusal and recovery, empty/oversized text, missing API key, history-write failure and unavailable Python executable.
- Actual Python process rejects malformed requests, unsupported operation, foreign root, escaping or hub-style model paths and missing model files before optional inference imports.
- Actual Python subprocess emits UTF-8 one byte at a time; Chinese text survives chunk boundaries. Runtime timeout terminates the child and waits for process close before releasing the task.

Second-pass regression: the first timeout-process test exposed a Windows directory lock after the promise rejected before the killed child had exited (15 passed, 1 cleanup failure). The adapter now waits for the child's close event on timeout or oversized output. The subsequent complete run produced 16/16 passes at that revision. ONNX models are loaded from file bytes, so Silero must be self-contained and cannot use external tensor paths; actual ONNX runtime loading remains unverified until its dependency and model are supplied.

No model, package, or inference dependency was downloaded or installed. Test fixture files are created under `cache/provider-tests/` and removed by each test after checking their containment.

Not verified: actual microphone speech, real cloud API authentication/inference, faster-whisper recognition accuracy, Silero ONNX execution, CUDA availability/performance or prestarted third-party model servers. These require user-supplied audio, credentials, model files and/or runtime dependencies. Passing adapter tests does not establish those behaviors.

## Optional monitoring trace regression

`transcribe(input, {trace})` and `polishText(input, {trace})` accept an optional main-owned callback `trace(name, action)`. The default executes the action directly. Enabled stages follow audio, VAD, ASR and polish order; disabled VAD/polish stages are omitted. Callbacks receive only the stage name and zero-argument action. Actions keep audio, provider responses and transcript results in provider-local variables and return no business payload to the monitor.

Five added tests, using only loopback test servers, verify ordered success, standalone polish, omission of disabled stages, equal business return fields with and without tracing, precise early termination for audio/VAD failures, original ASR exception propagation, and failed polish being observed by tracing before the existing raw-text fallback and history persistence. Trace metadata contains no test transcript or endpoint. All prior provider tests still pass without a trace argument.

These checks verify provider trace boundaries, not resource collection, monitor persistence or the desktop monitoring page; those are covered by their owning modules/integration records. No model or dependency downloads occurred.

## Implementation references

- [faster-whisper constructor and transcription API](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py): explicit local model directory, offline constructor option, mandatory local tokenizer to prevent its fallback lookup.
- [Silero reference ONNX wrapper](https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py): 16 kHz, 512-sample frames, 64-sample context and recurrent state.
- [whisper.cpp server API](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md): multipart WAV `/inference` route.

The whisper.cpp adapter uses the server's currently loaded model; history labels it as `whisper.cpp server`. The application cannot govern the model storage or cache of an independently started service. The same limitation applies to an independently started local polishing server. Direct faster-whisper and Silero loads are restricted to this project's `models/` and runner caches to this project's `cache/`.
