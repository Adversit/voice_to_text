# Murmur / 轻声 — Windows prototype specification

Date: 2026-09-27. Product: a personal, local-first voice dictation desktop application inspired by Typeless. Prototype does not download any model or inference dependency. UI language: simplified Chinese; brand: Murmur / 轻声.

## Implementation checklist

- [ ] Desktop shell, tray, global recording shortcut, clipboard, portable Windows packaging.
- [ ] Recording workbench, deliberate sample demonstration, transcript editor, history/export.
- [ ] Separate ASR, VAD and text-polishing configurations with local and cloud routes.
- [ ] Actual hardware inspection and conservative model recommendations.
- [ ] Project-contained settings, model/cache storage and offline local inference runner.
- [ ] Automated contracts, storage, failure-path tests and desktop manual verification in TEST-RECORD.md.

## Two-pass review

Pass 1: repository inspected and empty. Chain: microphone -> 16 kHz mono PCM WAV -> isolated Electron preload -> main-process service -> optional VAD -> selected ASR -> optional polish -> persisted history -> editor/clipboard/export. Model downloads are disabled, not merely hidden. No cloud fallback from local failures.

Pass 2: connected surfaces include navigation/record controls, shared schema, main-process state, adapters, IPC validation, Python runner, JSON persistence, encrypted API credentials, history/export, native tray/shortcuts, Windows hardware subprocesses, cache variables, packaging root discovery, migration/version checks and tests. No existing files or legacy migration paths exist.

## Source of truth and storage

Electron main process owns canonical settings/history. Renderer has display state only. Settings schemaVersion=1; atomic UTF-8 JSON writes. Unknown schema versions fail visibly instead of reset. Credentials encrypted with Electron safeStorage, never returned to renderer or put in logs/history. Renderer only receives hasKey flags. Mutable storage is fixed under PROJECT_ROOT: models/, data/, cache/, runtime/. Root in development is package root; portable build has project-root.json holding original root. It never silently falls back to C: or appData. Reject paths escaping root, absolute model paths outside root, symlink/junction escapes, traversal. Child inference environment defines HF_HOME, HUGGINGFACE_HUB_CACHE, TRANSFORMERS_CACHE, TORCH_HOME, XDG_CACHE_HOME, TEMP, TMP under project, HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1.

## Contracts

CommonJS backend, ES module frontend, zero third-party JavaScript dependencies. Electron 40.2.1 already cached locally. No npm install required for prototype. Native shell sandbox=true, contextIsolation=true, nodeIntegration=false; custom murmur://app protocol and strict CSP. Preload exposes window.murmur methods with envelopes `{ok:true,data}` or `{ok:false,error:{code,message}}`.

Snapshot: `{settings,history,models,hardware,paths:{root,models,data,cache},runtime:{platform,version,shortcut,shortcutRegistered,encryptionAvailable,downloadsEnabled:false}}`.

Settings: `{schemaVersion:1,asr:{mode:'local'|'cloud',engine:'faster-whisper'|'openai'|'whisper-cpp',modelId:'whisper-base',endpoint:'http://127.0.0.1:8080',apiModel:'whisper-1',language:'auto'|'zh'|'en',device:'cpu'|'cuda',pythonPath:'python'},vad:{mode:'energy'|'silero'|'off',modelId:'silero-vad',threshold:0.015},polish:{mode:'off'|'local'|'cloud',endpoint:'http://127.0.0.1:8081/v1',apiModel:'qwen2.5-1.5b',modelId:'qwen-1.5b',style:'natural'|'concise'|'formal'},general:{autoCopy:true,saveHistory:true,shortcut:'CommandOrControl+Alt+Space'}}`.

Renderer API:
- getSnapshot() -> snapshot (hardware may initially be null; refreshHardware is explicit and returns snapshot).
- saveSettings({settings,keys?:{asr?:string,polish?:string}}) -> snapshot; omitted key preserves, empty string removes. settings includes hasKey? for display, stripped before persistence.
- refreshHardware() -> snapshot.
- transcribe({audio:ArrayBuffer,durationMs:number}) -> `{text,rawText,record,warnings:string[]}`; PCM16 WAV mono 16000Hz, 0.3–120 seconds, max 4 MB. Actual WAV header/duration validated server-side. No silent network retries.
- polishText({text:string}) -> `{text,warnings:string[]}`. Nonempty <=20000 chars; preserves original on polish failure.
- demo() -> same result shape as transcribe, record.source='demo', always explicit and independent of selected engines; no network/microphone.
- deleteHistory({id:string}) -> snapshot; clearHistory() -> snapshot; exportHistory({format:'json'|'txt'}) -> `{canceled,path?}` native save dialog.
- copyText({text:string}) -> `{copied:true}`.
- openFolder({kind:'models'|'data'|'root'}) -> void.
- windowAction({action:'minimize'|'maximize'|'close'}) -> void; close hides to tray; Quit via tray.
- onToggleRecording(callback) -> unsubscribe; onStateChanged(callback) -> unsubscribe; onNotice(callback) -> unsubscribe.

