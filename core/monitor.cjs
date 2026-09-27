'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { performance } = require('node:perf_hooks');
const { assertContained } = require('./paths.cjs');

const execute = promisify(execFile);
const INTERVAL_MS = 5000;
const GPU_INTERVAL_MS = 15000;
const MAX_TASKS = 100;
const MAX_SAMPLES = 60;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const KINDS = new Set(['transcribe', 'polish', 'demo']);
const TRIGGERS = new Set(['button', 'shortcut', 'manual']);
const ROUTES = new Set(['local', 'cloud', 'demo']);
const STAGES = new Set(['preparing', 'recording', 'audio', 'vad', 'asr', 'polish', 'delivery']);
const TASK_END = new Set(['success', 'warning', 'failed', 'canceled', 'interrupted']);
const STAGE_END = new Set(['success', 'failed', 'skipped', 'canceled', 'interrupted']);
const ERROR_CODES = new Set([
  'UNKNOWN_ERROR', 'AUDIO_DURATION', 'AUDIO_EMPTY', 'AUDIO_FORMAT', 'AUDIO_INVALID',
  'AUDIO_SILENT', 'AUDIO_TOO_LARGE', 'AUDIO_TOO_LONG', 'AUDIO_TOO_SHORT', 'AUDIO_SHORT',
  'VAD_INVALID', 'INVALID_ENDPOINT', 'INVALID_SETTINGS', 'UNSUPPORTED_SCHEMA',
  'INVALID_ROOT', 'PATH_UNAVAILABLE', 'UNSAFE_PATH', 'API_KEY_INVALID', 'API_KEY_REQUIRED',
  'BUSY', 'ENDPOINT_INVALID', 'HTTPS_REQUIRED', 'LOCAL_ENDPOINT_REQUIRED', 'MODEL_INVALID',
  'MODEL_MISSING', 'NO_TRANSCRIPT', 'PROVIDER_CONNECTION', 'PROVIDER_HTTP', 'PROVIDER_INVALID',
  'PROVIDER_REDIRECT', 'PROVIDER_RESPONSE', 'PROVIDER_TIMEOUT', 'RUNTIME_MISSING',
  'LOCAL_INFERENCE', 'PATH_UNSAFE', 'REQUEST_INVALID',
  'RUNTIME_RESPONSE', 'TEXT_EMPTY', 'TEXT_TOO_LONG', 'DECRYPTION_FAILED', 'ENCRYPTION_FAILED',
  'ENCRYPTION_UNAVAILABLE', 'INVALID_HISTORY', 'INVALID_KEYS', 'STORE_CORRUPT',
  'STORE_NOT_READY', 'STORE_WRITE_FAILED', 'FORBIDDEN', 'INVALID_ACTION', 'INVALID_EXPORT',
  'INVALID_PATH', 'INVALID_SESSION', 'INVALID_TEXT', 'OPEN_FAILED', 'SHORTCUT_BUSY',
  'MICROPHONE_UNAVAILABLE', 'DELIVERY_SKIPPED', 'DELIVERY_FAILED', 'RENDERER_INTERRUPTED',
  'INTERRUPTED', 'CANCELED', 'HELPER_UNAVAILABLE', 'HELPER_TIMEOUT', 'HELPER_RESPONSE',
  'HELPER_CANCELED', 'INPUT_UNAVAILABLE',
]);
const clone = value => JSON.parse(JSON.stringify(value));
const rounded = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const numeric = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const code = value => value == null ? null : typeof value === 'string' && ERROR_CODES.has(value) ? value : 'UNKNOWN_ERROR';
function caughtCode(error) {
  try { return code(error?.code) || 'UNKNOWN_ERROR'; } catch { return 'UNKNOWN_ERROR'; }
}

function cpuTimes() {
  const cpus = os.cpus();
  if (!cpus.length) return null;
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    for (const value of Object.values(cpu.times)) total += value;
  }
  return Number.isFinite(total) && Number.isFinite(idle) ? { idle, total } : null;
}

