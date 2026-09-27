'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { defaults } = require('../core/contracts.cjs');
const { createPaths } = require('../core/paths.cjs');
const { validateWav, hasEnergy, MAX_AUDIO_BYTES } = require('../core/audio.cjs');
const { createProviders, endpointFor, requestJson, runLocal, resolvePython } = require('../core/providers.cjs');

const projectRoot = path.resolve(__dirname, '..');
const fixtureBase = path.join(projectRoot, 'cache', 'provider-tests');

function wav(milliseconds = 500, amplitude = 6000) {
  const samples = Math.floor(milliseconds * 16);
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) audio.writeInt16LE(Math.round(Math.sin(i * 0.14) * amplitude), 44 + i * 2);
  return audio;
}

function fixture(t, settings = defaults()) {
  fs.mkdirSync(fixtureBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtureBase, 'case-'));
  const paths = createPaths(root);
  t.after(() => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(`${path.resolve(fixtureBase)}${path.sep}`));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const records = [];
  const store = {
    getSettings: () => settings,
    getSecret: (name) => `test-${name}-secret`,
    addHistory: (record) => { records.push(structuredClone(record)); },
  };
  return { paths, settings, records, store, provider: createProviders({ paths, store }) };
}

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

function requestBody(request) {
  return new Promise(resolve => {
    const parts = [];
    request.on('data', chunk => parts.push(chunk));
    request.on('end', () => resolve(Buffer.concat(parts)));
  });
}

function traceProbe() {
  const events = [];
  const errors = [];
  async function trace(...args) {
    assert.equal(args.length, 2, 'stage callback receives no extra business payload');
    const [name, action] = args;
    assert.equal(typeof name, 'string');
    assert.equal(typeof action, 'function');
    events.push({ name, status: 'running' });
    try {
      assert.equal(await action(), undefined, 'stage callback does not return audio or transcript payloads');
      events.push({ name, status: 'success' });
    } catch (error) {
      errors.push(error);
      events.push({ name, status: 'failed', errorCode: error.code });
      throw error;
    }
  }
  return { trace, events, errors };
}

test('WAV validation uses actual PCM and rejects malformed, empty, short, silent and oversized audio', () => {
  const valid = wav();
  const decoded = validateWav(valid, 500);
  assert.equal(decoded.durationMs, 500);
  assert.equal(decoded.sampleRate, 16000);
  assert.equal(hasEnergy(decoded.pcm, 0.015), true);
  assert.equal(hasEnergy(validateWav(wav(500, 30), 500).pcm, 0.015), false);
  assert.throws(() => validateWav(Buffer.alloc(0), 0), { code: 'AUDIO_EMPTY' });
  assert.throws(() => validateWav('hello', 500), { code: 'AUDIO_INVALID' });
  assert.throws(() => validateWav(Buffer.alloc(MAX_AUDIO_BYTES + 1), 500), { code: 'AUDIO_TOO_LARGE' });
  assert.throws(() => validateWav(wav(100), 100), { code: 'AUDIO_TOO_SHORT' });
  assert.throws(() => validateWav(wav(0), 0), { code: 'AUDIO_EMPTY' });
  assert.throws(() => validateWav(wav(500, 0), 500), { code: 'AUDIO_SILENT' });
  assert.throws(() => validateWav(wav(120001), 120001), { code: 'AUDIO_TOO_LONG' });
  assert.throws(() => validateWav(valid, 10000), { code: 'AUDIO_DURATION' });
  assert.throws(() => validateWav(valid, NaN), { code: 'AUDIO_INVALID' });
  const truncated = valid.subarray(0, valid.length - 1);
  assert.throws(() => validateWav(truncated, 500), { code: 'AUDIO_FORMAT' });
  for (const [offset, value, width] of [[20, 3, 2], [22, 2, 2], [24, 44100, 4], [28, 1, 4], [32, 4, 2], [34, 8, 2]]) {
    const invalid = Buffer.from(valid);
    invalid[width === 2 ? 'writeUInt16LE' : 'writeUInt32LE'](value, offset);
    assert.throws(() => validateWav(invalid, 500), { code: 'AUDIO_FORMAT' });
  }
});

