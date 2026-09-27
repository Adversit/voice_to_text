'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AppError, defaults, validateSettings, envelope } = require('../core/contracts.cjs');
const { createPaths, assertContained, inferenceEnv } = require('../core/paths.cjs');
const { createStore } = require('../core/store.cjs');
const { getModels, recommend } = require('../core/catalog.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function fixture(t) {
  const cache = assertContained(PROJECT_ROOT, path.join(PROJECT_ROOT, 'cache'));
  fs.mkdirSync(cache, { recursive: true });
  const base = fs.mkdtempSync(path.join(cache, 'core-test-'));
  const root = path.join(base, 'project');
  fs.mkdirSync(root);
  t.after(() => { assertContained(cache, base); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, root, paths: createPaths(root) };
}
function codec() {
  const key = crypto.randomBytes(32);
  return {
    available: () => true,
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(value) {
      const bytes = Buffer.from(value, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
function record(index = 1) {
  return { id: `record-${index}`, createdAt: '2026-09-27T10:00:00.000Z', text: '\u4f60\u597d\uff0c\u4e16\u754c\u3002', rawText: '\u4f60\u597d\u4e16\u754c', durationMs: 1000, source: 'demo', model: 'demo', warnings: [] };
}
const expectCode = code => error => error instanceof AppError && error.code === code;

test('paths reject traversal, sibling-prefix paths, outside absolute paths and junction escapes', t => {
  const { base, paths } = fixture(t);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  assert.equal(assertContained(paths.root, path.join(paths.models, 'asr', 'model.bin')), path.join(paths.models, 'asr', 'model.bin'));
  for (const value of ['../outside/file', `${paths.root}-suffix/file`, outside]) assert.throws(() => assertContained(paths.root, value), expectCode('UNSAFE_PATH'));
  const link = path.join(paths.models, 'escape');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertContained(paths.root, path.join(link, 'not-created.bin')), expectCode('UNSAFE_PATH'));
  assert.throws(() => assertContained(link, path.join(link, 'model.bin')), expectCode('UNSAFE_PATH'));
  assert.throws(() => createPaths(link), expectCode('UNSAFE_PATH'));
  if (process.platform === 'win32') {
    assert.throws(() => assertContained(paths.root, 'data/file.json:secret'), expectCode('UNSAFE_PATH'));
    assert.throws(() => assertContained(paths.root, 'data/folder. /file'), expectCode('UNSAFE_PATH'));
  }
});

test('paths reject a dangling junction instead of treating it as an ordinary missing directory', t => {
  const { base, paths } = fixture(t);
  const outside = path.join(base, 'missing');
  fs.mkdirSync(outside);
  const link = path.join(paths.models, 'dangling');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmdirSync(outside);
  assert.throws(() => assertContained(paths.root, path.join(link, 'model.bin')), expectCode('PATH_UNAVAILABLE'));
});

test('inference environment confines model, cache and temporary locations and forces offline mode', t => {
  const { paths } = fixture(t);
  const env = inferenceEnv(paths);
  for (const key of ['HF_HOME', 'HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'TRANSFORMERS_CACHE', 'TORCH_HOME', 'XDG_CACHE_HOME', 'TEMP', 'TMP', 'TMPDIR', 'PIP_CACHE_DIR']) {
    assert.equal(assertContained(paths.root, env[key]), env[key]);
    assert.ok(fs.statSync(env[key]).isDirectory());
  }
  assert.equal(env.HF_HUB_OFFLINE, '1');
  assert.equal(env.TRANSFORMERS_OFFLINE, '1');
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
});

test('settings enforce schema, finite thresholds, active local loopback and cloud HTTPS contracts', () => {
  assert.deepEqual(validateSettings(defaults()), defaults());
  assert.throws(() => validateSettings({ ...defaults(), schemaVersion: 2 }), expectCode('UNSUPPORTED_SCHEMA'));
  const settings = defaults();
  settings.vad.threshold = NaN;
  assert.throws(() => validateSettings(settings), expectCode('INVALID_SETTINGS'));
  settings.vad.threshold = 0.015;
  settings.polish.mode = 'local';
  settings.polish.endpoint = 'https://example.org/v1';
  assert.throws(() => validateSettings(settings), expectCode('INVALID_ENDPOINT'));
  settings.polish.endpoint = 'http://127.0.0.1:8081/v1';
  settings.asr.mode = 'cloud';
  assert.throws(() => validateSettings(settings), expectCode('INVALID_SETTINGS'));
  settings.asr.engine = 'openai';
  assert.throws(() => validateSettings(settings), expectCode('INVALID_ENDPOINT'));
  settings.asr.endpoint = 'https://api.example.org/v1';
  settings.asr.engine = 'openai';
  assert.equal(validateSettings(settings).asr.mode, 'cloud');
  settings.asr.endpoint = 'https://user:secret@api.example.org/v1';
  assert.throws(() => validateSettings(settings), expectCode('INVALID_SETTINGS'));
});

test('recording shortcut reserves Ctrl+V across control aliases even when automatic paste is disabled', () => {
  for (const alias of ['Ctrl', 'Control', 'CommandOrControl']) {
    for (const autoPaste of [true, false]) {
      const settings = defaults();
      settings.general.autoPaste = autoPaste;
      settings.general.shortcut = `${alias}+V`;
      assert.throws(() => validateSettings(settings), error => error.code === 'INVALID_SETTINGS' && error.message.includes('Ctrl+V'));
    }
  }
});

test('recording shortcut rejects duplicate aliases in any modifier order while preserving valid combinations', () => {
  const invalid = ['Ctrl+Control+V', 'Control+Ctrl+V', 'CommandOrControl+Ctrl+Space', 'Ctrl+CommandOrControl+Space',
    'Alt+Control+Ctrl+V', 'Ctrl+Alt+Control+V', 'Command+Super+V', 'Super+Command+F1', 'Shift+Shift+Space', 'Alt+Alt+F24'];
  for (const shortcut of invalid) {
    const settings = defaults(); settings.general.shortcut = shortcut;
    assert.throws(() => validateSettings(settings), expectCode('INVALID_SETTINGS'), shortcut);
  }
  const valid = ['CommandOrControl+Alt+Space', 'Alt+Control+V', 'Control+Alt+V', 'Shift+Ctrl+V', 'Ctrl+Shift+V',
    'Alt+CommandOrControl+V', 'Command+F9', 'Super+F9', 'Control+F24', 'Shift+F1', 'Ctrl+1', 'Ctrl+Enter'];
  for (const shortcut of valid) {
    const settings = defaults(); settings.general.shortcut = shortcut;
    assert.equal(validateSettings(settings).general.shortcut, shortcut);
  }
  for (const shortcut of ['ctrl+v', 'Ctrl+v', 'Ctrl+Fn', 'Ctrl++V', 'Alt+F25', 'Command+V', 'Super+V']) {
    const settings = defaults(); settings.general.shortcut = shortcut;
    assert.throws(() => validateSettings(settings), expectCode('INVALID_SETTINGS'), shortcut);
  }
});

test('reserved shortcut cannot replace the durable setting or alter encrypted credentials', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  store.saveSettings(defaults(), { asr: 'keep-existing-secret' });
  const destination = path.join(paths.data, 'state.json');
  const original = fs.readFileSync(destination, 'utf8');
  const settings = store.getSettings();
  settings.general.shortcut = 'Control+V';
  assert.throws(() => store.saveSettings(settings, { asr: 'should-not-replace-secret' }), expectCode('INVALID_SETTINGS'));
  assert.equal(fs.readFileSync(destination, 'utf8'), original);
  assert.equal(store.getSettings().general.shortcut, defaults().general.shortcut);
  assert.equal(store.getSecret('asr'), 'keep-existing-secret');
});

test('API secrets are encrypted, omitted in public state, preserved on omission and removed explicitly', t => {
  const { paths } = fixture(t);
  const secretCodec = codec();
  const store = createStore(paths, secretCodec);
  assert.throws(() => store.getSettings(), expectCode('STORE_NOT_READY'));
  store.init();
  const settings = store.getPublicSettings();
  settings.asr.hasKey = true;
  settings.asr.apiKey = 'must-not-persist';
  store.saveSettings(settings, { asr: 'test-private-key', polish: '\u6d4b\u8bd5-secret' });
  const diskText = fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8');
  assert.ok(!diskText.includes('test-private-key'));
  assert.ok(!diskText.includes('must-not-persist'));
  assert.ok(!diskText.includes('hasKey'));
  assert.deepEqual(store.getSettings(), defaults());
  assert.equal(store.getPublicSettings().asr.hasKey, true);
  assert.equal(store.getSecret('asr'), 'test-private-key');
  store.saveSettings(store.getPublicSettings());
  const reopened = createStore(paths, secretCodec);
  reopened.init();
  assert.equal(reopened.getSecret('polish'), '\u6d4b\u8bd5-secret');
  assert.ok(!JSON.stringify(reopened.getPublicSettings()).includes('test-private-key'));
  reopened.saveSettings(reopened.getPublicSettings(), { asr: '' });
  assert.equal(reopened.getSecret('asr'), '');
  assert.equal(reopened.getPublicSettings().asr.hasKey, false);
  assert.equal(reopened.getPublicSettings().polish.hasKey, true);
});

test('unavailable encryption and encryption failure cannot partially commit settings', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, { available: () => false });
  store.init();
  const before = fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8');
  const changed = defaults();
  changed.general.autoCopy = false;
  assert.throws(() => store.saveSettings(changed, { asr: 'private' }), expectCode('ENCRYPTION_UNAVAILABLE'));
  assert.equal(fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8'), before);
  assert.equal(store.getSettings().general.autoCopy, true);
  const failing = createStore(paths, { available: () => true, encrypt: () => { throw new Error('private'); } });
  failing.init();
  assert.throws(() => failing.saveSettings(changed, { asr: 'private' }), error => error.code === 'ENCRYPTION_FAILED' && !error.message.includes('private'));
});

test('malformed, invalid-schema and malformed-record persisted state is preserved with a visible failure', t => {
  const { paths } = fixture(t);
  const destination = path.join(paths.data, 'state.json');
  const cases = [
    ['{broken', 'STORE_CORRUPT'],
    [JSON.stringify({ schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA'],
    [JSON.stringify({ schemaVersion: 1, settings: defaults(), secrets: {}, history: [{ ...record(), durationMs: -1 }] }), 'STORE_CORRUPT'],
    [JSON.stringify({ schemaVersion: 1, settings: { ...defaults(), schemaVersion: 3 }, secrets: {}, history: [] }), 'UNSUPPORTED_SCHEMA'],
  ];
  for (const [content, code] of cases) {
    fs.writeFileSync(destination, content, 'utf8');
    assert.throws(() => createStore(paths, codec()).init(), expectCode(code));
    assert.equal(fs.readFileSync(destination, 'utf8'), content);
  }
});

test('failed atomic rename leaves in-memory settings unchanged and cleans temporary files', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  const destination = path.join(paths.data, 'state.json');
  const backup = path.join(paths.data, 'original.json');
  fs.renameSync(destination, backup);
  fs.mkdirSync(destination);
  const changed = defaults();
  changed.general.autoCopy = false;
  assert.throws(() => store.saveSettings(changed), expectCode('STORE_WRITE_FAILED'));
  assert.equal(store.getSettings().general.autoCopy, true);
  assert.ok(!fs.readdirSync(paths.data).some(name => name.endsWith('.tmp')));
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).settings.general.autoCopy, true);
});

test('history preserves UTF-8, keeps 200 recent records, strips foreign fields and isolates returned mutations', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  for (let index = 1; index <= 201; index++) store.addHistory({ ...record(index), apiKey: 'must-not-persist', audio: [1, 2] });
  const history = store.getHistory();
  assert.equal(history.length, 200);
  assert.equal(history[0].id, 'record-201');
  assert.equal(history[199].id, 'record-2');
  assert.equal(history[0].text, '\u4f60\u597d\uff0c\u4e16\u754c\u3002');
  history[0].text = 'changed externally';
  assert.equal(store.getHistory()[0].text, '\u4f60\u597d\uff0c\u4e16\u754c\u3002');
  assert.ok(!fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8').includes('must-not-persist'));
  store.deleteHistory('record-201');
  assert.equal(store.getHistory().length, 199);
  store.clearHistory();
  assert.deepEqual(store.getHistory(), []);
});

test('model catalog only marks complete, contained required files present; never downloads', t => {
  const { base, paths } = fixture(t);
  assert.equal(fs.readdirSync(paths.models).length, 0);
  assert.equal(getModels(paths, null).length, 8);
  assert.ok(getModels(paths, null).every(model => !model.installed && model.recommendation.level === 'unknown'));
  const baseModel = getModels(paths, null).find(model => model.id === 'whisper-base');
  const directory = path.join(paths.models, baseModel.relativePath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'model.bin'), 'fixture', 'utf8');
  assert.equal(getModels(paths, null).find(model => model.id === 'whisper-base').installed, false);
  for (const name of ['config.json', 'tokenizer.json', 'vocabulary.txt']) fs.writeFileSync(path.join(directory, name), 'fixture', 'utf8');
  assert.equal(getModels(paths, null).find(model => model.id === 'whisper-base').installed, true);
  const external = path.join(base, 'outside');
  fs.mkdirSync(external);
  fs.mkdirSync(path.join(paths.models, 'vad'));
  fs.writeFileSync(path.join(external, 'silero_vad.onnx'), 'fixture', 'utf8');
  fs.symlinkSync(external, path.join(paths.models, 'vad', 'silero-vad'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(getModels(paths, null).find(model => model.id === 'silero-vad').installed, false);
});

test('recommendations handle missing data, insufficient disk/RAM, active pressure and CPU headroom honestly', t => {
  const { paths } = fixture(t);
  const model = getModels(paths, null).find(item => item.id === 'whisper-small');
  const hardware = { memory: { totalGB: 16, freeGB: 10 }, gpus: [{ name: 'Unknown adapter', vramGB: null }], disk: { freeGB: 20 } };
  assert.equal(recommend(model, null).level, 'unknown');
  assert.equal(recommend(model, { ...hardware, memory: { totalGB: null, freeGB: 10 } }).level, 'unknown');
  assert.equal(recommend(model, { ...hardware, memory: { totalGB: 4, freeGB: 3 } }).level, 'avoid');
  assert.equal(recommend(model, { ...hardware, memory: { totalGB: 16, freeGB: 0.5 } }).level, 'avoid');
  assert.equal(recommend(model, { ...hardware, memory: { totalGB: 16, freeGB: 2 } }).level, 'caution');
  assert.equal(recommend(model, { ...hardware, disk: { freeGB: 0.1 } }).level, 'avoid');
  assert.equal(recommend(model, { ...hardware, disk: { freeGB: null } }).level, 'caution');
  assert.equal(recommend(model, hardware).level, 'recommended');
  assert.ok(recommend(model, hardware).reason.includes('CPU'));
});

test('envelopes expose intentional app errors but redact unexpected error details', async () => {
  assert.deepEqual(await envelope(() => 3), { ok: true, data: 3 });
  const result = await envelope(() => { throw new Error('secret-provider-key'); });
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(result).includes('secret-provider-key'));
  assert.equal((await envelope(() => { throw new AppError('SAMPLE', 'expected'); })).error.message, 'expected');
});

test('auto-paste defaults to true and saveSettings requires an explicit boolean', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  assert.equal(defaults().general.autoPaste, true);
  for (const value of [undefined, null, 'true', 1]) {
    const settings = defaults();
    settings.general.autoPaste = value;
    assert.throws(() => store.saveSettings(settings), expectCode('INVALID_SETTINGS'));
  }
  const settings = defaults();
  settings.general.autoPaste = false;
  store.saveSettings(settings);
  const reopened = createStore(paths, codec());
  reopened.init();
  assert.equal(reopened.getPublicSettings().general.autoPaste, false);
});

test('schema-1 additive migration preserves existing data and commits missing autoPaste/delivery only once', t => {
  const { paths } = fixture(t);
  const secretCodec = codec();
  const settings = defaults();
  delete settings.general.autoPaste;
  settings.general.autoCopy = false;
  const encrypted = secretCodec.encrypt('migration-private-key');
  const destination = path.join(paths.data, 'state.json');
  fs.writeFileSync(destination, JSON.stringify({ schemaVersion: 1, settings, secrets: { asr: encrypted }, history: [record()] }), 'utf8');
  const originalRename = fs.renameSync;
  let commits = 0;
  t.mock.method(fs, 'renameSync', (...args) => { commits++; return originalRename(...args); });
  const store = createStore(paths, secretCodec);
  store.init();
  assert.equal(store.getSettings().general.autoPaste, true);
  assert.equal(store.getSettings().general.autoCopy, false);
  assert.equal(store.getSecret('asr'), 'migration-private-key');
  assert.deepEqual(store.getHistory()[0].delivery, { status: 'not-requested', reason: '' });
  const persisted = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.equal(persisted.settings.general.autoPaste, true);
  assert.equal(persisted.secrets.asrProviders.custom.encrypted, encrypted);
  assert.equal(persisted.secrets.asr, undefined);
  assert.equal(persisted.history[0].text, record().text);
  assert.deepEqual(persisted.history[0].delivery, { status: 'not-requested', reason: '' });
  store.init();
  const reopened = createStore(paths, secretCodec);
  reopened.init();
  assert.equal(commits, 1);
  assert.deepEqual(reopened.getHistory(), store.getHistory());
});

test('history-only migration preserves explicitly disabled auto-paste and rejects malformed delivery without overwriting', t => {
  const { paths } = fixture(t);
  const settings = defaults();
  settings.general.autoPaste = false;
  const destination = path.join(paths.data, 'state.json');
  fs.writeFileSync(destination, JSON.stringify({ schemaVersion: 1, settings, secrets: {}, history: [record()] }), 'utf8');
  const store = createStore(paths, codec());
  store.init();
  const migrated = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.equal(migrated.settings.general.autoPaste, false);
  assert.equal(migrated.history[0].delivery.status, 'not-requested');
  migrated.history[0].delivery = { status: 'unknown-status', reason: '' };
  const corrupt = JSON.stringify(migrated);
  fs.writeFileSync(destination, corrupt, 'utf8');
  assert.throws(() => createStore(paths, codec()).init(), expectCode('STORE_CORRUPT'));
  assert.equal(fs.readFileSync(destination, 'utf8'), corrupt);
});

test('failed additive migration preserves the original file and keeps the store uninitialized', t => {
  const { paths } = fixture(t);
  const settings = defaults();
  delete settings.general.autoPaste;
  const destination = path.join(paths.data, 'state.json');
  const original = JSON.stringify({ schemaVersion: 1, settings, secrets: {}, history: [record()] });
  fs.writeFileSync(destination, original, 'utf8');
  t.mock.method(fs, 'renameSync', () => { const error = new Error('simulated rename failure'); error.code = 'EACCES'; throw error; });
  const store = createStore(paths, codec());
  assert.throws(() => store.init(), expectCode('STORE_WRITE_FAILED'));
  assert.throws(() => store.getSettings(), expectCode('STORE_NOT_READY'));
  assert.equal(fs.readFileSync(destination, 'utf8'), original);
  assert.ok(!fs.readdirSync(paths.data).some(name => name.endsWith('.tmp')));
});

test('delivery status and reason are strictly validated and ephemeral target fields are never persisted', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  for (const [index, status] of ['pasted', 'copied', 'skipped', 'failed', 'not-requested'].entries()) {
    const saved = store.addHistory({ ...record(index), delivery: { status, reason: '', target: { hwnd: 'ephemeral-target-handle' }, processName: 'private-process-name' }, target: 'private-target-token' });
    assert.deepEqual(saved.delivery, { status, reason: '' });
    assert.equal(saved.target, undefined);
  }
  const original = fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8');
  for (const delivery of [null, [], {}, { status: 'Pasted', reason: '' }, { status: 'unknown', reason: '' }, { status: 'copied' }, { status: 'copied', reason: null }, { status: 'copied', reason: 'x'.repeat(2001) }]) {
    assert.throws(() => store.addHistory({ ...record(100), delivery }), expectCode('INVALID_HISTORY'));
  }
  assert.equal(fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8'), original);
  for (const privateValue of ['ephemeral-target-handle', 'private-process-name', 'private-target-token']) assert.ok(!original.includes(privateValue));
});

test('delivery updates persist in place without duplicates and cannot modify immutable history or leak targets', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  store.addHistory(record(1));
  store.addHistory(record(2));
  const originalRename = fs.renameSync;
  let commits = 0;
  t.mock.method(fs, 'renameSync', (...args) => { commits++; return originalRename(...args); });
  const patch = { delivery: { status: 'pasted', reason: '', target: { token: 'native-target-token' }, windowTitle: 'private-window-title' }, warnings: ['Delivery finished.'] };
  const updated = store.updateHistory('record-1', patch);
  assert.equal(updated.id, 'record-1');
  assert.equal(updated.text, record(1).text);
  assert.equal(updated.createdAt, record(1).createdAt);
  assert.deepEqual(updated.delivery, { status: 'pasted', reason: '' });
  assert.deepEqual(updated.warnings, ['Delivery finished.']);
  store.updateHistory('record-1', patch);
  assert.equal(commits, 1);
  assert.equal(store.getHistory().length, 2);
  assert.deepEqual(store.getHistory().map(item => item.id), ['record-2', 'record-1']);
  for (const forbidden of [{ text: 'rewritten' }, { id: 'new-id' }, { target: 'native-token' }]) {
    assert.throws(() => store.updateHistory('record-1', forbidden), expectCode('INVALID_HISTORY'));
  }
  assert.throws(() => store.updateHistory('record-1', { delivery: { status: 'invalid', reason: '' } }), expectCode('INVALID_HISTORY'));
  assert.throws(() => store.updateHistory('record-1', { warnings: [3] }), expectCode('INVALID_HISTORY'));
  assert.equal(store.updateHistory('not-recorded', { delivery: { status: 'copied', reason: '' } }), null);
  assert.equal(commits, 1);
  updated.delivery.status = 'failed';
  updated.warnings.push('external mutation');
  const reopened = createStore(paths, codec());
  reopened.init();
  assert.equal(commits, 1);
  assert.deepEqual(reopened.getHistory().find(item => item.id === 'record-1').delivery, { status: 'pasted', reason: '' });
  const persisted = fs.readFileSync(path.join(paths.data, 'state.json'), 'utf8');
  assert.ok(!persisted.includes('native-target-token'));
  assert.ok(!persisted.includes('private-window-title'));
  assert.ok(!persisted.includes('external mutation'));
});

test('failed delivery update keeps original durable and in-memory outcome', t => {
  const { paths } = fixture(t);
  const store = createStore(paths, codec());
  store.init();
  store.addHistory(record());
  const destination = path.join(paths.data, 'state.json');
  const original = fs.readFileSync(destination, 'utf8');
  t.mock.method(fs, 'renameSync', () => { throw new Error('simulated disk failure'); });
  assert.throws(() => store.updateHistory('record-1', { delivery: { status: 'pasted', reason: '' } }), expectCode('STORE_WRITE_FAILED'));
  assert.deepEqual(store.getHistory()[0].delivery, { status: 'not-requested', reason: '' });
  assert.equal(fs.readFileSync(destination, 'utf8'), original);
});
