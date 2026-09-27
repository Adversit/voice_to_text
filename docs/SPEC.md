# Murmur / 轻声 — Windows prototype specification

Updated: 2026-09-27. Product: a personal, local-first Windows dictation application inspired by Typeless. This revision includes global shortcut recording and guarded automatic paste. Prototype does not download any model or inference dependency. UI language: simplified Chinese; brand: Murmur / 轻声.

## Implementation checklist

- [x] Desktop shell, tray, global toggle shortcut with repeat suppression, guarded clipboard/paste, focus-free HUD and portable Windows packaging.
- [x] Recording workbench, deliberate sample demonstration, transcript editor, history/export.
- [x] Separate ASR, VAD and text-polishing configurations with local and cloud routes.
- [x] Actual hardware inspection and conservative model recommendations.
- [x] Project-contained settings, model/cache storage and offline local inference runner.
- [x] Resource monitoring, private task diagnostics, stage timings and interruption handling.
- [x] Automated contracts, storage, failure-path and actual Windows integration verification recorded in TEST-RECORD.md; physical microphone/model acceptance explicitly deferred.

## Two-pass review

Pass 1: repository was empty at baseline. Current chain: shortcut -> repeat suppression -> main-owned recording session/native target capture -> microphone -> 16 kHz mono PCM WAV -> isolated Electron preload -> main-process service -> optional VAD -> selected ASR -> optional polish -> initial history insertion -> clipboard and guarded native paste -> delivery update -> editor/history/export. Button recording skips external target capture; demo and manual polish never auto-paste. Model downloads are disabled, not merely hidden. No cloud fallback from local failures.

Pass 2: connected surfaces include navigation/record/cancel controls, shared schema, main-process state, recording sessions and epochs, adapters, IPC validation, Python runner, JSON persistence, encrypted API credentials, history/export, native tray/shortcuts, hotkey repeat gate, Windows UI Automation/SendInput helper, nonfocusable HUD, hardware subprocesses, cache variables, packaging root discovery, additive schema-1 migration and tests. Existing schema-1 data now requires explicit migration of autoPaste and delivery; unknown versions remain errors.

## Source of truth and storage

Electron main process owns canonical settings/history, busy state, the active recording session and its ephemeral native target. Renderer owns microphone acquisition and display/draft state; it receives a session ID but never the target token. Settings schemaVersion=1; settings, encrypted credentials and history share atomic UTF-8 JSON writes in data/state.json. Unknown schema versions fail visibly instead of reset. Credentials encrypted with Electron safeStorage, never returned to renderer or put in logs/history. Renderer only receives hasKey flags. Mutable storage is fixed under PROJECT_ROOT: models/, data/, cache/, runtime/. Root in development is package root; portable build has a project-root.json relative marker resolving from dist/Murmur/resources/app to the original project root. It never silently falls back to C: or appData and does not depend on process cwd. Reject paths escaping root, absolute model paths outside root, symlink/junction escapes and traversal, including nested Electron cache directories and recursive packaging copies. Child environments define HF_HOME, HF_HUB_CACHE, HUGGINGFACE_HUB_CACHE, TRANSFORMERS_CACHE, TORCH_HOME, XDG_CACHE_HOME, PIP_CACHE_DIR, TEMP/TMP/TMPDIR under the project, with HF_HUB_OFFLINE=1, TRANSFORMERS_OFFLINE=1, HF_DATASETS_OFFLINE=1 and PYTHONDONTWRITEBYTECODE=1.

## Contracts

CommonJS backend, ES module frontend, zero third-party JavaScript dependencies. Electron 40.2.1 already cached locally. No npm install required for prototype. Native shell sandbox=true, contextIsolation=true, nodeIntegration=false; custom murmur://app protocol and strict CSP. Preload exposes window.murmur methods with envelopes `{ok:true,data}` or `{ok:false,error:{code,message}}`.

Snapshot: `{settings,history,models,hardware,paths:{root,models,data,cache},runtime:{platform,version,shortcut,shortcutRegistered,encryptionAvailable,downloadsEnabled:false,autoPasteAvailable:boolean}}`. autoPasteAvailable means the native helper is present on Windows, not that every target control is compatible.

