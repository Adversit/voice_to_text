'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createPaths, assertContained } = require('../core/paths.cjs');
const { createMonitor } = require('../core/monitor.cjs');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = Date.parse('2026-09-27T12:00:00.000Z');
const taskInput = { kind: 'transcribe', trigger: 'shortcut', route: 'local' };
function fixture(t) {
  const cache = assertContained(ROOT, path.join(ROOT, 'cache'));
  fs.mkdirSync(cache, { recursive: true });
  const base = fs.mkdtempSync(path.join(cache, 'monitor-test-'));
  const root = path.join(base, 'project');
  fs.mkdirSync(root);
  const paths = createPaths(root);
  t.after(() => { assertContained(cache, base); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, paths, file: path.join(paths.data, 'monitor.json') };
}
function setup(t, options = {}) {
  const files = fixture(t);
  let timestamp = ORIGIN;
  const monitor = createMonitor({ paths: files.paths, now: () => timestamp, getAppMemoryMB: () => 320,
    sampleResources: () => ({ cpuPercent: 12, memoryTotalGB: 16, memoryUsedGB: 8, gpus: [] }), ...options });
  t.after(() => monitor.stop());
  return { ...files, monitor, time: value => { timestamp = ORIGIN + value; } };
}

test('task lifecycle measures live duration, ignores duplicate/late stages, and preserves trace returns', async t => {
  const { monitor, time } = setup(t);
  monitor.init();
  const id = monitor.begin(taskInput);
  monitor.stageStart(id, 'preparing');
  time(100);
  monitor.stageStart(id, 'preparing');
  assert.equal(monitor.snapshot().tasks[0].durationMs, 100);
  assert.equal(monitor.snapshot().tasks[0].stages[0].durationMs, 100);
  monitor.stageEnd(id, 'preparing');
  time(150);
  monitor.stageEnd(id, 'preparing', 'failed', 'UNKNOWN_ERROR');
  monitor.stageEnd(id, 'missing-stage');
  const value = { private: 'business result only' };
  assert.equal(await monitor.trace(id, 'asr', async () => { time(250); return value; }), value);
  monitor.finish(id, 'success');
  time(500);
  monitor.finish(id, 'failed', 'UNKNOWN_ERROR');
  monitor.stageStart(id, 'delivery');
  const task = monitor.snapshot().tasks[0];
  assert.equal(task.status, 'success');
  assert.equal(task.durationMs, 250);
  assert.deepEqual(task.stages.map(stage => [stage.name, stage.status, stage.durationMs]), [['preparing', 'success', 100], ['asr', 'success', 100]]);
  assert.deepEqual(monitor.snapshot().counters, { completed: 1, failed: 0, canceled: 0 });
  assert.equal(await monitor.trace('missing-id', 'asr', () => 17), 17);
  assert.doesNotThrow(() => monitor.finish('missing-id', 'failed'));
});

test('telemetry whitelists public metadata and known codes, never business values or exception text', async t => {
  const { monitor, file } = setup(t);
  monitor.init();
  const sensitive = 'PRIVATE_TRANSCRIPT_APIKEY_ENDPOINT_HWND_STACK';
  const id = monitor.begin({ ...taskInput, text: sensitive, rawText: sensitive, endpoint: sensitive, apiKey: sensitive, target: { hwnd: sensitive } });
  const error = Object.assign(new Error(sensitive), { code: sensitive, target: sensitive });
  await assert.rejects(monitor.trace(id, 'asr', () => Promise.reject(error)), value => value === error);
  monitor.finish(id, 'failed', error.code);
  const serialized = fs.readFileSync(file, 'utf8');
  assert.ok(!serialized.includes(sensitive));
  assert.ok(!JSON.stringify(monitor.snapshot()).includes(sensitive));
  assert.equal(monitor.snapshot().tasks[0].stages[0].errorCode, 'UNKNOWN_ERROR');
  assert.equal(monitor.snapshot().tasks[0].errorCode, 'UNKNOWN_ERROR');
  const known = monitor.begin(taskInput);
  await assert.rejects(monitor.trace(known, 'audio', () => { throw Object.assign(new Error(sensitive), { code: 'AUDIO_SHORT' }); }));
  monitor.finish(known, 'canceled', 'MICROPHONE_UNAVAILABLE');
  assert.equal(monitor.snapshot().tasks[0].errorCode, 'MICROPHONE_UNAVAILABLE');
  assert.equal(monitor.snapshot().tasks[0].stages[0].errorCode, 'AUDIO_SHORT');
  assert.equal(monitor.begin({ ...taskInput, kind: sensitive }), null);
});

test('known local runtime failures retain their codes without retaining private exception messages', async t => {
  const { monitor, file } = setup(t);monitor.init();
  for(const code of ['LOCAL_INFERENCE','PATH_UNSAFE','REQUEST_INVALID']){
    const id=monitor.begin(taskInput);
    const error=Object.assign(new Error('private model path or dictated content'),{code});
    await assert.rejects(monitor.trace(id,'asr',()=>{throw error;}),value=>value===error);
    monitor.finish(id,'failed',code);
    assert.equal(monitor.snapshot().tasks[0].errorCode,code);
    assert.equal(monitor.snapshot().tasks[0].stages[0].errorCode,code);
  }
  assert.equal(fs.readFileSync(file,'utf8').includes('private model path'),false);
});

test('finished, canceled, warning and interrupted counts are bounded to the latest 100 tasks', t => {
  const { monitor, time, file } = setup(t);
  monitor.init();
  let first;
  for (let index = 0; index < 105; index++) {
    time(index * 10);
    const id = monitor.begin({ kind: 'demo', trigger: 'manual', route: 'demo' });
    if (index === 0) first = id;
    monitor.finish(id, ['success', 'warning', 'failed', 'canceled', 'interrupted'][index % 5]);
  }
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.tasks.length, 100);
  assert.ok(!snapshot.tasks.some(task => task.id === first));
  assert.equal(snapshot.tasks[0].createdAt, new Date(ORIGIN + 1040).toISOString());
  assert.deepEqual(snapshot.counters, { completed: 40, failed: 20, canceled: 40 });
  const durable = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(durable.tasks.length, 100);
  assert.deepEqual(Object.keys(durable).sort(), ['schemaVersion', 'tasks']);
  assert.ok(fs.statSync(file).size < 256 * 1024);
});

