# Provider settings and credential migration validation

Date: 2026-09-28 (Asia/Shanghai). Node.js 22.14.0, Windows.

Command: `node --test tests/api-settings.test.cjs tests/core.test.cjs tests/shortcuts.test.cjs`

Latest result: **43 passed, 0 failed, 0 skipped**, 1216.1016 ms. Raw TAP: ignored `artifacts/api-state-tests.tap`.

Coverage: all four presets and custom save without keys; official address enforcement; old missing-provider and unscoped ciphertext migration; exact provider/address binding; returning to a supplier; region/custom-host change; selected-slot deletion; public metadata stripped on save; atomic failed-write/migration preservation; malformed and conflicting private data fails without rewriting; existing history, paths and shortcut migration regressions.

Independent review found UI URL canonicalization differed from the exact stored endpoint convention. UI uses the same trim/trailing-slash convention; its separate regression is recorded in TEST-UI-APIS.md. Review also found malformed saved binding addresses and an impossible legacy named-provider/loopback combination could survive the first migration. Shared binding validation now runs before either existing or migrated bindings are adopted; the eight-test API settings suite includes those failure cases.

The first combined run had 40 passing and 2 failing assertions: old shortcut migration tests still expected the removed unscoped secrets.asr field. Those assertions now require the new provider/address binding and unchanged ciphertext; the next run passed 42/42. The additional malformed-binding regression produced the final 43/43 result above.

This suite uses a reversible synthetic credential codec. It does not prove Windows encryption or live cloud authentication; actual Electron safeStorage and renderer/IPC checks are recorded separately. No user credentials, audio, models or user settings were used.