test('typed array slices are respected and extra WAV chunks are parsed', () => {
  const valid = wav();
  const wrapped = Buffer.concat([Buffer.alloc(10), valid, Buffer.alloc(10)]);
  const slice = new Uint8Array(wrapped.buffer, wrapped.byteOffset + 10, valid.length);
  assert.equal(validateWav(slice, 500).durationMs, 500);
  const chunk = Buffer.from('JUNK\x02\x00\x00\x00xx', 'binary');
  const extra = Buffer.concat([valid.subarray(0, 12), chunk, valid.subarray(12)]);
  extra.writeUInt32LE(extra.length - 8, 4);
  assert.equal(validateWav(extra.buffer.slice(extra.byteOffset, extra.byteOffset + extra.length), 500).durationMs, 500);
});

test('endpoint policy pins localhost, blocks remote local routes and requires HTTPS for cloud', () => {
  assert.equal(endpointFor('http://localhost:8000/v1/', '/chat/completions', true).href, 'http://127.0.0.1:8000/v1/chat/completions');
  assert.equal(endpointFor('http://[::1]:8000/inference', '/inference', true).pathname, '/inference');
  assert.throws(() => endpointFor('http://example.com', '/inference', true), { code: 'LOCAL_ENDPOINT_REQUIRED' });
  assert.throws(() => endpointFor('http://127.0.0.1', '/audio/transcriptions', false), { code: 'HTTPS_REQUIRED' });
  assert.throws(() => endpointFor('https://key:secret@example.com', '/inference', false), { code: 'ENDPOINT_INVALID' });
  assert.throws(() => endpointFor('https://example.com?key=secret', '/inference', false), { code: 'ENDPOINT_INVALID' });
});

test('explicit demo is independent of invalid selected providers and stores an identified sample', async t => {
  const f = fixture(t);
  f.settings.asr.mode = 'cloud';
  f.settings.asr.endpoint = 'https://never-contact.invalid';
  f.settings.polish.mode = 'cloud';
  f.store.getSecret = () => { throw new Error('Demo must not access credentials'); };
  const result = await f.provider.demo();
  assert.equal(result.record.source, 'demo');
  assert.equal(result.record.model, 'built-in sample');
  assert.equal(result.text, result.rawText);
  assert.equal(f.records.length, 1);
  assert.equal(Object.hasOwn(f.records[0], 'audio'), false);
  assert.equal(Object.hasOwn(f.records[0], 'key'), false);
  f.settings.general.saveHistory = false;
  await f.provider.demo();
  assert.equal(f.records.length, 1);
});

test('default local route fails for absent project model without reaching network or credentials', async t => {
  const f = fixture(t);
  f.store.getSecret = () => { throw new Error('No cloud fallback'); };
  await assert.rejects(f.provider.transcribe({ audio: wav(), durationMs: 500 }), { code: 'MODEL_MISSING' });
  assert.equal(f.records.length, 0);
});

test('energy, off and missing Silero routes remain independent', async t => {
  const f = fixture(t);
  await assert.rejects(f.provider.transcribe({ audio: wav(500, 30), durationMs: 500 }), { code: 'AUDIO_SILENT' });
  f.settings.vad.mode = 'off';
  await assert.rejects(f.provider.transcribe({ audio: wav(500, 30), durationMs: 500 }), { code: 'MODEL_MISSING' });
  await assert.rejects(f.provider.transcribe({ audio: wav(500, 0), durationMs: 500 }), { code: 'AUDIO_SILENT' });
  f.settings.vad.mode = 'silero';
  await assert.rejects(f.provider.transcribe({ audio: wav(), durationMs: 500 }), { code: 'MODEL_MISSING' });
});

test('whisper.cpp posts WAV to loopback with language and records actual server route', async t => {
  let observed;
  const endpoint = await server(t, async (request, response) => {
    observed = { url: request.url, headers: request.headers, body: await requestBody(request) };
    response.end(JSON.stringify({ text: '  local transcript  ' }));
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint, language: 'zh' });
  f.store.getSecret = () => { throw new Error('Local does not read key'); };
  const result = await f.provider.transcribe({ audio: wav(), durationMs: 500 });
  assert.equal(observed.url, '/inference');
  assert.match(observed.headers['content-type'], /^multipart\/form-data; boundary=murmur-/);
  assert.equal(observed.headers.authorization, undefined);
  assert.ok(observed.body.includes(wav()));
  assert.match(observed.body.toString('latin1'), /name="language"\r\n\r\nzh/);
  assert.equal(result.text, 'local transcript');
  assert.equal(result.record.source, 'local');
  assert.equal(result.record.durationMs, 500);
  assert.equal(result.record.model, 'whisper.cpp server');
  assert.equal(f.records.length, 1);
});