History record: `{id,createdAt,text,rawText,durationMs,source:'local'|'cloud'|'demo',model,label?,warnings:[]}`. No audio or key stored in history. Max 200 records; export only history, no settings/secrets. Catalog record: `{id,name,task:'asr'|'vad'|'polish',family,sizeMB,minRamGB,recommendedRamGB,minVramGB,relativePath,description,sourceUrl,installed:boolean,recommendation:{level:'recommended'|'caution'|'avoid'|'unknown',reason}}`. Installed means required files exist, not proven runtime-loadable. Hardware `{os,cpu:{name,cores},memory:{totalGB,freeGB},gpus:[{name,vramGB:number|null}],disk:{freeGB:number|null},detectedAt,warnings:[]}`. Unknown GPU VRAM stays null; WMI 32-bit AdapterRAM is not reliable for large GPUs. Use nvidia-smi when available. Recommendations are estimates, not performance claims; runtime/CUDA availability is separate.

Backend interface for desktop entry:
- core/paths.cjs: createPaths(root), assertContained(base,candidate), inferenceEnv(paths).
- core/store.cjs: createStore(paths,secretCodec) -> {init(),getSettings(),getPublicSettings(),saveSettings(settings,keys),getSecret(name),getHistory(),addHistory(record),deleteHistory(id),clearHistory()}; codec {encrypt(string):string,decrypt(string):string,available():boolean}; methods may be sync, awaited by caller.
- core/catalog.cjs: getModels(paths,hardware), recommend(model,hardware).
- core/hardware.cjs: detectHardware(paths) async.
- core/contracts.cjs: defaults(), validateSettings(settings), AppError(code,message), envelope(action) if needed.
- core/providers.cjs: createProviders({paths,store}) -> {transcribe({audio,durationMs}),polishText({text}),demo()}; provider handles history insertion, does not copy clipboard. Header constraints canonical in core/audio.cjs.

## Affected files (ownership)

Root integrator: desktop/main.cjs, desktop/preload.cjs, package.json, scripts/*, assets/*, docs/*, README.md, test desktop integration.
UI: renderer/index.html, renderer/app.js, renderer/styles.css, renderer/audio.js, renderer/icons.js. UI must follow contracts above; no changes to backend files.
State/hardware: core/contracts.cjs, core/paths.cjs, core/store.cjs, core/catalog.cjs, core/hardware.cjs, tests/core.test.cjs. Own schema and snapshots data, no desktop imports.
Inference: core/providers.cjs, core/audio.cjs, runtime/local_inference.py, tests/providers.test.cjs. Uses backend interface above, Node builtins only.

## Old logic removal

None at baseline (empty repository). Do not introduce browser-only storage, fake hardware, automatic model downloads, cloud fallback, demo text on real inference failures, or model-ID-triggered model hub fetches. Packaged paths must not rely on process cwd. Defaults must be derived from contracts.cjs, not divergent copies in UI.

## Acceptance and failures

1. Launch actual Electron Windows window, native controls/tray/global shortcut; UI recording starts only on user action; microphone permission/absence is visibly handled. Stop releases media tracks. No double-start/startup shortcut races; busy controls disabled; two-minute limit enforced.
2. Explicit demo produces an identified sample transcript/history item, copy and export work; empty initial history is real; dates/totals derive from records.
3. Save/reopen settings retains three independent stage selections; API keys encrypted, redacted; unsupported schema/corrupt file surfaced.
4. Empty/short/silent/oversized/non-WAV audio fail usefully; missing model/runtime gives setup instructions, no download/network; local API endpoints loopback only; cloud requires HTTPS; redirects cannot silently leave local route. Request timeout and provider error surfaced; failed polish preserves raw transcript with warning.
5. Hardware populated from this machine, scan retries available; detection failure yields unknown/caution, never fake hardware. Conservative reserve for other applications; insufficient disk and low RAM warn.
6. Paths enforced in Node and Python; symlink/junction traversal blocked. Model directory stays empty for this phase; no downloader implemented. Local ASR can later use preexisting project model directories with faster-whisper local_files_only=True. Local VAD uses preexisting Silero ONNX. Polish connects to user's already-running loopback OpenAI-compatible service; this app never starts third-party downloads.
7. Test outcomes written to project record before claiming verification. Real recognition accuracy and CUDA execution remain explicitly unverified until model files/API credentials and microphone speech are supplied. Prototype is not claimed to be full Typeless parity; text is copied for paste with Ctrl+V, no automatic OS input injection in this phase.

## Sources consulted

- https://www.typeless.com/help/quickstart (product reference, not asset source)
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/ipc
- https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py
- https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/server.cpp
- https://github.com/snakers4/silero-vad
- https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF
