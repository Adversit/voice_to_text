# Speech API settings UI validation

Date: 2026-09-28 (Asia/Shanghai). Scope: renderer changes for `MODELS-AND-APIS-SPEC.md`. No real cloud requests, model transfers, physical microphone capture or desktop interaction were performed by this UI check.

## Implementation review

- The cloud speech form reads all five entries from `snapshot.speechProviders`: SiliconFlow, DashScope, OpenAI, Groq and custom. Named providers show official region/address options; custom accepts an editable URL. Model names stay editable with catalog suggestions. DashScope is identified by its catalog notes, not as a generic multipart service.
- ASR credential status compares the current draft provider and normalized endpoint with the main-owned public `asr.keyEndpoints`. A saved `hasKey` flag alone never makes a different draft binding appear configured. Status distinguishes missing credentials, pending save, pending deletion and configured-but-unverified credentials.
- Provider/address changes clear only the unsaved ASR key and its deletion checkbox, with a visible explanation. Other settings, polish credentials and shortcut drafts remain intact. Saving without a new ASR key omits `keys.asr`; explicit deletion sends an empty string under the unchanged save envelope. Main/store remains responsible for encrypted persistence and exact binding enforcement.
- Documentation/key buttons send only a provider ID and `docs`/`key` kind through `openProviderLink`; renderer does not open arbitrary URLs or issue network requests.
- Model banners now describe project-contained files and explicit preparation scripts/manual placement. There is no in-app downloader. File discovery still does not claim successful inference. The Python hint explains the project `.venv` preference for the default `python` value.

## Executed checks

1. `node --test tests/ui-api.test.cjs tests/ui-shortcuts.test.cjs`: **22 passed, 0 failed** (11 new provider UI cases and 11 existing shortcut cases). This uses Node VM DOM/IPC fixtures, not a running Electron window.
2. The provider cases cover all catalog choices, official/custom controls, editable model suggestions, exact credential binding, provider and region changes, normalized equivalent addresses, local/cloud endpoint rewrites, no old ASR key in the save payload, unrelated draft preservation, optional keys, explicit clear, background snapshot preservation, canonical endpoint normalization, allowlisted-link envelope shape, metadata escaping and removal of stale download-ban wording.
3. `node --input-type=module --check < renderer/app.js` through `cmd.exe`: passed.
4. Explicit fatal UTF-8 decoding of `renderer/app.js`, `renderer/index.html`, `renderer/styles.css` and `tests/ui-api.test.cjs`: passed; no replacement characters or runs of four question marks. Chinese UI text was read back as UTF-8. This record is also UTF-8 checked after writing.

Initial test run had one fixture failure: the background-snapshot case updated an obsolete fixture object after replacing the canonical snapshot. It was corrected to update the current snapshot; production logic did not change to satisfy that assertion. All 22 cases then passed.

Follow-up exact-binding review: `normalizeEndpoint` now matches stored strings using only trim and trailing-slash removal. It deliberately preserves hostname case and explicit default ports so a URL-equivalent spelling cannot misreport an old stored key as available or unavailable. The 11 provider VM cases were rerun successfully with both directions of the case/default-port regression. The hidden Electron check in `TEST-API-DESKTOP.md` also covers this path through the real store.

## Remaining verification

- Actual Electron dropdown/input events, saving/reopening each no-key preset, encrypted bindings and hidden visual capture are recorded separately in `TEST-API-DESKTOP.md`. The VM cases alone do not establish those results. Opening a real external browser remains intentionally unexercised; invalid actions and accepted-link blocking were checked in the desktop fixture.
- Real supplier authentication, account model access, billable transcription, physical microphone accuracy and local inference are outside this UI test record. No credentials were supplied or used.