Monitoring adds `snapshot.monitor` and the `getMonitoring`, `refreshMonitoring`, `setMonitoring`, `onMonitoring` bridge methods. Main owns all samples, task lifecycles and timing; provider stage hooks never receive or persist transcript data. The full source-of-truth, schema, bounds, file list, acceptance and failure contract is [MONITORING-SPEC.md](MONITORING-SPEC.md). It is additive to settings/history rather than a second store for those objects.

Settings: `{schemaVersion:1,asr:{mode:'local'|'cloud',engine:'faster-whisper'|'openai'|'whisper-cpp',modelId:'whisper-base',endpoint:'http://127.0.0.1:8080',apiModel:'whisper-1',language:'auto'|'zh'|'en',device:'cpu'|'cuda',pythonPath:'python'},vad:{mode:'energy'|'silero'|'off',modelId:'silero-vad',threshold:0.015},polish:{mode:'off'|'local'|'cloud',endpoint:'http://127.0.0.1:8081/v1',apiModel:'qwen2.5-1.5b',modelId:'qwen-1.5b',style:'natural'|'concise'|'formal'},general:{autoCopy:true,autoPaste:true,saveHistory:true,shortcut:'CommandOrControl+Alt+Space'}}`. Local ASR supports faster-whisper/whisper-cpp; cloud requires openai. VAD threshold is finite and between 0.001 and 0.2. Ctrl+V and equivalent modifier aliases are reserved for delivery and cannot be the recording shortcut.

Renderer API:
- getSnapshot() -> snapshot (hardware may initially be null; refreshHardware is explicit and returns snapshot).
- saveSettings({settings,keys?:{asr?:string,polish?:string}}) -> snapshot; omitted key preserves, empty string removes. settings includes hasKey? for display, stripped before persistence.
- refreshHardware() -> snapshot.
- beginRecording({trigger:'button'|'shortcut'}) -> `{sessionId,autoPasteEligible,reason}`; reserve the main-owned session before any asynchronous capture.
- recordingReady({sessionId}) -> null after microphone acquisition, requiring an existing matching session.
- cancelRecording({sessionId}) -> `{canceled:true}`; clear a matching session and HUD on permission failure, short/null audio or user cancellation.
- transcribe({audio:ArrayBuffer,durationMs:number,sessionId?:string}) -> `{text,rawText,record,warnings:string[],delivery}`; PCM16 WAV mono 16000Hz, 0.3–120 seconds, max 4 MB. Actual WAV header/duration validated server-side. No silent network retries. A session ID is consumed once; sessionless requests cannot auto-paste but may copy according to autoCopy.
- polishText({text:string}) -> `{text,warnings:string[],delivery}`. Nonempty <=20000 chars; preserves original on polish failure. Never auto-pastes.
- demo() -> same result shape as transcribe, record.source='demo', always explicit and independent of selected engines; no network/microphone or automatic paste.
- deleteHistory({id:string}) -> snapshot; clearHistory() -> snapshot; exportHistory({format:'json'|'txt'}) -> `{canceled,path?}` native save dialog.
- copyText({text:string}) -> `{copied:true}`.
- openFolder({kind:'models'|'data'|'root'}) -> void.
- windowAction({action:'minimize'|'maximize'|'close'}) -> void; close hides to tray; Quit via tray.
- onToggleRecording(callback) -> unsubscribe with payload `{trigger:'shortcut'}`; onStateChanged(callback) -> unsubscribe; onNotice(callback) -> unsubscribe.

Delivery: `{status:'pasted'|'copied'|'skipped'|'failed'|'not-requested',reason:string}`; stored reason length <=2000. History record: `{id,createdAt,text,rawText,durationMs,source:'local'|'cloud'|'demo',model,label?,warnings:[],delivery}`. No audio, key, target HWND, process name or window title is stored in history. Max 200 records; JSON and TXT exports include public delivery outcomes and warnings, never settings/secrets/target tokens. Catalog record: `{id,name,task:'asr'|'vad'|'polish',family,sizeMB,minRamGB,recommendedRamGB,minVramGB,relativePath,description,sourceUrl,installed:boolean,recommendation:{level:'recommended'|'caution'|'avoid'|'unknown',reason}}`; relativePath is relative to models/. Installed means nonempty required files exist, not proven runtime-loadable. Hardware `{os,cpu:{name,cores},memory:{totalGB,freeGB},gpus:[{name,vramGB:number|null}],disk:{freeGB:number|null},detectedAt,warnings:[]}`; cores are logical processors. Unknown GPU VRAM stays null; WMI 32-bit AdapterRAM is not reliable for large GPUs. Use nvidia-smi when available. Recommendations are estimates, not performance claims; runtime/CUDA availability is separate.

