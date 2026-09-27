'use strict';
const { DEFAULT_SHORTCUT, parseShortcut } = require('./shortcuts.cjs');
const { getSpeechProviders, getSpeechProvider } = require('./speech-apis.cjs');

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function defaults() {
  return {
    schemaVersion: 1,
    asr: { mode: 'local', engine: 'faster-whisper', provider: 'custom', modelId: 'whisper-base', endpoint: 'http://127.0.0.1:8080', apiModel: 'whisper-1', language: 'auto', device: 'cpu', pythonPath: 'python' },
    vad: { mode: 'energy', modelId: 'silero-vad', threshold: 0.015 },
    polish: { mode: 'off', endpoint: 'http://127.0.0.1:8081/v1', apiModel: 'qwen2.5-1.5b', modelId: 'qwen-1.5b', style: 'natural' },
    general: { autoCopy: true, autoPaste: true, saveHistory: true, shortcut: DEFAULT_SHORTCUT },
  };
}

function invalid(field) {
  throw new AppError('INVALID_SETTINGS', `\u8bbe\u7f6e\u5b57\u6bb5\u65e0\u6548\uff1a${field}`);
}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
}
function pick(value, choices, field) {
  if (!choices.includes(value)) invalid(field);
  return value;
}
function str(value, field, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) invalid(field);
  return value.trim();
}
function endpoint(value, field, route) {
  const raw = str(value, field, 2048);
  if(/[\u007f\\]/u.test(raw))invalid(field);
  let url;
  try { url = new URL(raw); } catch { invalid(field); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) invalid(field);
  if (route === 'cloud' && url.protocol !== 'https:') {
    throw new AppError('INVALID_ENDPOINT', '\u4e91\u7aef API \u5730\u5740\u5fc5\u987b\u4f7f\u7528 HTTPS\u3002');
  }
  if (route === 'local' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new AppError('INVALID_ENDPOINT', '\u672c\u5730\u670d\u52a1\u5730\u5740\u5fc5\u987b\u4e3a localhost\u3001127.0.0.1 \u6216 [::1]\u3002');
  }
  return raw.replace(/\/+$/u, '');
}

function shortcut(value, allowReserved) {
  try { return parseShortcut(value, { allowReserved }).value; }
  catch (error) { throw new AppError('INVALID_SETTINGS', error.message); }
}

function validateSettings(value, { allowReservedShortcut = false } = {}) {
  object(value, 'settings');
  if (value.schemaVersion !== 1) throw new AppError('UNSUPPORTED_SCHEMA', '\u8bbe\u7f6e\u7248\u672c\u4e0d\u53d7\u652f\u6301\uff0c\u539f\u6587\u4ef6\u5df2\u4fdd\u7559\u3002');
  for (const field of ['asr', 'vad', 'polish', 'general']) object(value[field], field);
  const { asr, vad, polish, general } = value;
  const asrMode = pick(asr.mode, ['local', 'cloud'], 'asr.mode');
  const engine = pick(asr.engine, ['faster-whisper', 'openai', 'whisper-cpp'], 'asr.engine');
  const provider = pick(asr.provider, getSpeechProviders().map(item => item.id), 'asr.provider');
  if (asrMode === 'local' && engine === 'openai') invalid('asr.engine');
  if (asrMode === 'cloud' && engine !== 'openai') invalid('asr.engine');
  const polishMode = pick(polish.mode, ['off', 'local', 'cloud'], 'polish.mode');
  if (typeof vad.threshold !== 'number' || !Number.isFinite(vad.threshold) || vad.threshold < 0.001 || vad.threshold > 0.2) invalid('vad.threshold');
  if (typeof general.autoCopy !== 'boolean' || typeof general.autoPaste !== 'boolean' || typeof general.saveHistory !== 'boolean') invalid('general');
  const recordingShortcut = shortcut(general.shortcut, allowReservedShortcut);
  const asrEndpoint = endpoint(asr.endpoint, 'asr.endpoint', asrMode === 'cloud' ? 'cloud' : engine === 'whisper-cpp' ? 'local' : null);
  if(asrMode === 'cloud' && provider !== 'custom' && !getSpeechProvider(provider).endpoints.some(item=>item.value===asrEndpoint)) {
    throw new AppError('INVALID_ENDPOINT', '请选择该供应商的官方服务地址；其他服务请使用自定义 API。');
  }
  return {
    schemaVersion: 1,
    asr: {
      mode: asrMode, engine, provider,
      modelId: pick(asr.modelId, ['whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-medium'], 'asr.modelId'),
      endpoint: asrEndpoint,
      apiModel: str(asr.apiModel, 'asr.apiModel', 200), language: pick(asr.language, ['auto', 'zh', 'en'], 'asr.language'),
      device: pick(asr.device, ['cpu', 'cuda'], 'asr.device'), pythonPath: str(asr.pythonPath, 'asr.pythonPath', 1024),
    },
    vad: { mode: pick(vad.mode, ['energy', 'silero', 'off'], 'vad.mode'), modelId: pick(vad.modelId, ['silero-vad'], 'vad.modelId'), threshold: vad.threshold },
    polish: {
      mode: polishMode, endpoint: endpoint(polish.endpoint, 'polish.endpoint', polishMode === 'off' ? null : polishMode),
      apiModel: str(polish.apiModel, 'polish.apiModel', 200), modelId: pick(polish.modelId, ['qwen-0.5b', 'qwen-1.5b', 'qwen-3b'], 'polish.modelId'),
      style: pick(polish.style, ['natural', 'concise', 'formal'], 'polish.style'),
    },
    general: { autoCopy: general.autoCopy, autoPaste: general.autoPaste, saveHistory: general.saveHistory, shortcut: recordingShortcut },
  };
}

async function envelope(action) {
  try { return { ok: true, data: await action() }; }
  catch (error) {
    return { ok: false, error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002' } };
  }
}

module.exports = { AppError, defaults, validateSettings, envelope };
