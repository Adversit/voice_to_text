'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { assertContained } = require('../core/paths.cjs');
const { safe, copyContained } = require('../scripts/files.cjs');
const { validateRuntime } = require('../scripts/prepare-runtime.cjs');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILES = [
  'electron.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'resources.pak', 'icudtl.dat', 'v8_context_snapshot.bin', 'snapshot_blob.bin',
  'libEGL.dll', 'libGLESv2.dll', 'd3dcompiler_47.dll', 'ffmpeg.dll',
  'locales/en-US.pak', 'version',
];
function fixture(t) {
  const cache = assertContained(ROOT, path.join(ROOT, 'cache'));
  fs.mkdirSync(cache, { recursive: true });
  const base = fs.mkdtempSync(path.join(cache, 'packaging-test-'));
  const project = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  t.after(() => { assertContained(cache, base); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, project, outside, runtime: path.join(project, 'runtime', 'electron') };
}
function write(file, contents = 'fixture') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}
function makeRuntime(directory) {
  for (const name of RUNTIME_FILES) write(path.join(directory, name), name === 'version' ? '40.2.1\n' : `fixture:${name}`);
}
function junction(target, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
function loadScript(name, project, overrides = {}) {
  const filename = path.join(ROOT, 'scripts', name);
  const actualRequire = createRequire(filename);
  const scriptModule = { exports: {} };
  const spawnCalls = [];
  const buildCalls = [];
  const logs = [];
  const env = { ...process.env, LOCALAPPDATA: path.join(project, 'unused-cache') };
  delete env.MURMUR_ELECTRON_ZIP;
  Object.assign(env, overrides.env || {});
  const scriptProcess = { platform: process.platform, env, exitCode: undefined, argv: ['node', path.join(project, 'scripts', name), '--smoke-test'] };
  const scriptRequire = name => {
    if (name === 'node:child_process') return {
      spawnSync: (...args) => { spawnCalls.push(args); return { status: 0 }; },
      spawn: (...args) => { spawnCalls.push(args); return { on() { return this; } }; },
    };
    if (name === './prepare-runtime.cjs' && overrides.prepare) return { prepare: overrides.prepare };
    if (name === './build-native.cjs') return { buildNative: (...args) => {
      buildCalls.push(args);
      if (overrides.buildNative) return overrides.buildNative(...args);
      const helper = path.join(project, 'runtime', 'native', 'Murmur.Input.exe');
      write(helper, 'compiled helper fixture');
      return helper;
    } };
    return actualRequire(name);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: scriptRequire, module: scriptModule, __dirname: path.join(project, 'scripts'),
    process: scriptProcess, Buffer, console: {
      log: (...messages) => logs.push(messages.join(' ')),
      error: (...messages) => logs.push(messages.join(' ')),
      warn: (...messages) => logs.push(messages.join(' ')),
    },
  }, { filename });
  return { module: scriptModule, process: scriptProcess, spawnCalls, buildCalls, logs };
}

test('runtime validation accepts complete expected version and rejects truncated, empty or mismatched files without mutation', t => {
  const { project, runtime } = fixture(t);
  makeRuntime(runtime);
  assert.doesNotThrow(() => validateRuntime(project, runtime));
  const original = fs.readFileSync(path.join(runtime, 'ffmpeg.dll'), 'utf8');
  fs.unlinkSync(path.join(runtime, 'ffmpeg.dll'));
  assert.throws(() => validateRuntime(project, runtime), /Incomplete Electron runtime: ffmpeg\.dll.*Move runtime\/electron aside/u);
  write(path.join(runtime, 'ffmpeg.dll'), '');
  assert.throws(() => validateRuntime(project, runtime), /Incomplete Electron runtime/u);
  write(path.join(runtime, 'ffmpeg.dll'), original);
  write(path.join(runtime, 'version'), '39.0.0');
  assert.throws(() => validateRuntime(project, runtime), /Expected cached Electron 40\.2\.1/u);
  assert.equal(fs.readFileSync(path.join(runtime, 'version'), 'utf8'), '39.0.0');
});

test('runtime validation refuses external runtime and nested locale junctions', t => {
  const { project, outside, runtime } = fixture(t);
  makeRuntime(outside);
  junction(outside, runtime);
  assert.throws(() => validateRuntime(project, runtime), error => error.code === 'UNSAFE_PATH');
  fs.unlinkSync(runtime);
  makeRuntime(runtime);
  fs.unlinkSync(path.join(runtime, 'locales', 'en-US.pak'));
  fs.rmdirSync(path.join(runtime, 'locales'));
  junction(path.join(outside, 'locales'), path.join(runtime, 'locales'));
  assert.throws(() => validateRuntime(project, runtime), error => error.code === 'UNSAFE_PATH');
});