Backend interface for desktop entry:
- core/paths.cjs: createPaths(root), assertContained(base,candidate), inferenceEnv(paths).
- core/store.cjs: createStore(paths,secretCodec) -> {init(),getSettings(),getPublicSettings(),saveSettings(settings,keys),getSecret(name),getHistory(),addHistory(record),updateHistory(id,{delivery?,warnings?}),deleteHistory(id),clearHistory()}; codec {encrypt(string):string,decrypt(string):string,available():boolean}; methods are synchronous and may be awaited by caller. updateHistory returns the updated record or null when absent, rejects other patch keys, preserves record identity/text/order and avoids duplicate/no-op commits.
- core/catalog.cjs: getModels(paths,hardware), recommend(model,hardware).
- core/hardware.cjs: detectHardware(paths) async.
- core/contracts.cjs: defaults(), validateSettings(settings), AppError(code,message), envelope(action) if needed.
- core/providers.cjs: createProviders({paths,store}) -> {transcribe({audio,durationMs}),polishText({text}),demo()}; provider handles history insertion, does not copy clipboard. Header constraints canonical in core/audio.cjs.
- core/delivery.cjs: deliverText({text,settings,session,clipboard,input}) -> Delivery; main performs delivery after initial provider history insertion and updates that same record.
- core/windows-input.cjs: createWindowsInput({paths,ownerPid,helperPath?}) -> {capture(),paste({target,clipboardHash}),available(),cancelPending(),waitForKeyRelease({keyCode})}; exact native contracts below.
- desktop/hotkey.cjs: createHotkeyGate({trigger,waitForRelease,available,getAccelerator}) -> {press(),cancel()}; keyCode(accelerator) supports Space, A-Z, 0-9 and F1-F24 as the final key.
- core/export.cjs owns history serialization shared by the native export handler and export regression tests; both formats preserve public delivery outcomes and warnings.

## Affected files (ownership)