test('cloud ASR uses apiModel and key while the test transport stays loopback', async t => {
  let observed;
  const endpoint = await server(t, async (request, response) => {
    observed = { url: request.url, headers: request.headers, body: await requestBody(request) };
    response.end(JSON.stringify({ text: 'cloud transcript' }));
  });
  t.mock.method(https, 'request', (url, options, callback) => {
    assert.equal(url.origin, 'https://cloud.example.invalid');
    return http.request(new URL(url.pathname, endpoint), options, callback);
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { mode: 'cloud', engine: 'openai', endpoint: 'https://cloud.example.invalid/v1', apiModel: 'custom-asr-v2' });
  const result = await f.provider.transcribe({ audio: wav(), durationMs: 500 });
  assert.equal(observed.url, '/v1/audio/transcriptions');
  assert.equal(observed.headers.authorization, 'Bearer test-asr-secret');
  assert.match(observed.body.toString('latin1'), /name="model"\r\n\r\ncustom-asr-v2/);
  assert.doesNotMatch(observed.body.toString('latin1'), /name="language"/);
  assert.equal(result.record.source, 'cloud');
  assert.equal(result.record.model, 'custom-asr-v2');
  assert.equal(JSON.stringify(f.records).includes('test-asr-secret'), false);
});

test('local polish sends the selected API model and preserves original on provider failure', async t => {
  const calls = [];
  const endpoint = await server(t, async (request, response) => {
    calls.push({ url: request.url, headers: request.headers, body: JSON.parse((await requestBody(request)).toString('utf8')) });
    if (calls.length === 1) response.end(JSON.stringify({ choices: [{ message: { content: 'Edited text.' } }] }));
    else { response.writeHead(500); response.end('sensitive server detail'); }
  });
  const f = fixture(t);
  Object.assign(f.settings.polish, { mode: 'local', endpoint: `${endpoint}/v1`, apiModel: 'my-qwen' });
  f.store.getSecret = () => { throw new Error('Local does not read key'); };
  assert.deepEqual(await f.provider.polishText({ text: 'Original text.' }), { text: 'Edited text.', warnings: [] });
  assert.equal(calls[0].url, '/v1/chat/completions');
  assert.equal(calls[0].body.model, 'my-qwen');
  assert.equal(calls[0].body.messages[1].content, 'Original text.');
  assert.equal(calls[0].headers.authorization, undefined);
  const failed = await f.provider.polishText({ text: '  Keep spacing.  ' });
  assert.equal(failed.text, '  Keep spacing.  ');
  assert.equal(failed.warnings.length, 1);
  assert.equal(failed.warnings[0].includes('sensitive server detail'), false);
});

test('ASR success plus failed polish stores raw transcript and warning', async t => {
  let requests = 0;
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    requests++;
    if (request.url === '/inference') response.end(JSON.stringify({ text: 'Retain this transcript.' }));
    else { response.writeHead(503); response.end('{}'); }
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint });
  Object.assign(f.settings.polish, { mode: 'local', endpoint: `${endpoint}/v1` });
  const result = await f.provider.transcribe({ audio: wav(), durationMs: 500 });
  assert.equal(requests, 2);
  assert.equal(result.text, result.rawText);
  assert.equal(result.text, 'Retain this transcript.');
  assert.equal(f.records[0].warnings.length, 2);
});

