'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SHORTCUT, parseShortcut, formatShortcut } = require('../core/shortcuts.cjs');
const { AppError, defaults, validateSettings, envelope } = require('../core/contracts.cjs');
const { createStore } = require('../core/store.cjs');
const { createPaths, assertContained } = require('../core/paths.cjs');

const ROOT = path.resolve(__dirname, '..');
const invalid = error => error.code === 'INVALID_SETTINGS' && error instanceof Error;
const codec = { available: () => true, encrypt: value => Buffer.from(value, 'utf8').toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString('utf8') };
const record = { id: 'history-one', createdAt: '2026-09-27T10:00:00.000Z', text: 'existing final text', rawText: 'existing raw text', durationMs: 1500,
  source: 'local', model: 'existing-model', warnings: ['Existing warning.'], delivery: { status: 'copied', reason: 'Existing reason.' } };
function fixture(t) {
  const cache = assertContained(ROOT, path.join(ROOT, 'cache'));
  fs.mkdirSync(cache, { recursive: true });
  const root = fs.mkdtempSync(path.join(cache, 'shortcut-test-'));
  const paths = createPaths(root);
  t.after(() => { assertContained(cache, root); fs.rmSync(root, { recursive: true, force: true }); });
  return { paths, file: path.join(paths.data, 'state.json') };
}
function oldState(shortcut = 'CommandOrControl+Alt+Space') {
  const settings = defaults();
  settings.general.shortcut = shortcut;
  settings.general.autoCopy = false;
  settings.general.autoPaste = false;
  settings.asr.language = 'en';
  settings.vad.mode = 'off';
  settings.polish.style = 'formal';
  return { schemaVersion: 1, settings, secrets: { asr: codec.encrypt('existing private key') }, history: [structuredClone(record)] };
}

test('RightAlt is the native default and function keys work alone except reserved F12', () => {
  assert.equal(DEFAULT_SHORTCUT, 'RightAlt');
  assert.equal(defaults().general.shortcut, DEFAULT_SHORTCUT);
  assert.deepEqual(parseShortcut('RightAlt'), { value: 'RightAlt', kind: 'native', keyCode: 165 });
  assert.deepEqual(parseShortcut(' RightAlt '), { value: 'RightAlt', kind: 'native', keyCode: 165 });
  for (let index = 1; index <= 24; index++) {
    const value = `F${index}`;
    if (index === 12) { assert.throws(() => parseShortcut(value), invalid); continue; }
    assert.deepEqual(parseShortcut(value), { value, kind: 'accelerator', keyCode: 111 + index });
  }
});

