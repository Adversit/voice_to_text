'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { defaults } = require('../core/contracts.cjs');
const { getSpeechProviders } = require('../core/speech-apis.cjs');
const rendererRoot = path.join(__dirname, '..', 'renderer');
const source = fs.readFileSync(path.join(rendererRoot, 'app.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const env = { calls: [], callbacks: {}, notices: [], renders: 0 };
  const settings = defaults();
  Object.assign(settings.asr, { mode: 'cloud', engine: 'openai', provider: 'custom', endpoint: 'https://api.openai.com/v1', apiModel: 'whisper-1', hasKey: false, keyEndpoints: {} });
  const snapshot = { settings, speechProviders: getSpeechProviders(), history: [], models: [], paths: { models: 'G:\\project\\models' }, runtime: { encryptionAvailable: true, autoPasteAvailable: true, shortcutRegistered: true } };
  const nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', disabled: false, classList: { toggle() {} }, scrollTo() {} }); return nodes.get(selector); };
  const api = {
    saveSettings: async payload => { env.calls.push(['saveSettings', plain(payload)]); snapshot.settings = plain(payload.settings); return { ok: true, data: snapshot }; },
    openProviderLink: async payload => { env.calls.push(['openProviderLink', plain(payload)]); return { ok: true, data: null }; },
  };
  const document = { querySelector: node, hasFocus: () => false, addEventListener: (name, fn) => { (env.callbacks[name] ||= []).push(fn); } };
  const context = vm.createContext({ window: { murmur: api, addEventListener() {} }, document, URL, setTimeout, clearTimeout, MicrophoneRecorder: class {}, icon: () => '', formatShortcut: value => value, env });
  vm.runInContext(source.slice(0, source.indexOf('const unsubscribe = [];')) + '\nrender=()=>env.renders++;toast=(message,kind)=>env.notices.push({message,kind});globalThis.ui={state,renderSettings,renderCloudAsr,renderModels,asrKeyStatus,asrKeyContents,hasAsrKey,normalizeEndpoint,applySettingsInput,saveSettings,updateSnapshot,routeSummary};', context);
  const ui = context.ui;
  ui.state.snapshot = snapshot; ui.state.page = 'settings';
  const fire = async (name, event) => { for (const fn of env.callbacks[name] || []) await fn(event); };
  const edit = async (name, value, type = 'text') => { const target = { name, value, type, checked: Boolean(value), closest: selector => selector === '#settings-form' }; await fire('input', { target }); await fire('change', { target }); };
  const click = async (action, provider) => { const target = { type: 'button', dataset: { action, provider, url: 'https://untrusted.invalid/' }, matches: () => false }; await fire('click', { target: { closest: () => target }, preventDefault() {} }); };
  return { ui, env, snapshot, edit, click, nodes };
}

test('five provider entries render with official selects and editable model suggestions', async () => {
  const { ui, edit, snapshot } = harness();
  assert.equal(snapshot.speechProviders.length, 5);
  for (const provider of snapshot.speechProviders) {
    await edit('asr.provider', provider.id);
    const html = ui.renderSettings();
    assert(html.includes(provider.name));
    assert(html.includes('name="asr.apiModel"'));
    assert(html.includes('list="speech-model-suggestions"'));
    for (const model of provider.models) assert(html.includes(`value="${model}"`));
    assert.equal(html.includes('<select name="asr.endpoint">'), provider.id !== 'custom');
    assert.equal(html.includes('<input name="asr.endpoint"'), provider.id === 'custom');
    assert(html.includes('待填写密钥'));
    assert.equal(ui.state.draft.asr.engine, 'openai');
  }
  assert.equal(snapshot.settings.asr.provider, 'custom', 'draft selection never mutates saved settings');
});

test('credential status matches exact draft provider and normalized address, never saved hasKey alone', async () => {
  const { ui, snapshot, edit } = harness();
  snapshot.settings.asr.hasKey = true;
  snapshot.settings.asr.keyEndpoints = { custom: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1' };
  assert.equal(ui.hasAsrKey(), true);
  await edit('asr.provider', 'openai');
  assert.equal(ui.hasAsrKey(), false, 'same endpoint under a different provider cannot reuse key');
  assert.equal(ui.asrKeyStatus(), '待填写密钥');
  await edit('asr.provider', 'groq');
  assert.equal(ui.hasAsrKey(), true);
  assert.equal(ui.asrKeyStatus(), '已配置，尚未实际验证');
  await edit('asr.provider', 'custom');
  await edit('asr.endpoint', 'https://api.openai.com/v2');
  assert.equal(ui.hasAsrKey(), false);
  assert(ui.asrKeyContents().includes('当前地址不会使用它'));
  await edit('asr.endpoint', 'https://API.OPENAI.COM:443/v1/');
  assert.equal(ui.hasAsrKey(), false, 'stored key addresses use exact trim/trailing-slash normalization');
  snapshot.settings.asr.keyEndpoints.custom = 'https://API.OPENAI.COM:443/v1';
  assert.equal(ui.hasAsrKey(), true);
  await edit('asr.endpoint', 'https://api.openai.com/v1');
  assert.equal(ui.hasAsrKey(), false, 'URL-equivalent addresses do not match a differently spelled stored binding');
  delete snapshot.settings.asr.keyEndpoints;
  assert.equal(ui.hasAsrKey(), false, 'absent public binding map is unknown');
});

test('provider switches discard only ASR secret/deletion drafts and fill the selected defaults', async () => {
  const { ui, edit, snapshot, env } = harness();
  await edit('general.shortcut', 'Control+F8');
  await edit('polish.apiModel', 'private-polish');
  await edit('vad.threshold', '0.02', 'number');
  await edit('key.asr', 'old-provider-secret');
  await edit('key.polish', 'polish-secret');
  await edit('clearKey.asr', true, 'checkbox');
  await edit('clearKey.polish', true, 'checkbox');
  const unrelated = plain({ general: ui.state.draft.general, polish: ui.state.draft.polish, vad: ui.state.draft.vad });
  await edit('asr.provider', 'siliconflow');
  const provider = snapshot.speechProviders.find(item => item.id === 'siliconflow');
  assert.equal(ui.state.draft.asr.endpoint, provider.defaultEndpoint);
  assert.equal(ui.state.draft.asr.apiModel, provider.defaultModel);
  assert.equal(ui.state.keys.asr, undefined);
  assert.equal(ui.state.clearKeys.asr, undefined);
  assert.equal(ui.state.keys.polish, 'polish-secret');
  assert.equal(ui.state.clearKeys.polish, true);
  assert.deepEqual(plain({ general: ui.state.draft.general, polish: ui.state.draft.polish, vad: ui.state.draft.vad }), unrelated);
  assert.equal(env.notices.length, 1);
  assert.equal(env.calls.length, 0, 'selecting provider performs no IPC or network request');
});

test('region/custom address edits discard unsaved ASR keys and do not restore them on switch back', async () => {
  const { ui, edit, snapshot } = harness();
  await edit('asr.provider', 'dashscope');
  const [beijing, singapore] = snapshot.speechProviders.find(item => item.id === 'dashscope').endpoints;
  snapshot.settings.asr.keyEndpoints = { dashscope: beijing.value };
  await edit('key.asr', 'beijing-secret'); await edit('clearKey.asr', true, 'checkbox');
  await edit('asr.endpoint', singapore.value);
  assert.equal(ui.state.keys.asr, undefined); assert.equal(ui.state.clearKeys.asr, undefined);
  assert.equal(ui.hasAsrKey(), false);
  await edit('asr.endpoint', beijing.value);
  assert.equal(ui.state.keys.asr, undefined); assert.equal(ui.hasAsrKey(), true);
  await edit('asr.provider', 'custom'); await edit('key.asr', 'custom-secret');
  await edit('asr.endpoint', 'https://different.example/v1');
  assert.equal(ui.state.keys.asr, undefined);
  await edit('key.asr', 'new-secret'); await edit('asr.endpoint', 'https://different.example/v1/');
  assert.equal(ui.state.keys.asr, 'new-secret', 'equivalent normalized binding is not a different address');
});

test('local/cloud mode endpoint rewrites cannot carry an unsaved key', async () => {
  const { ui, edit } = harness();
  await edit('key.asr', 'cloud-secret'); await edit('key.polish', 'keep-polish');
  await edit('asr.mode', 'local');
  assert.equal(ui.state.keys.asr, undefined);
  assert.equal(ui.state.draft.asr.engine, 'faster-whisper');
  await edit('key.asr', 'local-secret'); await edit('asr.mode', 'cloud');
  assert.equal(ui.state.keys.asr, undefined); assert.equal(ui.state.keys.polish, 'keep-polish');
  assert.equal(ui.state.draft.asr.engine, 'openai');
});

test('save after provider switch omits old ASR key, preserves polish key, and binds a new explicit key only to current provider', async () => {
  const { ui, edit, env } = harness();
  await edit('key.asr', 'do-not-reuse'); await edit('key.polish', 'retain-polish');
  await edit('asr.provider', 'groq'); await ui.saveSettings();
  const first = env.calls.at(-1)[1];
  assert.equal(first.settings.asr.provider, 'groq');
  assert.equal(Object.hasOwn(first.keys, 'asr'), false);
  assert.equal(first.keys.polish, 'retain-polish');
  assert(!JSON.stringify(first).includes('do-not-reuse'));
  await edit('key.asr', 'new-groq-secret');
  assert.equal(ui.asrKeyStatus(), '密钥待保存 · 尚未实际验证');
  await ui.saveSettings();
  const second = env.calls.at(-1)[1];
  assert.equal(second.settings.asr.provider, 'groq'); assert.equal(second.keys.asr, 'new-groq-secret');
  assert.equal(second.settings.asr.endpoint, 'https://api.groq.com/openai/v1');
});

test('explicit clear affects selected provider through unchanged save envelope; keys are optional', async () => {
  const { ui, edit, env } = harness();
  await edit('asr.provider', 'dashscope'); await edit('clearKey.asr', true, 'checkbox');
  assert.equal(ui.asrKeyStatus(), '保存后清除此服务商的密钥');
  await ui.saveSettings();
  assert.deepEqual(env.calls.at(-1)[1].keys, { asr: '' });
  await edit('asr.provider', 'openai'); await ui.saveSettings();
  assert.deepEqual(env.calls.at(-1)[1].keys, {});
});

test('public status and credential drafts remain bound across background snapshots', async () => {
  const { ui, edit, snapshot } = harness();
  await edit('asr.provider', 'groq'); await edit('key.asr', 'draft-key');
  ui.updateSnapshot({ ...snapshot, settings: plain(snapshot.settings) });
  assert.equal(ui.state.draft.asr.provider, 'groq'); assert.equal(ui.state.keys.asr, 'draft-key');
  assert.equal(ui.hasAsrKey(), false);
  ui.state.keys = {}; ui.state.snapshot.settings.asr.keyEndpoints = { custom: 'https://api.openai.com/v1' };
  assert.equal(ui.routeSummary().status, '已配置，尚未实际验证', 'workbench uses saved route, not unsaved draft');
});

test('UI credential binding preserves exact endpoint spelling beyond trim/trailing slashes', () => {
  const { ui } = harness();
  for (const endpoint of ['https://API.OPENAI.COM:443/v1/', 'https://api.groq.com/openai/v1', ' https://custom.example/path// ', 'https://custom.example']) {
    assert.equal(ui.normalizeEndpoint(endpoint), endpoint.trim().replace(/\/+$/, ''));
  }
  assert.equal(ui.normalizeEndpoint(null), '');
});

test('provider links use only provider ID and docs/key kinds through main IPC', async () => {
  const { click, env } = harness();
  await click('provider-docs', 'dashscope'); await click('provider-key', 'groq');
  assert.deepEqual(env.calls, [['openProviderLink', { provider: 'dashscope', kind: 'docs' }], ['openProviderLink', { provider: 'groq', kind: 'key' }]]);
  assert(!/window\.open\(|fetch\(|XMLHttpRequest/.test(source));
});

test('untrusted metadata is escaped; model preparation wording reports files rather than a download ban', () => {
  const { ui, snapshot } = harness();
  snapshot.speechProviders[0].name = '<unsafe-name>';
  snapshot.speechProviders[0].models.push('"/><img src=x>');
  ui.state.draft = plain(snapshot.settings); ui.state.draft.asr.provider = snapshot.speechProviders[0].id;
  const html = ui.renderSettings();
  assert(html.includes('&lt;unsafe-name&gt;')); assert(!html.includes('<unsafe-name>'));
  assert(!html.includes('<img src=x>'));
  assert(ui.renderModels().includes('项目准备脚本'));
  assert(!/本阶段不下载|下载功能暂未启用|模型下载在当前原型中关闭/.test(source));
  const index = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  assert(index.includes('模型存储于项目内')); assert(!index.includes('模型下载已暂停'));
});