test('redirect, HTTP errors, malformed JSON, oversized responses and timeout are surfaced without retries', async t => {
  const requests = new Map();
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    requests.set(request.url, (requests.get(request.url) || 0) + 1);
    if (request.url === '/redirect') { response.writeHead(307, { Location: 'https://never-contact.invalid' }); response.end(); }
    else if (request.url === '/forbidden') { response.writeHead(401); response.end('hidden-key-and-error'); }
    else if (request.url === '/malformed') response.end('not json');
    else if (request.url === '/huge') response.end('x'.repeat(1024 * 1024 + 100));
    // /timeout deliberately stays open until client timeout.
  });
  for (const [route, code] of [['redirect', 'PROVIDER_REDIRECT'], ['forbidden', 'PROVIDER_HTTP'], ['malformed', 'PROVIDER_RESPONSE'], ['huge', 'PROVIDER_RESPONSE'], ['timeout', 'PROVIDER_TIMEOUT']]) {
    await assert.rejects(requestJson(new URL(`${endpoint}/${route}`), Buffer.from('{}'), {}, 150), error => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes('hidden-key'), false);
      return true;
    });
    assert.equal(requests.get(`/${route}`), 1);
  }
});

test('concurrent inference fails with BUSY and subsequent tasks recover', async t => {
  let respond;
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    respond = () => response.end(JSON.stringify({ text: 'done' }));
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint });
  const pending = f.provider.transcribe({ audio: wav(), durationMs: 500 });
  await assert.rejects(f.provider.demo(), { code: 'BUSY' });
  while (!respond) await new Promise(resolve => setImmediate(resolve));
  respond();
  await pending;
  assert.equal((await f.provider.demo()).record.source, 'demo');
});

test('text constraints, missing API key and history failure preserve useful results', async t => {
  const f = fixture(t);
  await assert.rejects(f.provider.polishText({ text: ' ' }), { code: 'TEXT_EMPTY' });
  await assert.rejects(f.provider.polishText({ text: 'x'.repeat(20001) }), { code: 'TEXT_TOO_LONG' });
  assert.deepEqual(await f.provider.polishText({ text: 'Original.' }), { text: 'Original.', warnings: [] });
  Object.assign(f.settings.asr, { mode: 'cloud', endpoint: 'https://never-contact.invalid/v1' });
  f.store.getSecret = () => '';
  await assert.rejects(f.provider.transcribe({ audio: wav(), durationMs: 500 }), { code: 'API_KEY_REQUIRED' });
  f.store.addHistory = () => { throw new Error('disk full'); };
  const result = await f.provider.demo();
  assert.ok(result.text.length > 0);
  assert.equal(result.warnings.length, 2);
});

test('missing local Python executable returns setup error', async t => {
  const f = fixture(t);
  fs.copyFileSync(path.join(projectRoot, 'runtime', 'local_inference.py'), path.join(f.paths.runtime, 'local_inference.py'));
  await assert.rejects(runLocal(f.paths, path.join(f.paths.runtime, 'not-installed-python.exe'), { operation: 'asr' }), { code: 'RUNTIME_MISSING' });
});