test('accelerator parser preserves alias spelling and modifier order with complete primary-key mappings', () => {
  const keys = { Space: 32, Tab: 9, Enter: 13, Backspace: 8, Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34, Up: 38, Down: 40, Left: 37, Right: 39 };
  for (const [key, keyCode] of Object.entries(keys)) {
    const value = `Control+Shift+${key}`;
    assert.deepEqual(parseShortcut(value), { value, kind: 'accelerator', keyCode });
  }
  for (const key of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') assert.equal(parseShortcut(`Control+Alt+${key}`).keyCode, key.charCodeAt(0));
  for (const value of ['Alt+CommandOrControl+Space', 'Ctrl+Alt+Space', 'Control+Alt+Space', 'Command+F9', 'Super+F9', 'Shift+Alt+Ctrl+F24']) {
    assert.equal(parseShortcut(` ${value} `).value, value);
  }
});

test('duplicates, plain typing keys, unsupported forms and every F12 variant are rejected with a safe error code', () => {
  const values = [undefined, null, 165, {}, [], '', ' ', '\nRightAlt', 'RightAlt\0', 'rightalt', 'AltRight', 'Alt', 'Control', 'Shift',
    'Ctrl+RightAlt', 'RightAlt+Q', 'Space', 'Enter', 'A', '1', 'F0', 'F25', 'F01', 'Ctrl+Fn', 'Ctrl+Escape', 'ctrl+A', 'Ctrl+a',
    'Ctrl++A', 'Ctrl + A', '+F9', 'Ctrl+Control+A', 'CommandOrControl+Ctrl+Space', 'Command+Super+F9', 'Alt+Alt+F9', 'Shift+Shift+F9', 'x'.repeat(101)];
  for (const value of values) assert.throws(() => parseShortcut(value), invalid, String(value));
  for (const prefix of ['', 'Ctrl+', 'Alt+', 'Shift+', 'Super+', 'Ctrl+Alt+Shift+Super+']) assert.throws(() => parseShortcut(`${prefix}F12`), invalid);
});

test('clipboard and common Windows combinations reject aliases and modifier permutations without banning distinct custom chords', () => {
  for (const control of ['Ctrl', 'Control', 'CommandOrControl']) {
    assert.throws(() => parseShortcut(`${control}+V`), error => invalid(error) && error.message.includes('Ctrl+V'));
    for (const value of [`${control}+Alt+Delete`, `Alt+${control}+Delete`]) assert.throws(() => parseShortcut(value), invalid);
    for (const win of ['Super', 'Command']) {
      for (const key of ['D', 'F4', 'Left', 'Right']) {
        for (const value of [`${win}+${control}+${key}`, `${control}+${win}+${key}`]) assert.throws(() => parseShortcut(value), invalid);
      }
    }
  }
  for (const win of ['Super', 'Command']) {
    for (const key of ['L', 'D', 'E', 'R', 'I', 'U', 'A', 'S', 'X', 'M', 'V', 'Tab', 'Space']) assert.throws(() => parseShortcut(`${win}+${key}`), invalid);
    for (const value of [`${win}+Shift+M`, `Shift+${win}+M`]) assert.throws(() => parseShortcut(value), invalid);
  }
  for (const value of ['Alt+F4', 'Alt+Tab']) assert.throws(() => parseShortcut(value), invalid);
  for (const value of ['Ctrl+Shift+V', 'Alt+Control+V', 'Control+Alt+Space', 'Alt+F9', 'Super+F9']) assert.equal(parseShortcut(value).value, value);
});

test('display labels derive from validated shortcuts and contract failures remain AppError envelopes', async () => {
  assert.equal(formatShortcut('RightAlt'), '右 Alt');
  assert.equal(formatShortcut('CommandOrControl+Alt+Space'), 'Ctrl + Alt + 空格');
  assert.equal(formatShortcut('Command+F9'), 'Win + F9');
  assert.equal(formatShortcut('Ctrl+Enter'), 'Ctrl + 回车');
  assert.equal(formatShortcut('Ctrl+Left'), 'Ctrl + ←');
  assert.equal(formatShortcut('F9'), 'F9');
  assert.equal(formatShortcut('Ctrl+V'), 'Ctrl + V');
  assert.equal(formatShortcut('Alt+F12'), 'Alt + F12');
  assert.throws(() => formatShortcut('Ctrl+Fn'), invalid);
  const settings = defaults(); settings.general.shortcut = 'Control+V';
  assert.throws(() => validateSettings(settings), error => error instanceof AppError && error.code === 'INVALID_SETTINGS');
  const result = await envelope(() => validateSettings(settings));
  assert.equal(result.error.code, 'INVALID_SETTINGS');
  assert.ok(result.error.message.includes('Ctrl+V'));
});

test('new storage includes a private migration marker without exposing it in settings or history', t => {
  const { paths, file } = fixture(t);
  const store = createStore(paths, codec); store.init();
  const durable = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(durable.settings.general.shortcut, 'RightAlt');
  assert.deepEqual(durable.migrations, { rightAltDefault: 1 });
  assert.equal(store.getSettings().migrations, undefined);
  assert.ok(!JSON.stringify(store.getPublicSettings()).includes('rightAltDefault'));
  store.addHistory(record);
  assert.ok(!JSON.stringify(store.getHistory()).includes('rightAltDefault'));
});

test('legacy exact default migrates once atomically, preserving other settings, ciphertext and history', t => {
  const { paths, file } = fixture(t);
  const original = oldState();
  fs.writeFileSync(file, JSON.stringify(original), 'utf8');
  const rename = fs.renameSync; let commits = 0;
  t.mock.method(fs, 'renameSync', (...args) => { commits++; return rename(...args); });
  const store = createStore(paths, codec); store.init();
  const expected = structuredClone(original);
  expected.settings.general.shortcut = 'RightAlt'; expected.migrations = { rightAltDefault: 1 };
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), expected);
  assert.equal(store.getSecret('asr'), 'existing private key');
  const reopened = createStore(paths, codec); reopened.init(); reopened.init();
  assert.equal(commits, 1);
  assert.deepEqual(reopened.getSettings(), expected.settings);
  assert.deepEqual(reopened.getHistory(), original.history);
});

test('custom shortcuts and old-default aliases are preserved while each unmarked store is marked once', t => {
  const { paths, file } = fixture(t);
  for (const shortcut of ['Ctrl+Alt+Space', 'Control+Alt+Space', 'Alt+CommandOrControl+Space', 'RightAlt', 'Ctrl+F9', 'F24', 'Ctrl+Enter']) {
    const original = oldState(shortcut);
    fs.writeFileSync(file, JSON.stringify(original), 'utf8');
    const store = createStore(paths, codec); store.init();
    assert.deepEqual(store.getSettings(), original.settings);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ...original, migrations: { rightAltDefault: 1 } });
  }
});