function defaultSampler() {
  let previousCpu = null;
  let nvidiaExecutable;
  async function gpuMetrics() {
    if (!nvidiaExecutable) {
      const candidates = process.platform === 'win32' ? [
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
        path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
      ] : [];
      // Pick one candidate, rather than paying several two-second timeouts.
      nvidiaExecutable = candidates.find(file => fs.existsSync(file)) || (process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi');
    }
    try {
      const { stdout } = await execute(nvidiaExecutable, ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], {
        windowsHide: true, timeout: 2000, maxBuffer: 64 * 1024, encoding: 'utf8',
      });
      return stdout.trim().split(/\r?\n/u).filter(Boolean).slice(0, 16).map(line => {
        const parts = line.split(',');
        const numberToken = () => {
          const token = parts.pop()?.trim();
          return token && /^\d+(?:\.\d+)?$/u.test(token) ? Number(token) : null;
        };
        const totalMB = numberToken();
        const usedMB = numberToken();
        const utilizationPercent = numberToken();
        return { name: parts.join(',').trim(), utilizationPercent, usedMB, totalMB };
      });
    } catch { return []; }
  }
  return async ({ gpuDue }) => {
    let cpuPercent = null;
    try {
      const current = cpuTimes();
      if (current && previousCpu) {
        const total = current.total - previousCpu.total;
        const idle = current.idle - previousCpu.idle;
        if (total > 0 && idle >= 0 && idle <= total) cpuPercent = rounded((1 - idle / total) * 100, 1);
      }
      previousCpu = current;
    } catch { previousCpu = null; }
    let memoryTotalGB = null, memoryUsedGB = null;
    try {
      const total = os.totalmem(), free = os.freemem();
      if (total > 0 && free >= 0 && free <= total) {
        memoryTotalGB = rounded(total / 1024 ** 3);
        memoryUsedGB = rounded((total - free) / 1024 ** 3);
      }
    } catch { /* Unknown resource readings stay null. */ }
    return { cpuPercent, memoryTotalGB, memoryUsedGB, ...(gpuDue ? { gpus: await gpuMetrics() } : {}) };
  };
}

function cleanGpu(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim()) return null;
  return {
    name: value.name.replace(/[\u0000-\u001f]/gu, '').slice(0, 200),
    utilizationPercent: numeric(value.utilizationPercent, 0, 100),
    usedMB: numeric(value.usedMB), totalMB: numeric(value.totalMB, Number.MIN_VALUE),
  };
}

function storedTask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(value.id)
    || typeof value.createdAt !== 'string' || value.createdAt.length > 40 || !Number.isFinite(Date.parse(value.createdAt))
    || !KINDS.has(value.kind) || !TRIGGERS.has(value.trigger) || !ROUTES.has(value.route)
    || !(value.status === 'running' || TASK_END.has(value.status))
    || numeric(value.durationMs, 0, MAX_DURATION_MS) === null
    || !Array.isArray(value.stages) || value.stages.length > STAGES.size) throw new Error('Invalid monitor task');
  const stages = value.stages.map(stage => {
    if (!stage || !STAGES.has(stage.name) || !(stage.status === 'running' || STAGE_END.has(stage.status))
      || numeric(stage.durationMs, 0, MAX_DURATION_MS) === null) throw new Error('Invalid monitor stage');
    return { name: stage.name, status: stage.status, durationMs: stage.durationMs, errorCode: code(stage.errorCode) };
  });
  if (new Set(stages.map(stage => stage.name)).size !== stages.length) throw new Error('Duplicate stage');
  return { id: value.id, createdAt: value.createdAt, kind: value.kind, trigger: value.trigger, route: value.route,
    status: value.status, durationMs: value.durationMs, errorCode: code(value.errorCode), stages };
}