test('default Python prefers the project environment while explicit paths remain untouched', t => {
  const f = fixture(t);
  assert.equal(resolvePython(f.paths, 'python'), 'python');
  const executable = path.join(f.paths.root, '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'fixture executable marker', 'utf8');
  assert.equal(resolvePython(f.paths, 'python'), executable);
  assert.equal(resolvePython(f.paths, 'custom-python'), 'custom-python');
});

test('project Python selection rejects an environment junction outside the project', t => {
  const f = fixture(t);
  const outside = fixture(t);
  fs.symlinkSync(outside.paths.root, path.join(f.paths.root, '.venv'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolvePython(f.paths, 'python'), { code: 'UNSAFE_PATH' });
});

const python = process.env.PYTHON_FOR_TESTS || 'python';
const hasPython = spawnSync(python, ['--version'], { windowsHide: true, timeout: 10000 }).status === 0;
test('subprocess JSON keeps Unicode split across byte chunks and enforces runtime timeout', { skip: !hasPython }, async t => {
  const f = fixture(t);
  const script = path.join(f.paths.runtime, 'local_inference.py');
  fs.writeFileSync(script, [
    'import sys, time',
    'sys.stdin.buffer.read()',
    'payload = "{\\"ok\\":true,\\"data\\":{\\"text\\":\\"\\u4f60\\u597d\\"}}".encode("utf-8")',
    'for byte in payload:',
    '    sys.stdout.buffer.write(bytes([byte]))',
    '    sys.stdout.buffer.flush()',
    '    time.sleep(0.005)',
  ].join('\n'), 'utf8');
  assert.equal((await runLocal(f.paths, python, { operation: 'asr' }, 5000)).text, '\u4f60\u597d');
  fs.writeFileSync(script, 'import sys, time\nsys.stdin.buffer.read()\ntime.sleep(10)\n', 'utf8');
  await assert.rejects(runLocal(f.paths, python, { operation: 'asr' }, 100), { code: 'PROVIDER_TIMEOUT' });
});

test('Python runner rejects malformed input, foreign root, outside model path and missing model without optional dependencies', { skip: !hasPython }, async t => {
  const f = fixture(t);
  fs.copyFileSync(path.join(projectRoot, 'runtime', 'local_inference.py'), path.join(f.paths.runtime, 'local_inference.py'));
  const invoke = request => {
    const result = spawnSync(python, ['-B', path.join(f.paths.runtime, 'local_inference.py')], {
      input: typeof request === 'string' ? request : JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  assert.equal(invoke('{broken').error.code, 'REQUEST_INVALID');
  assert.equal(invoke({ operation: 'download' }).error.code, 'REQUEST_INVALID');
  assert.equal(invoke({ operation: 'asr', root: projectRoot }).error.code, 'PATH_UNSAFE');
  assert.equal(invoke({ operation: 'asr', root: f.paths.root, modelPath: projectRoot }).error.code, 'PATH_UNSAFE');
  assert.equal(invoke({ operation: 'asr', root: f.paths.root, modelPath: 'whisper-base' }).error.code, 'PATH_UNSAFE');
  assert.equal(invoke({ operation: 'asr', root: f.paths.root, modelPath: path.join(f.paths.models, 'not-present') }).error.code, 'MODEL_MISSING');
});

test('optional tracing follows audio, VAD, ASR and polish order without receiving business payloads', async t => {
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    response.end(JSON.stringify(request.url === '/inference' ? { text: 'private raw transcript' } : { choices: [{ message: { content: 'private polished transcript' } }] }));
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint });
  Object.assign(f.settings.polish, { mode: 'local', endpoint: `${endpoint}/v1` });
  const probe = traceProbe();
  const result = await f.provider.transcribe({ audio: wav(), durationMs: 500 }, { trace: probe.trace });
  assert.deepEqual(probe.events, ['audio', 'vad', 'asr', 'polish'].flatMap(name => [{ name, status: 'running' }, { name, status: 'success' }]));
  assert.equal(result.rawText, 'private raw transcript');
  assert.equal(result.text, 'private polished transcript');
  assert.equal(f.records[0].rawText, result.rawText);
  assert.equal(f.records[0].text, result.text);
  assert.equal(JSON.stringify(probe.events).includes('private'), false);
  assert.equal(JSON.stringify(probe.events).includes(endpoint), false);
  const manual = traceProbe();
  assert.equal((await f.provider.polishText({ text: 'private dictated text' }, { trace: manual.trace })).text, 'private polished transcript');
  assert.deepEqual(manual.events, [{ name: 'polish', status: 'running' }, { name: 'polish', status: 'success' }]);
});

test('disabled VAD/polish omit their stages and traced results retain legacy no-trace behavior', async t => {
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    response.end(JSON.stringify({ text: 'unchanged transcript' }));
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint });
  f.settings.vad.mode = 'off';
  const legacy = await f.provider.transcribe({ audio: wav(), durationMs: 500 });
  const probe = traceProbe();
  const traced = await f.provider.transcribe({ audio: wav(), durationMs: 500 }, { trace: probe.trace });
  assert.deepEqual(probe.events, ['audio', 'asr'].flatMap(name => [{ name, status: 'running' }, { name, status: 'success' }]));
  for (const key of ['text', 'rawText', 'warnings']) assert.deepEqual(traced[key], legacy[key]);
  for (const key of ['text', 'rawText', 'durationMs', 'source', 'model', 'warnings']) assert.deepEqual(traced.record[key], legacy.record[key]);
  assert.deepEqual(Object.keys(traced).sort(), Object.keys(legacy).sort());
  const manual = traceProbe();
  assert.deepEqual(await f.provider.polishText({ text: '  unchanged  ' }, { trace: manual.trace }), { text: '  unchanged  ', warnings: [] });
  assert.deepEqual(manual.events, []);
});

test('audio and VAD failures are traced exactly once and stop later stages', async t => {
  const f = fixture(t);
  const audio = traceProbe();
  await assert.rejects(f.provider.transcribe({ audio: Buffer.alloc(0), durationMs: 0 }, { trace: audio.trace }), error => error === audio.errors[0] && error.code === 'AUDIO_EMPTY');
  assert.deepEqual(audio.events, [{ name: 'audio', status: 'running' }, { name: 'audio', status: 'failed', errorCode: 'AUDIO_EMPTY' }]);
  const vad = traceProbe();
  await assert.rejects(f.provider.transcribe({ audio: wav(500, 30), durationMs: 500 }, { trace: vad.trace }), error => error === vad.errors[0] && error.code === 'AUDIO_SILENT');
  assert.deepEqual(vad.events, [{ name: 'audio', status: 'running' }, { name: 'audio', status: 'success' }, { name: 'vad', status: 'running' }, { name: 'vad', status: 'failed', errorCode: 'AUDIO_SILENT' }]);
  f.settings.vad.mode = 'silero';
  const silero = traceProbe();
  await assert.rejects(f.provider.transcribe({ audio: wav(), durationMs: 500 }, { trace: silero.trace }), { code: 'MODEL_MISSING' });
  assert.deepEqual(silero.events.at(-1), { name: 'vad', status: 'failed', errorCode: 'MODEL_MISSING' });
  assert.equal(f.records.length, 0);
});

test('ASR trace observes original provider exception before it propagates and never starts polish', async t => {
  let calls = 0;
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    calls++;
    response.writeHead(503);
    response.end('private provider diagnostic');
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint });
  Object.assign(f.settings.polish, { mode: 'local', endpoint: `${endpoint}/v1` });
  const probe = traceProbe();
  await assert.rejects(f.provider.transcribe({ audio: wav(), durationMs: 500 }, { trace: probe.trace }), error => error === probe.errors[0] && error.code === 'PROVIDER_HTTP');
  assert.deepEqual(probe.events.at(-1), { name: 'asr', status: 'failed', errorCode: 'PROVIDER_HTTP' });
  assert.equal(probe.events.some(event => event.name === 'polish'), false);
  assert.equal(JSON.stringify(probe.events).includes('private'), false);
  assert.equal(calls, 1);
  assert.equal(f.records.length, 0);
});

