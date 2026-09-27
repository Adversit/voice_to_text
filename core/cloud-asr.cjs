'use strict';

const { randomUUID } = require('node:crypto');
const { AppError } = require('./contracts.cjs');
const { MAX_AUDIO_BYTES } = require('./audio.cjs');
const { getSpeechProvider, validateProviderEndpoint } = require('./speech-apis.cjs');

function multipart(wav, fields) {
  const boundary = `murmur-${randomUUID()}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
  parts.push(wav, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

function parseText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new AppError('NO_TRANSCRIPT', '模型没有返回文字，请确认录音包含清晰语音。');
  if (text.length > 20000) throw new AppError('PROVIDER_RESPONSE', '模型返回的文字超过 20000 字符。');
  return text.trim();
}

// Pure request construction. Audio must be the main-process validateWav result.
// Nothing here reads settings files, reaches a network or retains credentials.
function buildCloudAsrRequest({ settings, audio, key } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new AppError('API_KEY_REQUIRED', '请先在设置中保存此功能的 API 密钥。');
  if (key.length > 4096 || /[\u0000-\u001f\u007f]/.test(key) || /[^\x21-\x7e]/.test(key.trim())) throw new AppError('API_KEY_INVALID', 'API 密钥格式无效，请重新填写。');
  const asr = settings?.asr;
  const provider = getSpeechProvider(asr?.provider);
  if (!provider) throw new AppError('INVALID_SETTINGS', '语音服务商无效，请重新选择。');
  let endpoint;
  try { endpoint = validateProviderEndpoint(provider.id, asr.endpoint); } catch (error) {
    throw new AppError('INVALID_SETTINGS', error.message);
  }
  if (typeof asr.apiModel !== 'string' || !asr.apiModel.trim() || asr.apiModel.length > 200 || /[\u0000-\u001f\u007f]/.test(asr.apiModel)) {
    throw new AppError('INVALID_SETTINGS', '语音 API 模型名称无效，请检查设置。');
  }
  if (!['auto', 'zh', 'en'].includes(asr.language)) throw new AppError('INVALID_SETTINGS', '识别语言无效，请重新选择。');
  if (!Buffer.isBuffer(audio?.wav) || audio.wav.length < 44) throw new AppError('AUDIO_INVALID', '录音数据无效，请重新录音。');
  if (audio.wav.length > MAX_AUDIO_BYTES) throw new AppError('AUDIO_TOO_LARGE', '录音文件超过 4 MB，请缩短录音。');
  const model = asr.apiModel.trim();
  const headers = { Authorization: `Bearer ${key.trim()}` };
  const url = new URL(endpoint);
  const route = provider.protocol === 'dashscope-chat' ? '/chat/completions' : '/audio/transcriptions';
  // A custom service can store either a base URL or its complete transcription route.
  if (!url.pathname.endsWith(route)) url.pathname = `${url.pathname.replace(/\/+$/, '')}${route}`;

  if (provider.protocol === 'dashscope-chat') {
    const asrOptions = { enable_itn: false };
    if (asr.language !== 'auto') asrOptions.language = asr.language;
    const body = Buffer.from(JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audio.wav.toString('base64')}` } }] }],
      stream: false,
      asr_options: asrOptions,
    }), 'utf8');
    return {
      url, body, headers: { ...headers, 'Content-Type': 'application/json' },
      parseResponse: response => parseText(response?.choices?.[0]?.message?.content),
    };
  }

  const fields = { model };
  if (provider.protocol === 'openai-multipart') {
    fields.response_format = 'json';
    if (asr.language !== 'auto') {
      const languageField = provider.id === 'openai' && model === 'gpt-transcribe' ? 'languages[]' : 'language';
      fields[languageField] = asr.language;
    }
  }
  const request = multipart(audio.wav, fields);
  return { url, body: request.body, headers: { ...request.headers, ...headers }, parseResponse: response => parseText(response?.text) };
}

module.exports = { buildCloudAsrRequest, multipart };
