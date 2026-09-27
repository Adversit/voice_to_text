'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseShortcut, formatShortcut: coreFormat } = require('../core/shortcuts.cjs');
const { defaults } = require('../core/contracts.cjs');
const rendererRoot = path.join(__dirname, '..', 'renderer');
const helperSource = fs.readFileSync(path.join(rendererRoot, 'shortcuts.js'), 'utf8').replace(/^export /gm, '');
const helperContext = vm.createContext({});
vm.runInContext(helperSource + '\nglobalThis.helpers = {formatShortcut, shortcutFromCodes, createShortcutCaptureState};', helperContext);
const helpers = helperContext.helpers;
const event = (code, extra = {}) => ({ code, key: code, repeat: false, isComposing: false, getModifierState: () => false, preventDefault() {}, stopPropagation() {}, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('display formatter matches core, including legacy reserved settings', () => {
  for (const value of ['RightAlt', 'CommandOrControl+Alt+Space', 'Ctrl+F12', 'Alt+F4', 'Super+V', 'Control+Shift+PageDown', 'Alt+Up', 'Control+Enter', 'Shift+Delete']) assert.equal(helpers.formatShortcut(value), coreFormat(value));
});

test('capture grammar matches canonical validation across modifier/key combinations', () => {
  const modifiers = [['ControlLeft', 'Control'], ['AltRight', 'Alt'], ['ShiftRight', 'Shift'], ['MetaLeft', 'Super']];
  const keys = [['Space', 'Space'], ['Tab', 'Tab'], ['Enter', 'Enter'], ['Backspace', 'Backspace'], ['Delete', 'Delete'], ['Insert', 'Insert'], ['Home', 'Home'], ['End', 'End'], ['PageUp', 'PageUp'], ['PageDown', 'PageDown'], ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'], ...Array.from({ length: 26 }, (_, i) => ['Key' + String.fromCharCode(65 + i), String.fromCharCode(65 + i)]), ...Array.from({ length: 10 }, (_, i) => ['Digit' + i, String(i)]), ...Array.from({ length: 24 }, (_, i) => ['F' + (i + 1), 'F' + (i + 1)])];
  for (let mask = 0; mask < 16; mask++) for (const [code, key] of keys) {
    const selected = modifiers.filter((_, index) => mask & 1 << index);
    const value = [...selected.map(item => item[1]), key].join('+');
    let allowed = true;
    try { parseShortcut(value); } catch { allowed = false; }
    const result = helpers.shortcutFromCodes([...selected.map(item => item[0]), code]);
    assert.equal(result.ok, allowed, value);
    if (allowed) assert.equal(parseShortcut(result.value).value, value);
  }
});

test('Right Alt is standalone and commits only on release; ordinary modifiers ignore side', () => {
  const capture = helpers.createShortcutCaptureState();
  assert.equal(capture.keydown(event('AltRight')).type, 'preview');
  assert.equal(capture.keydown(event('AltRight', { repeat: true })).type, 'ignored');
  assert.equal(capture.keyup(event('AltRight')).value, 'RightAlt');
  assert.equal(helpers.shortcutFromCodes(['AltLeft']).ok, false);
  assert.equal(helpers.shortcutFromCodes(['ControlRight', 'ShiftLeft', 'KeyK']).value, 'Control+Shift+K');
});

test('chords wait for all releases; Escape clears capture; AltGr/composition do not commit', () => {
  const capture = helpers.createShortcutCaptureState();
  capture.keydown(event('ControlLeft')); capture.keydown(event('KeyK'));
  assert.equal(capture.keyup(event('KeyK')).type, 'preview');
  assert.equal(capture.keyup(event('ControlLeft')).value, 'Control+K');
  capture.keydown(event('AltRight', { getModifierState: name => name === 'AltGraph' }));
  assert.equal(capture.keyup(event('AltRight')).type, 'invalid');
  capture.keydown(event('KeyA', { isComposing: true }));
  assert.equal(capture.keyup(event('KeyA')).type, 'ignored');
  capture.keydown(event('F8')); assert.equal(capture.keyup(event('F8')).value, 'F8');
  capture.keydown(event('AltRight')); assert.equal(capture.keydown(event('Escape')).type, 'cancel');
  assert.equal(capture.keyup(event('AltRight')).type, 'ignored');
});

function harness(options = {}) {
  const env = { calls: [], callbacks: {}, renders: 0, focused: true, errors: [], timers: new Map(), nextTimer: 0 };
  const snapshot = { settings: defaults(), history: [], models: [], paths: {}, runtime: { shortcut: 'RightAlt', shortcutRegistered: true, shortcutSuspended: false } };
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', classList: { toggle() {} }, focus() {}, scrollTo() {} });
    return nodes.get(selector);
  };
  const api = {};
  api.beginShortcutCapture = async () => { env.calls.push(['beginShortcutCapture']); if (options.begin) await options.begin.promise; snapshot.runtime.shortcutSuspended = true; return { ok: true, data: { token: 'capture-token' } }; };
  api.endShortcutCapture = async payload => { env.calls.push(['endShortcutCapture', payload]); if (options.end) await options.end.promise; snapshot.runtime.shortcutSuspended = false; return { ok: true, data: snapshot }; };
  api.beginRecording = async payload => { env.calls.push(['beginRecording', payload]); throw new Error('Recording must not start while capturing'); };
  api.saveSettings = async payload => { env.calls.push(['saveSettings', payload]); snapshot.settings = JSON.parse(JSON.stringify(payload.settings)); return { ok: true, data: snapshot }; };
  for (const name of ['onToggleRecording', 'onStateChanged', 'onNotice', 'onMonitoring']) api[name] = callback => { env.callbacks[name] = callback; return () => {}; };
  const document = { querySelector: node, hasFocus: () => env.focused, hidden: false, addEventListener: (name, fn) => { (env.callbacks[name] ||= []).push(fn); } };
  const context = vm.createContext({ window: { murmur: api, addEventListener: (name, fn) => { env.callbacks[name] = fn; } }, document, MicrophoneRecorder: class { dispose() {} }, icon: () => '', hydrateIcons() {}, formatShortcut: helpers.formatShortcut, createShortcutCaptureState: helpers.createShortcutCaptureState, env,
    setTimeout: fn => { const id = ++env.nextTimer; env.timers.set(id, fn); return id; }, clearTimeout: id => env.timers.delete(id) });
  const source = fs.readFileSync(path.join(rendererRoot, 'app.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const split = source.indexOf('const unsubscribe = [];');
  vm.runInContext(source.slice(0, split) + '\nrender=()=>env.renders++;toast=(message,kind)=>{if(kind===\'error\')env.errors.push(message);};initialize=async()=>{};globalThis.ui={state,beginShortcutCapture,cancelShortcutCapture,setShortcutDraft,navigate,saveSettings};', context);
  vm.runInContext(source.slice(split), context);
  const ui = context.ui;
  ui.state.snapshot = snapshot; ui.state.page = 'settings';
  const fire = async (name, payload = {}) => { for (const fn of env.callbacks[name] || []) fn(payload); await flush(); };
  return { env, ui, snapshot, document, fire };
}

test('pending suspension ignores keys/toggles; late token is released after cancel', async () => {
  const begin = deferred(); const { ui, env, fire } = harness({ begin });
  const pending = ui.beginShortcutCapture();
  await fire('keydown', event('AltRight')); await fire('keyup', event('AltRight'));
  env.callbacks.onToggleRecording({ trigger: 'shortcut' });
  assert.equal(ui.state.dirty, false);
  const canceled = ui.cancelShortcutCapture(); begin.resolve();
  await Promise.all([pending, canceled]);
  assert.equal(env.calls.filter(item => item[0] === 'endShortcutCapture').length, 1);
  assert(!env.calls.some(item => item[0] === 'beginRecording'));
  assert.equal(ui.state.shortcutCapture, null);
});

test('accepted released candidate changes only shortcut draft and preserves key drafts', async () => {
  const { ui, fire } = harness();
  ui.state.draft = JSON.parse(JSON.stringify(ui.state.snapshot.settings)); ui.state.draft.asr.language = 'zh'; ui.state.dirty = true;
  ui.state.keys = { asr: 'draft-secret' }; const keys = ui.state.keys;
  await ui.beginShortcutCapture();
  await fire('keydown', event('ControlRight')); await fire('keydown', event('F8'));
  await fire('keyup', event('F8')); assert.equal(ui.state.draft.general.shortcut, 'RightAlt');
  await fire('keyup', event('ControlRight'));
  assert.equal(ui.state.draft.general.shortcut, 'Control+F8');
  assert.equal(ui.state.draft.asr.language, 'zh'); assert.equal(ui.state.keys, keys);
  assert.equal(ui.state.snapshot.settings.general.shortcut, 'RightAlt');
  assert.equal(ui.state.shortcutCapture, null);
});

test('invalid reserved candidate leaves saved/draft shortcut unchanged and can retry', async () => {
  const { ui, fire } = harness(); await ui.beginShortcutCapture();
  await fire('keydown', event('ControlLeft')); await fire('keydown', event('KeyV'));
  await fire('keyup', event('KeyV')); await fire('keyup', event('ControlLeft'));
  assert.equal(ui.state.dirty, false); assert.equal(ui.state.shortcutCapture.phase, 'active'); assert(ui.state.shortcutCapture.message);
  await fire('keydown', event('AltRight')); await fire('keyup', event('AltRight'));
  assert.equal(ui.state.draft.general.shortcut, 'RightAlt');
});

test('Escape, blur and navigation release capture without replacing unsaved settings', async () => {
  for (const method of ['escape', 'blur', 'navigation']) {
    const { ui, env, fire } = harness(); ui.state.draft = JSON.parse(JSON.stringify(ui.state.snapshot.settings)); ui.state.draft.polish.style = 'concise'; ui.state.dirty = true;
    await ui.beginShortcutCapture();
    if (method === 'escape') await fire('keydown', event('Escape'));
    if (method === 'blur') { env.focused = false; env.callbacks.blur(); await flush(); }
    if (method === 'navigation') await ui.navigate('history');
    assert.equal(ui.state.shortcutCapture, null, method); assert.equal(ui.state.draft.polish.style, 'concise', method);
    assert.equal(env.calls.filter(item => item[0] === 'endShortcutCapture').length, 1, method);
  }
});

test('lease expiry cancels only active capture; background state events keep draft', async () => {
  const { ui, env, snapshot } = harness(); await ui.beginShortcutCapture();
  ui.state.draft = JSON.parse(JSON.stringify(snapshot.settings)); ui.state.draft.asr.language = 'en'; ui.state.dirty = true;
  await env.callbacks.onStateChanged({ ...snapshot, runtime: { ...snapshot.runtime, shortcutSuspended: false } });
  assert.equal(ui.state.shortcutCapture, null); assert.equal(ui.state.draft.asr.language, 'en');
  assert.equal(env.calls.filter(item => item[0] === 'endShortcutCapture').length, 1);
});

test('save ends capture before persisting; reset helper alters only draft; unload releases token', async () => {
  const { ui, env } = harness(); ui.state.draft = JSON.parse(JSON.stringify(ui.state.snapshot.settings)); ui.state.draft.asr.language = 'en'; ui.state.dirty = true;
  ui.setShortcutDraft('Control+F8'); ui.setShortcutDraft('RightAlt'); assert.equal(ui.state.draft.asr.language, 'en');
  await ui.beginShortcutCapture(); await ui.saveSettings();
  assert.deepEqual(env.calls.map(item => item[0]), ['beginShortcutCapture', 'endShortcutCapture', 'saveSettings']);
  await ui.beginShortcutCapture(); env.callbacks.beforeunload(); await flush();
  assert.equal(env.calls.filter(item => item[0] === 'endShortcutCapture').length, 2);
});

test('blur while release is pending drops candidate rather than overwriting draft', async () => {
  const end = deferred(); const { ui, env, fire } = harness({ end }); await ui.beginShortcutCapture();
  await fire('keydown', event('F9')); await fire('keyup', event('F9'));
  assert.equal(ui.state.shortcutCapture.phase, 'releasing'); env.focused = false; env.callbacks.blur(); end.resolve(); await flush();
  assert.equal(ui.state.dirty, false); assert.equal(ui.state.shortcutCapture, null);
  assert.equal(env.calls.filter(item => item[0] === 'endShortcutCapture').length, 1);
});