test('polish trace records failure before raw-text fallback and history persistence', async t => {
  const endpoint = await server(t, async (request, response) => {
    await requestBody(request);
    if (request.url === '/inference') response.end(JSON.stringify({ text: 'private raw text remains intact' }));
    else { response.writeHead(500); response.end('private failed polish detail'); }
  });
  const f = fixture(t);
  Object.assign(f.settings.asr, { engine: 'whisper-cpp', endpoint });
  Object.assign(f.settings.polish, { mode: 'local', endpoint: `${endpoint}/v1` });
  const probe = traceProbe();
  const addHistory = f.store.addHistory;
  f.store.addHistory = record => {
    assert.deepEqual(probe.events.at(-1), { name: 'polish', status: 'failed', errorCode: 'PROVIDER_HTTP' });
    return addHistory(record);
  };
  const result = await f.provider.transcribe({ audio: wav(), durationMs: 500 }, { trace: probe.trace });
  assert.equal(probe.errors.length, 1);
  assert.equal(result.text, 'private raw text remains intact');
  assert.equal(result.rawText, result.text);
  assert.equal(f.records[0].text, result.rawText);
  assert.equal(result.warnings.length, 2);
  assert.equal(JSON.stringify(probe.events).includes('private'), false);
  const manual = traceProbe();
  const manualResult = await f.provider.polishText({ text: '  private manual text  ' }, { trace: manual.trace });
  assert.equal(manualResult.text, '  private manual text  ');
  assert.equal(manualResult.warnings.length, 1);
  assert.deepEqual(manual.events, [{ name: 'polish', status: 'running' }, { name: 'polish', status: 'failed', errorCode: 'PROVIDER_HTTP' }]);
});