Root integrator: desktop/main.cjs, desktop/preload.cjs, desktop/security.cjs, desktop/hotkey.cjs, desktop/overlay-preload.cjs, desktop/smoke.cjs, desktop/native-smoke.cjs, core/delivery.cjs, core/export.cjs, package.json, scripts/*, assets/*, docs/*, README.md, tests/desktop.test.cjs, tests/delivery.test.cjs, tests/hotkey.test.cjs, tests/packaging.test.cjs and export tests.
UI: renderer/index.html, renderer/app.js, renderer/styles.css, renderer/audio.js, renderer/icons.js and renderer/overlay.{html,js,css}. UI must follow contracts above; no changes to backend files.
State/hardware: core/contracts.cjs, core/paths.cjs, core/store.cjs, core/catalog.cjs, core/hardware.cjs, tests/core.test.cjs. Own schema and snapshots data, no desktop imports.
Inference: core/providers.cjs, core/audio.cjs, runtime/local_inference.py, tests/providers.test.cjs. Uses backend interface above, Node builtins only.

Native transport/runtime: core/windows-input.cjs, native/FocusBridge.cs, native/PasteTarget.cs, scripts/build-native.cjs, tests/windows-input.test.cjs. Build/launch packaging must copy the helper as well as the Python runner, validate existing Electron runtime completeness, and preserve the relative project-root marker.

## Old logic removal

None at the empty-repository baseline. This revision replaces the old unconditional copy-only completion with core/delivery.cjs and removes the earlier clipboard-only product restriction. Migrate old schema-1 autoPaste/delivery fields explicitly; do not create parallel default routes. Do not introduce browser-only storage, fake hardware, automatic model downloads, cloud fallback, demo text on real inference failures, persisted targets or model-ID-triggered model hub fetches. Packaged paths must not rely on process cwd. Defaults must be derived from contracts.cjs, not divergent copies in UI.

## Acceptance and failures

1. Launch actual Electron Windows window, native controls/tray/global shortcut; UI recording starts only on user action; microphone permission/absence is visibly handled. Stop releases media tracks. No double-start/startup shortcut races; busy controls disabled; two-minute limit enforced.
2. Explicit demo produces an identified sample transcript/history item, copy and export work; empty initial history is real; dates/totals derive from records.
3. Save/reopen settings retains three independent stage selections; API keys encrypted, redacted; unsupported schema/corrupt file surfaced.
4. Empty/short/silent/oversized/non-WAV audio fail usefully; missing model/runtime gives setup instructions, no download/network; local API endpoints loopback only; cloud requires HTTPS; redirects cannot silently leave local route. Request timeout and provider error surfaced; failed polish preserves raw transcript with warning.
5. Hardware populated from this machine, scan retries available; detection failure yields unknown/caution, never fake hardware. Conservative reserve for other applications; insufficient disk and low RAM warn.
6. Paths enforced in Node and Python; symlink/junction traversal blocked. Model directory stays empty for this phase; no downloader implemented. Local ASR can later use preexisting project model directories with faster-whisper local_files_only=True. Local VAD uses preexisting Silero ONNX. Polish connects to user's already-running loopback OpenAI-compatible service; this app never starts third-party downloads.
7. Test outcomes written to project record before claiming verification. Physical microphone speech, real recognition accuracy/speed, model loading and CUDA execution remain explicitly unverified until separately exercised with model files/API credentials. The prototype includes guarded automatic Ctrl+V after shortcut recording, but does not claim compatibility with every third-party control or full Typeless parity. No Enter/submission, hold-to-talk, independent Fn key, streaming mode, downloader, signed installer or updater is included.

## Sources consulted

- https://www.typeless.com/help/quickstart (product reference, not asset source)
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/ipc
- https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py
- https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/server.cpp
- https://github.com/snakers4/silero-vad
- https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF

## Global shortcut and automatic-paste lifecycle

The current contract includes Typeless-style shortcuts and automatic copy/paste into the target application's input box. Toggle shortcut remains configurable (default Ctrl+Alt+Space); Ctrl+V aliases are reserved, and Fn-only/hold-to-talk is unsupported. The hotkey gate triggers once per press and waits for physical final-key release to suppress repeated WM_HOTKEY messages. With no native helper, a 1.2-second quiet interval provides conservative repeat suppression, so rapid presses may be ignored. Testing may use a browser for layout, but OS focus and paste require Windows verification. Desktop development mode needs no distribution rebuild for renderer changes.

Canonical state: main owns a recording session, session epoch and ephemeral target token. Renderer owns microphone acquisition. Native Windows helper captures foreground HWND, process identity and focused UI Automation element identity without reading entered text. Target tokens are never persisted or exported. A single active session is reserved before asynchronous capture; settings changes and competing inference are rejected until it ends. Cancel clears the target; transcribe consumes the session even on failure. Renderer reload/crash and application quit increment the session epoch, clear active capture/HUD, cancel pending helper calls and invalidate automatic paste from an already-running inference result. Closing the window to tray does not cancel recording.

Lifecycle details:
- settings.general.autoPaste:boolean, default true. Existing schemaVersion=1 records missing it are normalized to true once and atomically persisted (explicit additive migration, no duplicate old route). Explicit false is preserved. A migration write failure leaves the old file unchanged and the store uninitialized; regular settings saves require an explicit boolean.
- beginRecording({trigger:'button'|'shortcut'}) -> {sessionId,autoPasteEligible,reason}. On shortcut capture external input without window activation. Button-triggered recording has no external target and only copies when autoCopy is enabled. Shortcut autoPaste always copies first, independent of the ordinary autoCopy switch.
- cancelRecording({sessionId}) -> {canceled:true}; call when permission fails, input too short or recording is canceled.
- recordingReady({sessionId}) -> null after microphone acquisition; focus-free HUD changes from preparing to recording. HUD is a separate noninteractive, nonfocusable window and never displays transcript text.
- transcribe input carries sessionId. A valid session authorizes result delivery to that captured target. Requests without sessions remain supported but never auto-paste. Transcribe never accepts an arbitrary HWND from renderer. Delivery checks the clipboard read-back matches the intended result, allowing Windows newline normalization, before passing its UTF-8 SHA-256 hash to native paste.
- main's onToggleRecording callback payload becomes {trigger:'shortcut'}.
- history/result.record gains optional delivery:{status:'pasted'|'copied'|'skipped'|'failed'|'not-requested',reason:string}. Absent in old history -> {status:'not-requested',reason:''}. Store adds updateHistory(id,{delivery,warnings}) to persist final delivery outcome after provider insertion; it returns null when user disabled history or record absent. No target handles/process names/window titles in history or exports.
- core/windows-input.cjs createWindowsInput({paths,ownerPid,helperPath?}) -> capture() => {target:null|object,reason:string}, paste({target,clipboardHash}) => {status:'pasted'|'skipped'|'failed',reason:string}, available()=>boolean, cancelPending()=>canceled-count, waitForKeyRelease({keyCode})=>boolean. helperPath defaults to root/runtime/native/Murmur.Input.exe and is confined to the project. Packaged code can use its bundled helper; smoke mode copies it into its isolated workspace. JSON stdin/stdout uses hidden subprocesses, a five-second timeout, output bounds and no shell.
- Native commands are capture, paste and key-release. Capture stdin {ownerPid}; paste stdin {target,clipboardHash,ownerPid}; key-release stdin {keyCode,ownerPid}, returning {released:boolean}. Response {ok:true,data:...} or {ok:false,error:{code,message}}. Targets contain only {hwnd,pid,processStartTicks,runtimeId}. Key-release observes the final key for up to three seconds per request; the gate continues suppressing repeats while held. Paste waits up to 900 ms for physical modifier release and rejects app-self, inaccessible/elevated, missing/reused, password/read-only/unverifiable targets, changed focus and clipboard hash/sequence mismatches. Recheck identity immediately before one Ctrl+V SendInput batch; never restore focus, send Enter or retry a paste. A pasted status means the complete batch was accepted, not that target text was read back. On clipboard change, report that the user must copy the transcript again.

Connected files for this path are listed in the ownership section, including the hotkey gate, HUD, native fixture, launch/build scripts, delivery/export modules, persistence and tests. Failure branches include startup cancellation before session capture returns, permission denial, short/null audio, repeated shortcut callbacks, failed helper compilation, disappeared target, clipboard changes, renderer loss and final history-write failure. Preserve the generated text and surface delivery/history failure reasons; do not duplicate history entries.

Acceptance: configurable global shortcut works outside app; no focus theft on start/stop; valid original editable target receives precisely the final transcript once; demo/manual polish never auto-pastes; clipboard reflects delivered text unless another process changes it; changed/missing/password/elevated target and clipboard race skip paste with a visible reason; helper absent gracefully offers clipboard fallback; key repeats are suppressed and modifier release is bounded; no Enter/submission; microphone denial clears session. New fields flow through settings, IPC, native, history/export, migration and tests. Synthetic PCM, loopback ASR and a controlled Windows input fixture can exercise OS integration without downloading models. The optional --manual-hotkey-test smoke path allows actual OS key presses from a desktop driver, but its existence is not a passed test. Record automated Windows integration, manual native inspection and remaining unverified behavior separately.

## Existing-runtime build and distribution

scripts/prepare-runtime.cjs reads an existing Electron 40.2.1 Windows x64 cache/archive or MURMUR_ELECTRON_ZIP, validates required nonempty files and version, and never downloads replacements. Incomplete directories are preserved with instructions to move them aside. scripts/build-native.cjs uses the installed .NET Framework C# compiler and writes project-contained runtime/native output; no compiler packages are fetched.

npm start attempts native compilation before opening the GUI. If compilation is unavailable it warns and continues in clipboard mode. npm run build:win requires successful helper compilation, copies the helper into resources/app/runtime/native along with the confined Electron/app files, writes the relative root marker and invokes local Python 3 to embed the icon. User settings/history/model weights are excluded. The unsigned folder distribution stays under dist/Murmur; no installer, startup registration or file-association changes are made. Native source changes require a helper rebuild; renderer development does not require rebuilding the distribution.