test('restart marks unfinished tasks and stages interrupted once without including downtime', t => {
  const { monitor, paths, time, file } = setup(t);
  monitor.init();
  const id = monitor.begin(taskInput);
  monitor.stageStart(id, 'recording');
  time(500);
  monitor.stageStart(id, 'audio');
  const reopened = createMonitor({ paths, now: () => ORIGIN + 100000 });
  reopened.init();
  const task = reopened.snapshot().tasks[0];
  assert.equal(task.id, id);
  assert.equal(task.status, 'interrupted');
  assert.equal(task.errorCode, 'INTERRUPTED');
  assert.equal(task.durationMs, 500);
  assert.ok(task.stages.every(stage => stage.status === 'interrupted'));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tasks[0].status, 'interrupted');
  const original = fs.readFileSync(file, 'utf8');
  reopened.init();
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('corrupt, future-version and oversized files remain unchanged while in-memory tasks continue', t => {
  const { paths, file } = fixture(t);
  for (const content of ['{broken', JSON.stringify({ schemaVersion: 7, tasks: [] }), 'x'.repeat(256 * 1024 + 1)]) {
    fs.writeFileSync(file, content, 'utf8');
    const monitor = createMonitor({ paths });
    assert.doesNotThrow(() => monitor.init());
    const id = monitor.begin(taskInput);
    monitor.finish(id, 'success');
    assert.equal(monitor.snapshot().tasks[0].status, 'success');
    assert.equal(monitor.snapshot().storage.persisted, false);
    assert.ok(monitor.snapshot().alerts.some(alert => alert.code === 'MONITOR_STORAGE_UNAVAILABLE'));
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('monitor storage rejects file/data junction escapes without blocking task behavior', async t => {
  const { base, paths, file } = fixture(t);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  const marker = path.join(outside, 'marker.txt');
  fs.writeFileSync(marker, 'unchanged', 'utf8');
  fs.rmdirSync(paths.data);
  fs.symlinkSync(outside, paths.data, process.platform === 'win32' ? 'junction' : 'dir');
  const monitor = createMonitor({ paths });
  monitor.init();
  const id = monitor.begin(taskInput);
  assert.equal(await monitor.trace(id, 'asr', () => 'business continues'), 'business continues');
  monitor.finish(id, 'success');
  assert.equal(monitor.snapshot().storage.persisted, false);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(outside), ['marker.txt']);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'unchanged');
});

test('atomic write and listener failures never replace business returns or exceptions', async t => {
  const { monitor, file } = setup(t, { onChange: () => { throw new Error('private callback failure'); } });
  monitor.init();
  const previous = fs.readFileSync(file, 'utf8');
  t.mock.method(fs, 'renameSync', () => { throw new Error('private disk error'); });
  const id = monitor.begin(taskInput);
  const result = { text: 'private business result' };
  assert.equal(await monitor.trace(id, 'asr', () => result), result);
  const failure = Object.assign(new Error('private model path'), { code: 'MODEL_MISSING' });
  await assert.rejects(monitor.trace(id, 'polish', () => { throw failure; }), error => error === failure);
  assert.doesNotThrow(() => monitor.finish(id, 'warning', 'MODEL_MISSING'));
  assert.equal(monitor.snapshot().storage.persisted, false);
  assert.equal(monitor.snapshot().tasks[0].status, 'warning');
  assert.equal(fs.readFileSync(file, 'utf8'), previous);
  assert.ok(!fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')));
  assert.ok(!JSON.stringify(monitor.snapshot()).includes('private'));
});

test('constructor tolerates unusable paths and async event rejection without affecting an action', async () => {
  let monitor;
  assert.doesNotThrow(() => { monitor = createMonitor({ paths: null, onChange: async () => { throw new Error('private event failure'); } }); });
  assert.doesNotThrow(() => monitor.init());
  const id = monitor.begin(taskInput);
  assert.equal(await monitor.trace(id, 'asr', () => 42), 42);
  monitor.finish(id, 'success');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(monitor.snapshot().storage.persisted, false);
});

test('concurrent refreshes coalesce, GPU updates are throttled 15 seconds, samples stay memory-only', async t => {
  let resolveSample;
  const calls = [];
  const { monitor, time, file } = setup(t, { sampleResources: args => {
    calls.push(args);
    if (calls.length === 1) return new Promise(resolve => { resolveSample = resolve; });
    return { cpuPercent: 25, memoryUsedGB: 8, memoryTotalGB: 16, gpus: [{ name: 'NVIDIA fixture', utilizationPercent: 30, usedMB: 1000, totalMB: 8000 }] };
  } });
  monitor.init();
  const originalFile = fs.readFileSync(file, 'utf8');
  const first = monitor.sample();
  const duplicate = monitor.sample();
  assert.equal(first, duplicate);
  await Promise.resolve();
  await Promise.resolve();
  resolveSample({ cpuPercent: null, memoryUsedGB: 7, memoryTotalGB: 16, gpus: [{ name: 'NVIDIA fixture', utilizationPercent: 20, usedMB: 500, totalMB: 8000 }] });
  await first;
  time(5000); await monitor.sample();
  time(14999); await monitor.sample();
  assert.equal(monitor.snapshot().samples.at(-1).gpus[0].usedMB, 500);
  time(15000); await monitor.sample();
  assert.deepEqual(calls.map(call => call.gpuDue), [true, false, false, true]);
  assert.equal(monitor.snapshot().samples.at(-1).gpus[0].usedMB, 1000);
  assert.equal(monitor.snapshot().samples[0].cpuPercent, null);
  assert.equal(monitor.snapshot().samples[0].appMemoryMB, 320);
  assert.equal(fs.readFileSync(file, 'utf8'), originalFile);
});

test('pause discards in-flight resource results but task recording continues and resumes safely', async t => {
  let resolveSample;
  let calls = 0;
  const { monitor, time } = setup(t, { sampleResources: () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { resolveSample = resolve; }) : { cpuPercent: 20, memoryUsedGB: 8, memoryTotalGB: 16 };
  } });
  monitor.init();
  const pending = monitor.sample();
  await Promise.resolve(); await Promise.resolve();
  monitor.setPaused(true);
  resolveSample({ cpuPercent: 80, memoryTotalGB: 16, memoryUsedGB: 15 });
  await pending;
  await monitor.sample();
  assert.equal(monitor.snapshot().samples.length, 0);
  assert.equal(calls, 1);
  const id = monitor.begin(taskInput);
  monitor.stageStart(id, 'recording');
  time(50);
  monitor.finish(id, 'canceled', 'CANCELED');
  assert.equal(monitor.snapshot().tasks[0].durationMs, 50);
  assert.equal(monitor.snapshot().counters.canceled, 1);
  monitor.setPaused(false);
  await monitor.sample();
  assert.equal(monitor.snapshot().samples.length, 1);
});

test('unknown values stay null, failed GPU attempts are throttled, and low memory warnings use explicit thresholds', async t => {
  const calls = [];
  const { monitor, time } = setup(t, { getAppMemoryMB: () => null, sampleResources: args => {
    calls.push(args.gpuDue);
    if (calls.length === 1) throw Object.assign(new Error('private endpoint'), { detail: 'private key' });
    return { cpuPercent: NaN, memoryTotalGB: 16, memoryUsedGB: 15, gpus: [{ name: 'NVIDIA fixture', utilizationPercent: NaN, usedMB: undefined, totalMB: null }], transcript: 'not a metric' };
  } });
  await monitor.sample();
  const failed = monitor.snapshot();
  assert.equal(failed.samples[0].cpuPercent, null);
  assert.equal(failed.samples[0].appMemoryMB, null);
  assert.equal(failed.samples[0].memoryTotalGB, null);
  assert.ok(failed.alerts.some(alert => alert.code === 'RESOURCE_SAMPLE_FAILED'));
  time(5000); await monitor.sample();
  time(15000); await monitor.sample();
  assert.deepEqual(calls, [true, false, true]);
  const snapshot = monitor.snapshot();
  assert.deepEqual(snapshot.samples.at(-1).gpus[0], { name: 'NVIDIA fixture', utilizationPercent: null, usedMB: null, totalMB: null });
  assert.ok(snapshot.alerts.some(alert => alert.code === 'LOW_MEMORY' && alert.message.includes('2 GB')));
  assert.ok(snapshot.alerts.every(alert => ['warning', 'info', 'error'].includes(alert.level)));
  assert.ok(!JSON.stringify(snapshot).includes('private'));
  assert.ok(!JSON.stringify(snapshot).includes('not a metric'));
});

test('sample ring holds 60 chronological entries, snapshots are detached, and timing never regresses', async t => {
  const { monitor, time } = setup(t);
  monitor.init();
  const id = monitor.begin(taskInput);
  monitor.stageStart(id, 'asr');
  time(100); const previousDuration = monitor.snapshot().tasks[0].durationMs;
  time(50); assert.equal(monitor.snapshot().tasks[0].durationMs, previousDuration);
  monitor.finish(id, 'success');
  for (let index = 0; index < 65; index++) { time(index * 5000); await monitor.sample(); }
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.samples.length, 60);
  assert.equal(snapshot.samples[0].at, new Date(ORIGIN + 25000).toISOString());
  assert.equal(snapshot.samples.at(-1).at, new Date(ORIGIN + 320000).toISOString());
  snapshot.tasks[0].status = 'failed';
  snapshot.samples[0].memoryUsedGB = 0;
  assert.equal(monitor.snapshot().tasks[0].status, 'success');
  assert.equal(monitor.snapshot().samples[0].memoryUsedGB, 8);
});