function createMonitor(options = {}) {
  const { paths, onChange, getAppMemoryMB, now, sampleResources } = options || {};
  const readResources = typeof sampleResources === 'function' ? sampleResources : defaultSampler();
  const tasks = [];
  const samples = [];
  let initialized = false, readBlocked = false, paused = false, timer = null, sampling = null;
  let epoch = 0, sampledAt = null, lastGpuAttempt = null, gpuSampledAt = null, gpus = [];
  let sampleFailed = false, notifying = false;
  let storage = { persisted: false, message: '监控存储尚未初始化。' };
  let lastTick = 0;
  function clock() {
    let wall;
    try { wall = typeof now === 'function' ? Number(now()) : Date.now(); } catch { wall = Date.now(); }
    if (!Number.isFinite(wall) || Math.abs(wall) > 8.64e15) wall = Date.now();
    let tick = typeof now === 'function' ? wall : performance.now();
    if (!Number.isFinite(tick)) tick = lastTick;
    lastTick = Math.max(lastTick, tick);
    return { at: new Date(wall).toISOString(), tick: lastTick };
  }
  const elapsed = (start, tick) => rounded(Math.min(MAX_DURATION_MS, Math.max(0, tick - start)), 1);
  function publicTasks(tick = clock().tick) {
    return tasks.map(task => ({ ...task.value,
      durationMs: task.start === null ? task.value.durationMs : elapsed(task.start, tick),
      stages: task.value.stages.map(stage => ({ ...stage, durationMs: task.stageStarts.has(stage.name) ? elapsed(task.stageStarts.get(stage.name), tick) : stage.durationMs })),
    }));
  }
  function alerts() {
    const result = [];
    if (!storage.persisted) result.push({ code: 'MONITOR_STORAGE_UNAVAILABLE', level: 'warning', message: storage.message });
    if (sampleFailed) result.push({ code: 'RESOURCE_SAMPLE_FAILED', level: 'warning', message: '资源采样未完成，未知数据未作为零值处理。任务记录仍可继续。' });
    const latest = samples.at(-1);
    if (latest && latest.memoryTotalGB !== null && latest.memoryUsedGB !== null) {
      const available = latest.memoryTotalGB - latest.memoryUsedGB;
      if (available < 2 || available / latest.memoryTotalGB < 0.1) result.push({ code: 'LOW_MEMORY', level: 'warning', message: '当前可用系统内存低于 2 GB 或总内存的 10%；建议先释放资源。此提示不代表模型实测性能。' });
    }
    if (gpuSampledAt && (!gpus.length || gpus.some(gpu => gpu.utilizationPercent === null || gpu.usedMB === null || gpu.totalMB === null))) {
      result.push({ code: 'GPU_METRICS_UNAVAILABLE', level: 'info', message: '部分 GPU 实时指标不可用；未安装工具、驱动或不支持的显卡会显示未知。' });
    }
    return result;
  }
  function snapshot() {
    const current = publicTasks();
    return clone({ schemaVersion: 1, paused, intervalMs: INTERVAL_MS, sampledAt,
      samples, tasks: current, alerts: alerts(), storage,
      counters: { completed: current.filter(task => task.status === 'success' || task.status === 'warning').length,
        failed: current.filter(task => task.status === 'failed').length,
        canceled: current.filter(task => task.status === 'canceled' || task.status === 'interrupted').length },
    });
  }
  function notify() {
    if (notifying || typeof onChange !== 'function') return;
    notifying = true;
    try {
      const result = onChange(snapshot());
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch { /* Monitor listeners cannot break dictation or persistence. */ }
    finally { notifying = false; }
  }
  function location() {
    const directory = assertContained(paths.root, paths.data);
    return assertContained(paths.root, path.join(directory, 'monitor.json'));
  }
  function persist() {
    if (readBlocked) return false;
    let temporary, fd;
    try {
      const destination = location();
      fs.mkdirSync(assertContained(paths.root, paths.data), { recursive: true });
      const content = JSON.stringify({ schemaVersion: 1, tasks: publicTasks() }, null, 2) + '\n';
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Monitor size limit');
      temporary = assertContained(paths.root, `${destination}.${randomUUID()}.tmp`);
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      location();
      fs.renameSync(temporary, destination);
      storage = { persisted: true, message: '' };
      return true;
    } catch {
      storage = { persisted: false, message: '监控记录暂时无法保存；任务继续在内存中记录。请检查项目 data 目录权限和空间。' };
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* No content in diagnostics. */ }
      if (temporary) try { fs.unlinkSync(assertContained(paths.root, temporary)); } catch { /* Preserve previous durable file. */ }
      return false;
    }
  }
  function init() {
    if (initialized) return snapshot();
    initialized = true;
    let needsPersist = false;
    try {
      const file = location();
      if (!fs.existsSync(file)) needsPersist = true;
      else {
        const info = fs.statSync(file);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Invalid monitor file');
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
        if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks) || parsed.tasks.length > MAX_TASKS) throw new Error('Invalid monitor schema');
        const clean = parsed.tasks.map(storedTask);
        if (new Set(clean.map(task => task.id)).size !== clean.length) throw new Error('Duplicate monitor task');
        for (const value of clean) {
          if (value.status === 'running') { value.status = 'interrupted'; value.errorCode = 'INTERRUPTED'; needsPersist = true; }
          for (const stage of value.stages) if (stage.status === 'running') { stage.status = 'interrupted'; stage.errorCode = 'INTERRUPTED'; needsPersist = true; }
        }
        clean.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
        tasks.push(...clean.map(value => ({ value, start: null, stageStarts: new Map() })));
        storage = { persisted: true, message: '' };
        if (JSON.stringify(parsed) !== JSON.stringify({ schemaVersion: 1, tasks: clean })) needsPersist = true;
      }
    } catch {
      readBlocked = true;
      storage = { persisted: false, message: '监控文件无法读取、已损坏或版本不支持；原文件保持不变，本次仅在内存中记录。' };
    }
    if (needsPersist && !readBlocked) persist();
    notify();
    return snapshot();
  }
  function changed() { persist(); notify(); }
  function begin(metadata) {
    if (!initialized) init();
    if (!metadata || !KINDS.has(metadata.kind) || !TRIGGERS.has(metadata.trigger) || !ROUTES.has(metadata.route)) return null;
    const time = clock();
    const id = randomUUID();
    tasks.unshift({ value: { id, createdAt: time.at, kind: metadata.kind, trigger: metadata.trigger, route: metadata.route,
      status: 'running', durationMs: 0, errorCode: null, stages: [] }, start: time.tick, stageStarts: new Map() });
    if (tasks.length > MAX_TASKS) tasks.length = MAX_TASKS;
    changed();
    return id;
  }
  function stageStart(id, name) {
    const task = tasks.find(task => task.value.id === id);
    if (!task || task.value.status !== 'running' || !STAGES.has(name) || task.value.stages.some(stage => stage.name === name)) return;
    task.value.stages.push({ name, status: 'running', durationMs: 0, errorCode: null });
    task.stageStarts.set(name, clock().tick);
    changed();
  }
  function stageEnd(id, name, status = 'success', errorCode) {
    const task = tasks.find(task => task.value.id === id);
    const stage = task?.value.stages.find(stage => stage.name === name);
    if (!task || task.value.status !== 'running' || !stage || stage.status !== 'running' || !STAGE_END.has(status)) return;
    stage.durationMs = elapsed(task.stageStarts.get(name), clock().tick);
    stage.status = status;
    stage.errorCode = code(errorCode);
    task.stageStarts.delete(name);
    changed();
  }
  async function trace(id, name, action) {
    stageStart(id, name);
    try {
      const result = await action();
      stageEnd(id, name);
      return result;
    } catch (error) {
      stageEnd(id, name, 'failed', caughtCode(error));
      throw error;
    }
  }
  function finish(id, status, errorCode) {
    const task = tasks.find(task => task.value.id === id);
    if (!task || task.value.status !== 'running' || !TASK_END.has(status)) return;
    const tick = clock().tick;
    task.value.durationMs = elapsed(task.start, tick);
    task.value.status = status;
    task.value.errorCode = code(errorCode);
    task.start = null;
    for (const stage of task.value.stages) if (stage.status === 'running') {
      stage.durationMs = elapsed(task.stageStarts.get(stage.name), tick);
      stage.status = status === 'success' || status === 'warning' ? 'success' : status;
      stage.errorCode = code(errorCode);
    }
    task.stageStarts.clear();
    changed();
  }
  function sample() {
    if (!initialized) init();
    if (paused) return Promise.resolve(snapshot());
    if (sampling) return sampling;
    const generation = epoch;
    const time = clock();
    const gpuDue = lastGpuAttempt === null || time.tick - lastGpuAttempt >= GPU_INTERVAL_MS;
    if (gpuDue) lastGpuAttempt = time.tick;
    sampling = Promise.resolve().then(async () => {
      const [resources, appMemory] = await Promise.allSettled([
        Promise.resolve().then(() => readResources({ gpuDue, at: time.at })),
        Promise.resolve().then(() => typeof getAppMemoryMB === 'function' ? getAppMemoryMB() : null),
      ]);
      if (generation !== epoch || paused) return snapshot();
      const raw = resources.status === 'fulfilled' && resources.value && typeof resources.value === 'object' ? resources.value : {};
      sampleFailed = resources.status === 'rejected' || appMemory.status === 'rejected';
      if (gpuDue) {
        gpus = Array.isArray(raw.gpus) ? raw.gpus.slice(0, 16).map(cleanGpu).filter(Boolean) : [];
        gpuSampledAt = time.at;
      }
      const memoryTotalGB = numeric(raw.memoryTotalGB, Number.MIN_VALUE);
      const memoryUsedGB = memoryTotalGB === null ? null : numeric(raw.memoryUsedGB, 0, memoryTotalGB);
      samples.push({ at: time.at, cpuPercent: numeric(raw.cpuPercent, 0, 100), memoryUsedGB, memoryTotalGB,
        appMemoryMB: appMemory.status === 'fulfilled' ? numeric(appMemory.value) : null,
        gpus: clone(gpus), gpuSampledAt });
      if (samples.length > MAX_SAMPLES) samples.shift();
      sampledAt = time.at;
      notify();
      return snapshot();
    }).catch(() => {
      sampleFailed = true;
      notify();
      return snapshot();
    }).finally(() => { sampling = null; });
    return sampling;
  }
  function start() {
    if (!initialized) init();
    if (!timer) { timer = setInterval(() => { void sample(); }, INTERVAL_MS); timer.unref?.(); }
    if (!paused) void sample();
    return snapshot();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; epoch++; }
  function setPaused(value) {
    if (typeof value !== 'boolean') return snapshot();
    if (paused !== value) { paused = value; epoch++; notify(); }
    return snapshot();
  }
  return { init, start, stop, sample, setPaused, begin, stageStart, stageEnd, trace, finish, snapshot };
}

module.exports = { createMonitor };
