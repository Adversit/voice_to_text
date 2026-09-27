# Renderer verification record

Date: 2026-09-27. Scope: renderer session lifecycle and automatic-paste UI extension.

## Executed checks

| Check | Result | Evidence / limit |
| --- | --- | --- |
| `node --check renderer/app.js` | Exit 0 | JavaScript syntax only. |
| `node --check renderer/audio.js` | Exit 0 | JavaScript syntax only. |
| Explicit UTF-8 reread of app.js, styles.css, audio.js | Passed | Fatal UTF-8 decoding; no replacement character or runs of four question marks. Final CJK counts: app.js 2958, styles.css 0, audio.js 120. The last app.js wording edit was UTF-8 reread and syntax-checked again (exit 0). |
| Renderer session control probe | 8 scenarios passed, exit 0 | Executed actual app.js functions in a Node VM with fake IPC and fake microphone; rendering and toast were replaced with no-ops. No real microphone, native target, clipboard, or OS focus was used. |

The Node VM probe read app.js as UTF-8, removed its two imports and final application bootstrap, supplied a fake MicrophoneRecorder and envelope-returning window.murmur, and invoked the actual toggleRecording/cancelActiveRecording functions. Its output was:

```text
PASS button capture handshakes ready and sends session on stop
PASS shortcut trigger preserves eligibility
PASS microphone denial cancels main session
PASS short audio cancels without transcription
PASS cancel during capture handshake never opens microphone
PASS cancel during pending microphone never announces ready
PASS ready failure disposes microphone and cancels
PASS inference rejection cancels session and releases busy state
TOTAL 8 passed; fake IPC/microphone only; no native focus or real recording tested.
```

The delayed-handshake and delayed-microphone scenarios used controllable unresolved promises. Assertions checked session IDs, cancel calls, absence of transcription/ready calls where inappropriate, and final renderer recording/busy/session state. This is a control-flow probe, not an Electron integration test.

## Implementation reviewed, still requiring native acceptance

- beginRecording precedes microphone access; recordingReady follows successful microphone start; transcribe carries the canonical session ID.
- Explicit cancellation, permission failure, too-short audio and request failures release the microphone and request session cleanup. If cleanup itself fails, the session ID is retained and cleanup is retried before a later start.
- Background render only restores a DOM caret if document.hasFocus() is already true. Real Windows focus preservation requires the native acceptance pass.
- autoPaste setting is part of the canonical settings draft and save payload. Missing native helper produces a visible clipboard fallback notice.
- Result and history expose persisted delivery status and reason. Demo and manual editing do not trigger a paste request from renderer.
- The UI explains toggle shortcut behavior, the default Ctrl+Alt+Space combination, no standalone Fn support, no Enter submission, and manual-copy fallback.

## Not verified by this record

Actual microphone permission UI or speech capture; accuracy or latency; clipboard contents; native shortcut registration; HUD focus behavior; automatic paste into an external Windows control; focus/password/elevation safeguards; updated renderer layout in a real window. See the root desktop/native test records for their separately executed checks.

## Final display refinement

Inspected the supplied native screenshots `artifacts/screen-device.png`, `artifacts/screen-workbench.png` and `artifacts/screen-models.png`. The device screenshot showed three GPU names concatenated into the large heading; supporting descriptions were visibly pale.

Changed only display markup and styling: a NVIDIA adapter with known positive VRAM is primary, then any known-VRAM adapter, then the first reported adapter. Every other adapter remains visible below in smaller text with its own VRAM status. Supporting captions use a darker muted green. APIs, recording and delivery logic were unchanged.

Executed after this change:

- `node --check renderer/app.js`: exit 0.
- Fatal UTF-8 reread: app.js CJK count 2964, styles.css 0; no replacement characters or runs of four question marks.
- Actual renderDevice function in a Node VM: four markup probes passed (known-VRAM NVIDIA priority/all other names retained; known-VRAM fallback without NVIDIA; empty list; HTML escaping of adapter names).

Updated native screenshot review is pending the main agent's final desktop pass. The four probes verify display construction and escaping, not pixel rendering or hardware detection.

## Monitoring UI extension

Date: 2026-09-27. Implemented against `MONITORING-SPEC.md`. The renderer adds navigation, four resource cards, a selected-metric trend for at most 60 samples, configuration health, up to 100 task entries with seven stage slots, fixed Chinese error-code explanations, monitoring alerts, resource pause/resume, and manual sampling. Missing values stay unknown. Task records and health are provided by main; renderer does not invent connection state or poll resources.

Executed checks:

- `node --check renderer/app.js` and `node --check renderer/icons.js`: both exit 0.
- Fatal UTF-8 reread of index.html, app.js, styles.css and icons.js: valid; no replacement characters or four-question-mark damage runs. CJK counts: 199, 4289, 0, 0 respectively.
- Static search of app.js found monitoring access only through getMonitoring/refreshMonitoring/setMonitoring and onMonitoring; no setInterval.
- Nine Node VM probes against actual renderer functions and subscription bootstrap passed, exit 0. DOM, rendering side effects and IPC were mocked. Scenarios: event updates leave settings draft untouched; only monitoring page rerenders; null resource values stay null while known memory ratio is derived; null trend samples create gaps; missing snapshot renders a recoverable empty state; sample limit 60 and escaping of alert/health content; task limit 100 and unexecuted stages; envelope APIs for get/refresh/pause without settings changes; all four event subscriptions unsubscribe on unload.
- Seven further Node VM probes passed, exit 0. Cancellation branches send exactly canceled/microphone/short/error/error for explicit cancellation, microphone failure, short audio, ready failure and inference rejection, clearing the UI session in each case. Known monitoring codes have fixed Chinese explanations and unknown/prototype-property codes use the generic fallback. Task error rendering includes the code while ignoring injected exception text and transcript fields.

These 16 probes do not verify real resource sampling, native event timing, microphone permissions, OS focus or pixel layout. Actual Electron monitoring screenshots and resource/IPC tests are handled by the main agent and must be reported separately. No model was downloaded or queried by these renderer probes.