test('start schedules a single five-second timer and stop clears it', async t => {
  const timers = [];
  const cleared = [];
  t.mock.method(global, 'setInterval', (action, interval) => { const token = { action, interval, unref() {} }; timers.push(token); return token; });
  t.mock.method(global, 'clearInterval', token => cleared.push(token));
  const { monitor } = setup(t);
  monitor.start();
  monitor.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].interval, 5000);
  await monitor.sample();
  monitor.stop();
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0], timers[0]);
});

test('real sampler math uses CPU counter deltas and one bounded NVIDIA query per interval', async t => {
  const { paths } = fixture(t);
  const filename = path.join(ROOT, 'core', 'monitor.cjs');
  const realRequire = createRequire(filename);
  let cpuCall = 0, clock = ORIGIN;
  const gpuCalls = [];
  const scriptModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'node:os' ? {
      cpus: () => [{ times: cpuCall++ === 0 ? { idle: 800, user: 200 } : { idle: 850, user: 250 } }],
      totalmem: () => 16 * 1024 ** 3, freemem: () => 8 * 1024 ** 3,
    } : name === 'node:child_process' ? { execFile: (executable, args, options, callback) => {
      gpuCalls.push({ executable, args, options });
      callback(null, { stdout: 'NVIDIA fixture, 25, 512, 8192\nNVIDIA unknown, , N/A, [Not Supported]\n' });
    } } : realRequire(name),
    module: scriptModule, process, Buffer, setInterval, clearInterval,
  }, { filename });
  const monitor = scriptModule.exports.createMonitor({ paths, now: () => clock, getAppMemoryMB: () => 100 });
  await monitor.sample();
  clock += 5000;
  await monitor.sample();
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.samples[0].cpuPercent, null);
  assert.equal(snapshot.samples[1].cpuPercent, 50);
  assert.equal(snapshot.samples[1].memoryUsedGB, 8);
  assert.equal(gpuCalls.length, 1);
  assert.equal(gpuCalls[0].options.timeout, 2000);
  assert.equal(gpuCalls[0].options.windowsHide, true);
  assert.equal(snapshot.samples[0].gpus[0].usedMB, 512);
  assert.equal(snapshot.samples[0].gpus[1].utilizationPercent, null);
  assert.equal(snapshot.samples[0].gpus[1].usedMB, null);
  assert.equal(snapshot.samples[0].gpus[1].totalMB, null);
});