test('stored reserved combinations remain readable and displayable but strict registration and saving reject them', t => {
  const { paths, file } = fixture(t);
  for (const shortcut of ['Ctrl+F12', 'Alt+F4', 'Command+V', 'Super+L', 'Ctrl+V']) {
    const original = oldState(shortcut);
    fs.writeFileSync(file, JSON.stringify(original), 'utf8');
    const store = createStore(paths, codec); store.init();
    assert.deepEqual(store.getSettings(), original.settings);
    assert.doesNotThrow(() => formatShortcut(store.getPublicSettings().general.shortcut));
    assert.throws(() => parseShortcut(shortcut), invalid);
    const previous = fs.readFileSync(file, 'utf8');
    assert.throws(() => store.saveSettings(store.getSettings()), error => error instanceof AppError && error.code === 'INVALID_SETTINGS');
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
    const reopened = createStore(paths, codec); reopened.init();
    assert.equal(reopened.getSettings().general.shortcut, shortcut);
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
    const corrected = reopened.getSettings(); corrected.general.shortcut = 'RightAlt';
    reopened.saveSettings(corrected);
    assert.equal(reopened.getSettings().general.shortcut, 'RightAlt');
  }
  for (const shortcut of ['Ctrl+Fn', 'Ctrl++A', 'Ctrl+Ctrl+A', 'Z']) {
    const previous = JSON.stringify(oldState(shortcut));
    fs.writeFileSync(file, previous, 'utf8');
    assert.throws(() => createStore(paths, codec).init(), error => error.code === 'STORE_CORRUPT');
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
  }
});

test('choosing the former default after migration persists across reopening and other mutations', t => {
  const { paths, file } = fixture(t);
  fs.writeFileSync(file, JSON.stringify(oldState()), 'utf8');
  const store = createStore(paths, codec); store.init();
  const settings = store.getSettings(); settings.general.shortcut = 'CommandOrControl+Alt+Space';
  store.saveSettings(settings);
  store.updateHistory(record.id, { delivery: { status: 'skipped', reason: 'existing text remains' } });
  const previous = fs.readFileSync(file, 'utf8');
  const reopened = createStore(paths, codec); reopened.init();
  assert.equal(reopened.getSettings().general.shortcut, 'CommandOrControl+Alt+Space');
  assert.equal(fs.readFileSync(file, 'utf8'), previous);
  assert.deepEqual(JSON.parse(previous).migrations, { rightAltDefault: 1 });
});

test('shortcut, auto-paste and delivery migrations share one commit and never reset explicit choices', t => {
  const { paths, file } = fixture(t);
  const original = oldState();
  delete original.settings.general.autoPaste; delete original.history[0].delivery;
  fs.writeFileSync(file, JSON.stringify(original), 'utf8');
  const rename = fs.renameSync; let commits = 0;
  t.mock.method(fs, 'renameSync', (...args) => { commits++; return rename(...args); });
  const store = createStore(paths, codec); store.init();
  assert.equal(commits, 1);
  assert.equal(store.getSettings().general.shortcut, 'RightAlt');
  assert.equal(store.getSettings().general.autoPaste, true);
  assert.equal(store.getSettings().general.autoCopy, false);
  assert.deepEqual(store.getHistory()[0].delivery, { status: 'not-requested', reason: '' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).secrets.asr, original.secrets.asr);
});

test('unknown or malformed migration metadata is rejected without replacing existing bytes', t => {
  const { paths, file } = fixture(t);
  for (const migrations of [null, [], {}, 1, '1', { rightAltDefault: 0 }, { rightAltDefault: 2 }, { rightAltDefault: '1' }, { rightAltDefault: 1, future: 1 }]) {
    const source = JSON.stringify({ ...oldState(), migrations });
    fs.writeFileSync(file, source, 'utf8');
    const store = createStore(paths, codec);
    assert.throws(() => store.init(), error => error.code === 'STORE_CORRUPT');
    assert.throws(() => store.getSettings(), error => error.code === 'STORE_NOT_READY');
    assert.equal(fs.readFileSync(file, 'utf8'), source);
  }
});

test('failed shortcut migration preserves durable bytes and leaves no initialized state or temporary files', t => {
  const { paths, file } = fixture(t);
  const source = JSON.stringify(oldState());
  fs.writeFileSync(file, source, 'utf8');
  t.mock.method(fs, 'renameSync', () => { throw new Error('fixture rename failure'); });
  const store = createStore(paths, codec);
  assert.throws(() => store.init(), error => error.code === 'STORE_WRITE_FAILED');
  assert.throws(() => store.getSettings(), error => error.code === 'STORE_NOT_READY');
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.ok(!fs.readdirSync(paths.data).some(name => name.endsWith('.tmp')));
});
