'use strict';

// Public metadata only: keys and per-user endpoint bindings belong to the store.
const providers = [
  {
    id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'siliconflow-multipart',
    defaultEndpoint: 'https://api.siliconflow.cn/v1',
    endpoints: [{ value: 'https://api.siliconflow.cn/v1', label: '中国大陆' }],
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
    models: ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'],
    docsUrl: 'https://docs.siliconflow.cn/docs/api/audio-transcriptions-post',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    notes: '上传录音文件进行识别；此接口自动判断语种，不发送语言参数。填写密钥后需实际录音验证。',
  },
  {
    id: 'dashscope', name: '阿里云百炼 DashScope', protocol: 'dashscope-chat',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpoints: [
      { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '华北 2（北京）' },
      { value: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', label: '新加坡' },
    ],
    defaultModel: 'qwen3-asr-flash', models: ['qwen3-asr-flash'],
    docsUrl: 'https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference',
    keyUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    notes: 'Qwen ASR Flash 使用音频聊天接口；北京与新加坡的密钥分别配置，切换地域后需重新确认密钥。',
  },
  {
    id: 'openai', name: 'OpenAI', protocol: 'openai-multipart',
    defaultEndpoint: 'https://api.openai.com/v1',
    endpoints: [{ value: 'https://api.openai.com/v1', label: 'OpenAI 官方' }],
    defaultModel: 'gpt-transcribe',
    models: ['gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
    docsUrl: 'https://developers.openai.com/api/docs/guides/speech-to-text',
    keyUrl: 'https://platform.openai.com/api-keys',
    notes: '官方语音转写接口；模型与账户权限以服务商为准。已填写密钥不代表已验证可用。',
  },
  {
    id: 'groq', name: 'Groq', protocol: 'openai-multipart',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    endpoints: [{ value: 'https://api.groq.com/openai/v1', label: 'Groq 官方' }],
    defaultModel: 'whisper-large-v3-turbo', models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    docsUrl: 'https://console.groq.com/docs/speech-to-text',
    keyUrl: 'https://console.groq.com/keys',
    notes: '使用 Groq 的 Whisper 转写接口；需该平台独立密钥，当前未进行真实调用验证。',
  },
  {
    id: 'custom', name: '自定义兼容服务', protocol: 'openai-multipart',
    defaultEndpoint: 'https://api.openai.com/v1', endpoints: [],
    defaultModel: 'whisper-1', models: ['whisper-1'],
    docsUrl: 'https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create',
    keyUrl: '',
    notes: '仅支持兼容 OpenAI 文件转写协议的 HTTPS 服务。示例地址为 OpenAI，请填写所用服务的地址、模型和密钥。',
  },
];

function getSpeechProviders() { return structuredClone(providers); }

function getSpeechProvider(id) {
  const provider = providers.find(item => item.id === id);
  return provider ? structuredClone(provider) : null;
}

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_SETTINGS';
  throw error;
}

function validateProviderEndpoint(providerId, endpoint) {
  const provider = getSpeechProvider(providerId);
  if (!provider) invalid('语音服务商无效，请重新选择。');
  if (typeof endpoint !== 'string' || !endpoint.trim() || endpoint.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(endpoint)) {
    invalid('语音服务地址无效，请检查设置。');
  }
  let url;
  try { url = new URL(endpoint.trim()); } catch { invalid('语音服务地址无效，请检查设置。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    invalid('云端语音地址必须使用 HTTPS，且不能包含账户、查询参数或片段。');
  }
  const normalized = url.href.replace(/\/+$/, '');
  if (providerId !== 'custom' && !provider.endpoints.some(item => item.value === normalized)) {
    invalid('此服务商仅允许使用列出的官方地址。');
  }
  return normalized;
}

module.exports = { getSpeechProviders, getSpeechProvider, validateProviderEndpoint };
