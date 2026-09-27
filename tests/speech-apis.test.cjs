'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { defaults } = require('../core/contracts.cjs');
const { getSpeechProviders, getSpeechProvider, validateProviderEndpoint } = require('../core/speech-apis.cjs');
const { buildCloudAsrRequest } = require('../core/cloud-asr.cjs');
const { validateWav, MAX_AUDIO_BYTES } = require('../core/audio.cjs');
const { createProviders } = require('../core/providers.cjs');

function audio(milliseconds = 500) {
  const count = milliseconds * 16;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(Math.sin(i * 0.14) * 6000), 44 + i * 2);
  return validateWav(wav, milliseconds);
}

function settingsFor(provider, language = 'auto') {
  const info = getSpeechProvider(provider);
  const settings = defaults();
  Object.assign(settings.asr, { provider, mode: 'cloud', engine: 'openai', endpoint: info.defaultEndpoint, apiModel: info.defaultModel, language });
  settings.vad.mode = 'off';
  return settings;
}

function build(provider, language = 'auto', overrides = {}) {
  return buildCloudAsrRequest({ settings: settingsFor(provider, language), audio: audio(), key: 'fixture-only-key', ...overrides });
}

function fields(request) {
  return [...request.body.toString('utf8').matchAll(/Content-Disposition: form-data; name="([^"]+)"/g)].map(match => match[1]);
}

test('public catalog has exactly four suppliers and custom with detached safe metadata', () => {
  const list = getSpeechProviders();
  assert.deepEqual(list.map(item => item.id), ['siliconflow', 'dashscope', 'openai', 'groq', 'custom']);
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'name', 'protocol', 'defaultEndpoint', 'endpoints', 'defaultModel', 'models', 'docsUrl', 'keyUrl', 'notes'].sort());
    assert.ok(item.models.includes(item.defaultModel));
    assert.equal(new URL(item.docsUrl).protocol, 'https:');
    assert.equal(validateProviderEndpoint(item.id, item.defaultEndpoint), item.defaultEndpoint);
  }
  list[0].endpoints[0].value = 'https://attacker.invalid';
  const selected = getSpeechProvider('openai'); selected.models.length = 0;
  assert.equal(getSpeechProvider('siliconflow').endpoints[0].value, 'https://api.siliconflow.cn/v1');
  assert.ok(getSpeechProvider('openai').models.length > 0);
  assert.equal(getSpeechProvider('unknown'), null);
});