test('prepare refuses executable-only partial runtime and never attempts extraction or download', t => {
  const { project, runtime } = fixture(t);
  write(path.join(runtime, 'electron.exe'), 'partial executable');
  const script = loadScript('prepare-runtime.cjs', project);
  assert.throws(() => script.module.exports.prepare(), /Incomplete Electron runtime.*Move runtime\/electron aside/u);
  assert.equal(script.spawnCalls.length, 0);
  assert.deepEqual(fs.readdirSync(runtime), ['electron.exe']);
  assert.equal(fs.readFileSync(path.join(runtime, 'electron.exe'), 'utf8'), 'partial executable');
});

test('prepare checks confinement before trusting an existing external executable', t => {
  const { project, outside, runtime } = fixture(t);
  makeRuntime(outside);
  junction(outside, runtime);
  const script = loadScript('prepare-runtime.cjs', project);
  assert.throws(() => script.module.exports.prepare(), error => error.code === 'UNSAFE_PATH');
  assert.equal(script.spawnCalls.length, 0);
});

test('prepare needs a local archive and preserves nonempty incomplete extraction directories', { skip: process.platform !== 'win32' }, t => {
  const { project, runtime } = fixture(t);
  const absent = path.join(project, 'missing-runtime.zip');
  const missing = loadScript('prepare-runtime.cjs', project, { env: { MURMUR_ELECTRON_ZIP: absent } });
  assert.throws(() => missing.module.exports.prepare(), /No cached Electron runtime found\. No download was attempted/u);
  assert.equal(missing.spawnCalls.length, 0);
  assert.equal(fs.existsSync(runtime), false);
  const archive = path.join(project, 'local.zip');
  write(archive);
  write(path.join(runtime, 'partial.dll'), 'keep this file');
  const partial = loadScript('prepare-runtime.cjs', project, { env: { MURMUR_ELECTRON_ZIP: archive } });
  assert.throws(() => partial.module.exports.prepare(), /Incomplete runtime directory.*no files were deleted or downloaded/u);
  assert.equal(partial.spawnCalls.length, 0);
  assert.equal(fs.readFileSync(path.join(runtime, 'partial.dll'), 'utf8'), 'keep this file');
});

test('recursive copying preserves bytes and rejects source or destination junction escapes', t => {
  const { project, outside } = fixture(t);
  const source = path.join(project, 'source');
  const destination = path.join(project, 'copy');
  write(path.join(source, 'nested', 'file.txt'), '\u4e2d\u6587\u6587\u4ef6');
  copyContained(project, source, destination);
  assert.equal(fs.readFileSync(path.join(destination, 'nested', 'file.txt'), 'utf8'), '\u4e2d\u6587\u6587\u4ef6');
  write(path.join(outside, 'private.txt'), 'outside remains untouched');
  junction(outside, path.join(source, 'linked'));
  assert.throws(() => copyContained(project, source, path.join(project, 'reject-source')), error => error.code === 'UNSAFE_PATH');
  fs.unlinkSync(path.join(source, 'linked'));
  const escaped = path.join(project, 'destination-link');
  junction(outside, escaped);
  assert.throws(() => copyContained(project, source, path.join(escaped, 'copy')), error => error.code === 'UNSAFE_PATH');
  assert.deepEqual(fs.readdirSync(outside), ['private.txt']);
  assert.equal(fs.readFileSync(path.join(outside, 'private.txt'), 'utf8'), 'outside remains untouched');
  assert.throws(() => safe(project, path.join(project, '..', 'outside')), error => error.code === 'UNSAFE_PATH');
});

test('recursive copying rejects an existing nested output junction before modifying its external target', t => {
  const { project, outside } = fixture(t);
  const source = path.join(project, 'source');
  const destination = path.join(project, 'destination');
  write(path.join(source, 'nested', 'file.txt'), 'new value');
  write(path.join(outside, 'file.txt'), 'original value');
  junction(outside, path.join(destination, 'nested'));
  assert.throws(() => copyContained(project, source, destination), error => error.code === 'UNSAFE_PATH');
  assert.equal(fs.readFileSync(path.join(outside, 'file.txt'), 'utf8'), 'original value');
});

