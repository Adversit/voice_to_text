'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createPaths, inferenceEnv } = require('../core/paths.cjs');
const { createNativeShortcut } = require('../desktop/native-shortcut.cjs');

const root = path.resolve(__dirname, '..');
const paths = createPaths(root);
const helper = path.join(paths.cache, 'native-shortcut-tests', 'Murmur.Shortcut.Test.exe');
const windows = { skip: process.platform !== 'win32' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test.before(() => {
  if (process.platform !== 'win32') return;
  const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  // Separate output prevents parallel Node test files from locking the app binary.
  const result = spawnSync(path.join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${helper}`,
    `/reference:${path.join(framework, 'System.Core.dll')}`, `/reference:${path.join(framework, 'System.Web.Extensions.dll')}`,
    path.join(root, 'native', 'ShortcutBridge.cs')], { cwd: root, env: inferenceEnv(paths), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});

test('native shortcut state machine covers side, repeats, chords, AltGr, injection, held startup and mouse cancellation', windows, () => {
  const result = spawnSync(helper, ['self-test'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.assertions >= 30);
  assert.deepEqual(report.cases, ['solo', 'repeat', 'left-alt', 'chord', 'altgr', 'injected', 'paste', 'startup-held', 'other-held', 'mouse-cancel']);
});

test('native shortcut rejects invalid owner and malformed CLI without installing hooks', windows, () => {
  for (const args of [[], ['listen', '0'], ['listen', String(process.pid), '--unknown']]) {
    const result = spawnSync(helper, args, { input: '', encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});

test('native shortcut transport validates containment and handles missing executable', async () => {
  assert.throws(() => createNativeShortcut({ helperPath: path.resolve(root, '..', 'outside.exe'), ownerPid: process.pid, paths }), { code: 'UNSAFE_PATH' });
  assert.throws(() => createNativeShortcut({ helperPath: helper, ownerPid: 0, paths }), TypeError);
  const input = createNativeShortcut({ helperPath: path.join(paths.runtime, 'native', 'absent-shortcut.exe'), ownerPid: process.pid, paths });
  await assert.rejects(input.start(), { code: 'SHORTCUT_UNAVAILABLE' });
  await input.stop();
});

test('native shortcut revalidates containment when a later directory junction would escape the project', windows, async () => {
  const link = path.join(paths.cache, 'native-shortcut-tests', `late-junction-${process.pid}`);
  const input = createNativeShortcut({ helperPath: path.join(link, 'never-execute.exe'), ownerPid: process.pid, paths });
  fs.symlinkSync(path.dirname(root), link, 'junction');
  try { await assert.rejects(input.start(), { code: 'UNSAFE_PATH' }); }
  finally { fs.unlinkSync(link); await input.stop(); }
});

test('real native hook transport acknowledges readiness, supports guarded test target and releases on stdin EOF', windows, async () => {
  let activations = 0, failures = 0;
  const input = createNativeShortcut({ helperPath: helper, ownerPid: process.pid, paths, testMode: true, onActivate: () => activations++, onFailure: () => failures++ });
  try {
    input.setTestTargetPid(process.pid);
    await input.start();
    await input.start();
    input.setTestTargetPid(null);
    assert.throws(() => input.setTestTargetPid(-1), TypeError);
    await input.stop();
    await input.stop();
    await input.start();
    await input.stop();
    assert.equal(activations, 0);
    assert.equal(failures, 0);
  } finally { await input.stop(); }
});

test('native shortcut exits on parent death and reports unavailable once', windows, async () => {
  const owner = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  let failures = 0;
  const input = createNativeShortcut({ helperPath: helper, ownerPid: owner.pid, paths, onFailure: () => failures++ });
  try {
    await input.start();
    const closed = once(owner, 'close');
    owner.kill();
    await closed;
    for (let i = 0; i < 50 && failures === 0; i++) await delay(20);
    assert.equal(failures, 1);
    await input.stop();
    assert.equal(failures, 1);
  } finally { owner.kill(); await input.stop(); }
});

test('native shortcut bounds stdin and does not expose keyboard data in protocol', windows, async () => {
  const child = spawn(helper, ['listen', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    for (let i = 0; i < 100 && !output.includes('ready'); i++) await delay(20);
    assert.match(output, /ready/);
    const closed = once(child, 'close');
    child.stdin.write('x'.repeat(257));
    await Promise.race([closed, delay(3000).then(() => { throw new Error('Native stdin bound did not close process.'); })]);
    assert.equal(errors, '');
    assert.deepEqual(output.trim().split(/\r?\n/).map(line => JSON.parse(line)), [{ type: 'ready' }]);
  } finally { child.kill(); }
});
