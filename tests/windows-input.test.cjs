'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPaths, assertContained } = require('../core/paths.cjs');
const { createWindowsInput, validTarget } = require('../core/windows-input.cjs');
const { buildNative } = require('../scripts/build-native.cjs');

const root = path.resolve(__dirname, '..');
const paths = createPaths(root);
const absentWindow = { hwnd: '1', pid: 2147483646, processStartTicks: '1', runtimeId: [42, 1] };
let helper;

test('target token validates bounded opaque identifiers without window titles or text', () => {
  assert.equal(validTarget(absentWindow), true);
  for (const value of [null, [], {}, { ...absentWindow, hwnd: '../escape' }, { ...absentWindow, pid: 0 },
    { ...absentWindow, pid: 1.1 }, { ...absentWindow, processStartTicks: '' },
    { ...absentWindow, runtimeId: [] }, { ...absentWindow, runtimeId: Array(65).fill(1) },
    { ...absentWindow, runtimeId: [2147483648] }]) assert.ok(!validTarget(value));
});

test('unavailable helper gracefully disables capture and safely skips invalid paste requests', async () => {
  const input = createWindowsInput({ paths, ownerPid: process.pid, helperPath: path.join(paths.runtime, 'native', 'missing-helper.exe') });
  assert.equal(input.available(), false);
  const capture = await input.capture();
  assert.equal(capture.target, null);
  assert.equal(typeof capture.reason, 'string');
  assert.equal((await input.paste()).status, 'skipped');
  assert.equal((await input.paste({ target: { ...absentWindow, pid: process.pid }, clipboardHash: 'a'.repeat(64) })).status, 'skipped');
  assert.equal((await input.paste({ target: absentWindow, clipboardHash: 'wrong-hash' })).status, 'skipped');
  assert.equal((await input.paste({ target: absentWindow, clipboardHash: 'a'.repeat(64) })).status, 'failed');
  assert.equal(await input.waitForKeyRelease({ keyCode: 0x87 }), false);
});

test('helper executable cannot escape project root', () => {
  assert.throws(() => createWindowsInput({ paths, ownerPid: process.pid, helperPath: path.join(root, '..', 'unsafe.exe') }), { code: 'UNSAFE_PATH' });
  assert.throws(() => createWindowsInput({ paths, ownerPid: 0 }), TypeError);
});

test('existing .NET Framework compiles project-local input helper and controlled fixture without downloads', { skip: process.platform !== 'win32' }, () => {
  helper = buildNative({ includeFixture: true });
  assert.equal(helper, path.join(paths.runtime, 'native', 'Murmur.Input.exe'));
  assertContained(root, helper);
  assert.ok(fs.statSync(helper).size > 0);
  assert.ok(fs.statSync(path.join(paths.runtime, 'native', 'Murmur.PasteTarget.exe')).size > 0);
  assert.equal(createWindowsInput({ paths, ownerPid: process.pid }).available(), true);
});

test('native helper rejects malformed requests and invalid token before any clipboard or input access', { skip: process.platform !== 'win32' }, () => {
  const invoke = (command, payload) => {
    const result = spawnSync(helper, [command], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 7000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  };
  assert.equal(invoke('paste', '{broken').ok, false);
  assert.equal(invoke('paste', '{}').ok, false);
  assert.equal(invoke('download', { ownerPid: process.pid }).ok, false);
  assert.equal(invoke('capture', ' '.repeat(8193)).ok, false);
  assert.equal(invoke('key-release', { ownerPid: process.pid, keyCode: 0 }).ok, false);
  assert.equal(invoke('key-release', { ownerPid: process.pid, keyCode: 256 }).ok, false);
  assert.equal(invoke('paste', { ownerPid: process.pid, target: null, clipboardHash: 'a'.repeat(64) }).data.status, 'skipped');
  assert.equal(invoke('paste', { ownerPid: process.pid, target: absentWindow, clipboardHash: 'bad' }).data.status, 'skipped');
});

test('actual hidden native subprocess refuses gone window and app-self target without sending keys', { skip: process.platform !== 'win32' }, async () => {
  const input = createWindowsInput({ paths, ownerPid: process.pid });
  const result = await input.paste({ target: absentWindow, clipboardHash: 'a'.repeat(64) });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /\u7a97\u53e3/);
  const self = await input.paste({ target: { ...absentWindow, pid: process.pid }, clipboardHash: 'a'.repeat(64) });
  assert.equal(self.status, 'skipped');
});

test('pending native capture can be canceled and child exits before fallback resolves', { skip: process.platform !== 'win32' }, async () => {
  const input = createWindowsInput({ paths, ownerPid: process.pid });
  const pending = input.capture();
  assert.equal(input.cancelPending(), 1);
  const result = await pending;
  assert.equal(result.target, null);
  assert.equal(input.cancelPending(), 0);
});

test('native key-release checks an unpressed F24 key without injecting input and rejects invalid codes', { skip: process.platform !== 'win32' }, async () => {
  const input = createWindowsInput({ paths, ownerPid: process.pid });
  assert.equal(await input.waitForKeyRelease({ keyCode: 0x87 }), true);
  assert.equal(await input.waitForKeyRelease({ keyCode: 0 }), false);
  assert.equal(await input.waitForKeyRelease({ keyCode: 256 }), false);
  assert.equal(await input.waitForKeyRelease({ keyCode: 65.5 }), false);
  assert.equal(await input.waitForKeyRelease(), false);
  const pending = input.waitForKeyRelease({ keyCode: 0x87 });
  assert.equal(input.cancelPending(), 1);
  assert.equal(await pending, false);
});
