# Speech API adapter validation

Date: 2026-09-28. Scope: public provider registry, cloud request builders, existing provider integration and project Python selection. No real cloud calls, API keys, downloads, native compilation or full test suite were used in these commands.

Command: `node --test tests/speech-apis.test.cjs tests/providers.test.cjs`.

First run: 32 tests, 31 passed, 1 failed, 0 skipped. The new project-environment junction test expected `PATH_UNSAFE`, while the existing Node path contract correctly reports `UNSAFE_PATH`. Corrected the test assertion; no path behavior was changed.

Second run: exit 0; 32 tests, 32 passed, 0 failed, 0 skipped; reported duration 1293.8656 ms.

Coverage:

- Exact four-supplier plus custom public catalog, detached nested metadata, official endpoint allowlists, HTTPS/custom route normalization and host/path/credential/query/control-character rejection.
- SiliconFlow's file/model-only multipart; OpenAI `gpt-transcribe` plural language field versus earlier models; Groq/custom multipart; DashScope regional nonstreaming audio JSON and optional language.
- WAV bytes survive multipart and Base64 construction; the maximum two-minute app PCM input fits DashScope's documented 10 MB encoded bound.
- Missing/invalid keys, invalid request settings, overlarge audio, empty/structured/overlarge text and safe error messages.
- Every provider route sends through a local loopback fixture using the real request transport abstraction. Assertions cover selected routes, Bearer headers, returned text, one history insertion, no key/endpoint/audio leakage into records, and content-free stage callback results. Missing key sends no request.
- Existing WAV/VAD validation, local whisper.cpp, cloud custom adapter, polish fallback, HTTP errors/redirect/timeout bounds, exclusive inference, history failure, Python subprocess behavior and stage ordering regressions.
- Default `python` prefers a present project environment, preserves explicit interpreter choices and rejects a project `.venv` junction escaping the project. Fixture files are confined to the project cache and removed after the tests.

Limits: cloud authentication, provider availability, quota, real speech recognition quality and microphone capture were not exercised. The Python selection tests do not prove optional inference dependencies load; actual model/runtime verification is separate.