function makePackageFixture(project, runtime) {
  makeRuntime(runtime);
  write(path.join(runtime, 'resources', 'default_app.asar'));
  for (const name of ['desktop', 'core', 'renderer', 'assets', 'scripts']) write(path.join(project, name, 'fixture.txt'));
  write(path.join(project, 'runtime', 'local_inference.py'));
  write(path.join(project, 'package.json'), '{"name":"murmur-desktop"}');
  write(path.join(project, 'data', 'state.json'), '{"private":"must never enter bundle"}');
  write(path.join(project, 'models', 'private.bin'), 'private model');
}

test('packaging script rejects a dist parent junction before bundle writes or icon process launch', t => {
  const { project, outside, runtime } = fixture(t);
  makePackageFixture(project, runtime);
  junction(outside, path.join(project, 'dist'));
  const script = loadScript('package-win.cjs', project, { prepare: () => path.join(runtime, 'electron.exe') });
  assert.equal(script.process.exitCode, 1);
  assert.equal(script.spawnCalls.length, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('packaging creates a relative project marker and excludes user data and model weights', t => {
  const { project, runtime } = fixture(t);
  makePackageFixture(project, runtime);
  const script = loadScript('package-win.cjs', project, { prepare: () => path.join(runtime, 'electron.exe') });
  assert.equal(script.process.exitCode, undefined);
  assert.equal(script.buildCalls.length, 1);
  assert.equal(script.spawnCalls.length, 1);
  assert.equal(script.spawnCalls[0][0], 'python');
  const target = path.join(project, 'dist', 'Murmur');
  const appRoot = path.join(target, 'resources', 'app');
  assert.equal(fs.existsSync(path.join(target, 'Murmur.exe')), true);
  assert.equal(fs.existsSync(path.join(target, 'electron.exe')), false);
  assert.equal(fs.existsSync(path.join(runtime, 'electron.exe')), true);
  const marker = JSON.parse(fs.readFileSync(path.join(appRoot, 'project-root.json'), 'utf8'));
  assert.equal(path.resolve(appRoot, marker.projectRoot), project);
  assert.equal(fs.existsSync(path.join(appRoot, 'data')), false);
  assert.equal(fs.existsSync(path.join(appRoot, 'models')), false);
  assert.equal(fs.existsSync(path.join(appRoot, 'runtime', 'local_inference.py')), true);
  assert.equal(fs.readFileSync(path.join(appRoot, 'runtime', 'native', 'Murmur.Input.exe'), 'utf8'), 'compiled helper fixture');
});

test('packaging stops on native helper build failure before creating a misleading bundle', t => {
  const { project, runtime } = fixture(t);
  makePackageFixture(project, runtime);
  const script = loadScript('package-win.cjs', project, {
    prepare: () => path.join(runtime, 'electron.exe'),
    buildNative: () => { throw new Error('native compiler unavailable'); },
  });
  assert.equal(script.process.exitCode, 1);
  assert.equal(script.buildCalls.length, 1);
  assert.equal(script.spawnCalls.length, 0);
  assert.ok(script.logs.some(message => String(message).includes('native compiler unavailable')));
  assert.equal(fs.existsSync(path.join(project, 'dist', 'Murmur', 'Murmur.exe')), false);
});

test('development launch prepares the helper and strips ELECTRON_RUN_AS_NODE from the GUI environment', t => {
  const { project, runtime } = fixture(t);
  makePackageFixture(project, runtime);
  const script = loadScript('launch.cjs', project, {
    prepare: () => path.join(runtime, 'electron.exe'),
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.equal(script.process.exitCode, undefined);
  assert.equal(script.buildCalls.length, 1);
  assert.equal(script.spawnCalls.length, 1);
  const [executable, args, options] = script.spawnCalls[0];
  assert.equal(executable, path.join(runtime, 'electron.exe'));
  assert.deepEqual(Array.from(args), [project, '--smoke-test']);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
});

test('development launch retains clipboard-only startup when the native compiler is unavailable', t => {
  const { project, runtime } = fixture(t);
  makePackageFixture(project, runtime);
  const script = loadScript('launch.cjs', project, {
    prepare: () => path.join(runtime, 'electron.exe'),
    buildNative: () => { throw new Error('native compiler unavailable'); },
  });
  assert.equal(script.process.exitCode, undefined);
  assert.equal(script.buildCalls.length, 1);
  assert.equal(script.spawnCalls.length, 1);
  assert.equal(script.spawnCalls[0][0], path.join(runtime, 'electron.exe'));
  assert.ok(script.logs.some(message => String(message).includes('native compiler unavailable')));
});