test('preset endpoint policy rejects host/path tricks while custom remains HTTPS editable', () => {
  assert.equal(validateProviderEndpoint('openai', 'https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(validateProviderEndpoint('custom', 'https://company.example/api/v2/'), 'https://company.example/api/v2');
  for (const endpoint of [
    'https://api.openai.com.evil.invalid/v1', 'https://api.openai.com:444/v1',
    'https://api.openai.com/v1/audio/transcriptions', 'https://other.invalid/v1',
    'https://user:secret@api.openai.com/v1', 'https://api.openai.com/v1?secret=x',
    'https://api.openai.com/v1#fragment', 'http://api.openai.com/v1',
    'https://api.openai.com\\@evil.invalid/v1', 'https://api.openai.com/v1\n',
  ]) assert.throws(() => validateProviderEndpoint('openai', endpoint), { code: 'INVALID_SETTINGS' });
  for (const endpoint of ['http://127.0.0.1', 'file:///x', 'https://user:pass@example.com', 'https://x.test?a=b', 'invalid']) {
    assert.throws(() => validateProviderEndpoint('custom', endpoint), { code: 'INVALID_SETTINGS' });
  }
  assert.throws(() => validateProviderEndpoint('unknown', 'https://x.test'), { code: 'INVALID_SETTINGS' });
  for (const endpoint of getSpeechProvider('dashscope').endpoints) assert.equal(validateProviderEndpoint('dashscope', endpoint.value), endpoint.value);
});

test('SiliconFlow request includes only file/model and keeps WAV bytes exact', () => {
  const sample = audio();
  const request = build('siliconflow', 'zh', { audio: sample });
  assert.equal(request.url.href, 'https://api.siliconflow.cn/v1/audio/transcriptions');
  assert.deepEqual(fields(request), ['model', 'file']);
  assert.ok(request.body.includes(sample.wav));
  assert.ok(request.body.includes(Buffer.from('FunAudioLLM/SenseVoiceSmall')));
  assert.equal(request.headers.Authorization, 'Bearer fixture-only-key');
  assert.equal(request.parseResponse({ text: '  硅基流动转写  ' }), '硅基流动转写');
});

test('OpenAI gpt-transcribe uses languages[]; older models and Groq use language', () => {
  const latest = build('openai', 'zh');
  assert.deepEqual(fields(latest), ['model', 'response_format', 'languages[]', 'file']);
  assert.equal(latest.url.href, 'https://api.openai.com/v1/audio/transcriptions');
  for (const model of ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1']) {
    const settings = settingsFor('openai', 'en'); settings.asr.apiModel = model;
    assert.deepEqual(fields(build('openai', 'en', { settings })), ['model', 'response_format', 'language', 'file']);
  }
  assert.deepEqual(fields(build('openai')), ['model', 'response_format', 'file']);
  const groq = build('groq', 'en');
  assert.equal(groq.url.href, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.deepEqual(fields(groq), ['model', 'response_format', 'language', 'file']);
});

test('custom adapter retains complete route and configurable model without applying named supplier rules', () => {
  const settings = settingsFor('custom', 'zh');
  settings.asr.endpoint = 'https://customer.example/v2/audio/transcriptions/';
  settings.asr.apiModel = 'customer/asr-new';
  const request = build('custom', 'zh', { settings });
  assert.equal(request.url.href, 'https://customer.example/v2/audio/transcriptions');
  assert.deepEqual(fields(request), ['model', 'response_format', 'language', 'file']);
  assert.ok(request.body.includes(Buffer.from('customer/asr-new')));
});

test('DashScope uses nonstreaming audio JSON, regional route and explicit optional language', () => {
  const sample = audio();
  const request = build('dashscope', 'zh', { audio: sample });
  const body = JSON.parse(request.body.toString('utf8'));
  assert.equal(request.url.href, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.deepEqual(body, {
    model: 'qwen3-asr-flash',
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${sample.wav.toString('base64')}` } }] }],
    stream: false, asr_options: { enable_itn: false, language: 'zh' },
  });
  const settings = settingsFor('dashscope');
  settings.asr.endpoint = getSpeechProvider('dashscope').endpoints[1].value;
  const international = build('dashscope', 'auto', { settings });
  assert.equal(international.url.hostname, 'dashscope-intl.aliyuncs.com');
  assert.deepEqual(JSON.parse(international.body).asr_options, { enable_itn: false });
  assert.equal(request.parseResponse({ choices: [{ message: { content: '  百炼转写  ' } }] }), '百炼转写');
  const maximum = build('dashscope', 'auto', { audio: audio(120000) });
  assert.ok(maximum.body.length < 10 * 1000 * 1000, 'two-minute PCM including base64 fits the documented limit');
});

test('request construction rejects missing keys, control injection and invalid settings safely', () => {
  for (const key of ['', '   ', null, undefined]) assert.throws(() => build('openai', 'auto', { key }), { code: 'API_KEY_REQUIRED' });
  for (const key of ['secret\n', 'secret\r\nX-Key:bad', 'secret\u0000', 'a'.repeat(4097)]) {
    assert.throws(() => build('openai', 'auto', { key }), error => error.code === 'API_KEY_INVALID' && !error.message.includes('secret'));
  }
  for (const patch of [{ provider: 'other' }, { endpoint: 'https://unlisted.invalid' }, { apiModel: 'bad\r\nfield' }, { language: 'xx' }]) {
    const settings = settingsFor('openai'); Object.assign(settings.asr, patch);
    assert.throws(() => build('openai', 'auto', { settings }), { code: 'INVALID_SETTINGS' });
  }
  assert.throws(() => build('openai', 'auto', { audio: { wav: Buffer.alloc(0) } }), { code: 'AUDIO_INVALID' });
  assert.throws(() => build('openai', 'auto', { audio: { wav: Buffer.alloc(MAX_AUDIO_BYTES + 1) } }), { code: 'AUDIO_TOO_LARGE' });
});

test('parsers reject absent, structured or excessively long text without echoing provider payload', () => {
  for (const provider of getSpeechProviders()) {
    const request = build(provider.id);
    for (const response of [null, {}, { text: ' ' }, { text: { secret: 'private-response' } }, { error: { message: 'private-response' } }]) {
      assert.throws(() => request.parseResponse(response), error => error.code === 'NO_TRANSCRIPT' && !error.message.includes('private-response'));
    }
    const text = 'x'.repeat(20001);
    const response = provider.id === 'dashscope' ? { choices: [{ message: { content: text } }] } : { text };
    assert.throws(() => request.parseResponse(response), { code: 'PROVIDER_RESPONSE' });
  }
});

test('all five provider routes integrate through loopback fixtures, keeping history and stage hooks private', async t => {
  const observed = [];
  const fixture = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      observed.push({ route: request.url, headers: request.headers, body: Buffer.concat(chunks) });
      const result = request.url.endsWith('/chat/completions') ? { choices: [{ message: { content: '实际响应文字' } }] } : { text: '实际响应文字' };
      response.end(JSON.stringify(result));
    });
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { fixture.closeAllConnections(); fixture.close(resolve); }));
  const destinations = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    destinations.push(url.href);
    return http.request(new URL(url.pathname, `http://127.0.0.1:${fixture.address().port}`), options, callback);
  });
  for (const info of getSpeechProviders()) {
    const settings = settingsFor(info.id, 'zh');
    const records = []; const stages = []; const secretsRequested = [];
    const provider = createProviders({ paths: {}, store: {
      getSettings: () => settings,
      getSecret: name => { secretsRequested.push(name); return 'fixture-only-key'; },
      addHistory: record => records.push(record),
    } });
    const result = await provider.transcribe({ audio: audio().wav, durationMs: 500 }, { trace: async (name, action) => {
      stages.push(name); assert.equal(await action(), undefined);
    } });
    assert.equal(result.text, '实际响应文字');
    assert.equal(result.record.source, 'cloud');
    assert.equal(result.record.model, info.defaultModel);
    assert.deepEqual(stages, ['audio', 'asr']);
    assert.deepEqual(secretsRequested, ['asr']);
    assert.equal(records.length, 1);
    const persisted = JSON.stringify(records);
    for (const privateToken of ['fixture-only-key', info.defaultEndpoint, 'Authorization', 'base64', 'speechProviders']) assert.equal(persisted.includes(privateToken), false);
    assert.equal(observed.at(-1).headers.authorization, 'Bearer fixture-only-key');
  }
  assert.equal(destinations.length, 5);
  assert.equal(observed.length, 5);
  const provider = createProviders({ paths: {}, store: { getSettings: () => settingsFor('dashscope'), getSecret: () => '', addHistory: () => assert.fail('No history for failed ASR') } });
  await assert.rejects(provider.transcribe({ audio: audio().wav, durationMs: 500 }), { code: 'API_KEY_REQUIRED' });
  assert.equal(destinations.length, 5, 'missing key never reaches transport');
});
