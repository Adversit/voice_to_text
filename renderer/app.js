import { icon, hydrateIcons } from './icons.js';
import { MicrophoneRecorder } from './audio.js';
import { formatShortcut, createShortcutCaptureState } from './shortcuts.js';

const main = document.querySelector('#main');
const api = window.murmur;
const state = { snapshot: null, page: 'workbench', busy: null, recording: false, starting: false, cancelRequested: false, session: null, seconds: 0, text: '', rawText: '', resultSource: '', resultWarnings: [], delivery: null, error: '', modelFilter: 'all', historySearch: '', draft: null, keys: {}, clearKeys: {}, dirty: false, monitor: null, monitorAction: null, monitorMetric: 'cpu', taskFilter: 'all', expandedTask: null, shortcutCapture: null };
const labels = { workbench: ['工作台', '让表达，更轻一点'], models: ['模型库', '为每一道工序，选择合适的模型'], device: ['我的设备', '从真实配置出发'], monitor: ['运行监控', '看见资源、阶段与每一次结果'], history: ['转写历史', '每一次表达，都有迹可循'], settings: ['偏好设置', '打造适合自己的声音工作流'] };
const taskLabels = { asr: '语音转写', vad: '语音检测', polish: '文字润色' };
const sourceLabels = { local: '本地转写', cloud: '云端转写', demo: '演示样例' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const disabled = value => value ? ' disabled' : '';
const selected = (a, b) => a === b ? ' selected' : '';
const checked = value => value ? ' checked' : '';
const formatSize = mb => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
const formatTime = ms => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const dateTime = value => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); };
const modelName = id => state.snapshot?.models?.find(model => model.id === id)?.name || id;
const blocked = () => Boolean(state.busy || state.recording || state.starting);
const deliveryLabels = { pasted: '已自动粘贴', copied: '已复制到剪贴板', skipped: '未自动粘贴', failed: '自动粘贴未完成', 'not-requested': '未请求自动粘贴' };

function deliveryNote(delivery, source = '') {
  if (!delivery) return '';
  const status = delivery.status || 'not-requested';
  return `<div class="delivery-note ${status === 'pasted' ? 'delivered' : ''}">${icon(status === 'pasted' ? 'check' : status === 'copied' ? 'copy' : 'info')}<span><strong>${source === 'demo' ? '演示样例 · 不自动粘贴' : deliveryLabels[status] || '交付状态未知'}</strong>${delivery.reason ? `<small>${escape(delivery.reason)}</small>` : ''}</span></div>`;
}

async function call(name, args) {
  if (!api?.[name]) throw new Error('桌面服务未连接。请通过项目启动脚本打开 Murmur 桌面应用。');
  const envelope = await api[name](args);
  if (!envelope?.ok) throw new Error(envelope?.error?.message || '操作未完成，请重试。');
  return envelope.data;
}

function toast(message, kind = 'success') {
  const region = document.querySelector('#toast-region');
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'info' ? 'info' : 'check')}<span>${escape(message)}</span>`;
  region.append(element);
  setTimeout(() => element.remove(), kind === 'error' ? 8500 : 4500);
}

function updateSnapshot(snapshot) {
  if (!snapshot?.settings) return;
  state.snapshot = snapshot;
  if (snapshot.monitor) state.monitor = snapshot.monitor;
  document.querySelector('#history-count').textContent = snapshot.history.length;
  const shortcut = snapshot.runtime.shortcut || snapshot.settings.general.shortcut;
  document.querySelector('#shortcut-status').textContent = `${formatShortcut(shortcut)} · ${snapshot.runtime.shortcutSuspended ? '正在录制快捷键 · 监听暂停' : snapshot.runtime.shortcutRegistered ? '全局录音快捷键' : '快捷键未注册'}`;
  if (!state.dirty) state.draft = null;
}

async function runTask(label, action, { success, keepError = false } = {}) {
  if (blocked()) return;
  state.busy = label;
  if (!keepError) state.error = '';
  render();
  try {
    const result = await action();
    if (success) toast(success);
    return result;
  } catch (error) {
    state.error = error.message;
    toast(error.message, 'error');
  } finally {
    state.busy = null;
    render();
  }
}

function banner() {
  return state.error ? `<div class="message error" role="alert">${icon('alert')}<div><strong>这一步没有完成</strong><p>${escape(state.error)}</p></div><button class="icon-button" data-action="dismiss-error" aria-label="关闭提示">${icon('close')}</button></div>` : '';
}

function routeSummary() {
  const settings = state.snapshot.settings;
  const local = settings.asr.mode === 'local';
  const model = state.snapshot.models.find(model => model.id === settings.asr.modelId);
  const embedded = local && settings.asr.engine === 'faster-whisper';
  return { local, name: embedded ? modelName(settings.asr.modelId) : settings.asr.engine === 'whisper-cpp' ? 'whisper.cpp server' : settings.asr.apiModel || '语音 API', status: embedded ? model?.installed ? '已发现模型文件 · 尚未验证运行' : '待准备模型文件' : local ? '服务待实际转写验证' : hasAsrKey(settings.asr) ? '已配置，尚未实际验证' : '待填写密钥', ready: embedded && model?.installed };
}

function renderWorkbench() {
  const settings = state.snapshot.settings;
  const route = routeSummary();
  const history = state.snapshot.history;
  const realHistory = history.filter(record => record.source !== 'demo');
  const minutes = Math.round(realHistory.reduce((sum, record) => sum + (record.durationMs || 0), 0) / 6000) / 10;
  const words = realHistory.reduce((sum, record) => sum + record.text.length, 0);
  const working = Boolean(state.busy);
  const isRecording = state.recording;
  const selectedModel = state.snapshot.models.find(model => model.id === settings.asr.modelId);
  const needSetup = settings.asr.mode === 'local' && settings.asr.engine === 'faster-whisper' && !selectedModel?.installed;
  return `<section class="welcome-row"><div><div class="eyebrow"><span></span> A LITTLE SPACE FOR BIG IDEAS</div><h1>说出来，<em>思绪自成文章。</em></h1><p class="page-description">把注意力留给想法，剩下的交给轻声。</p></div><div class="welcome-date"><span>你的私人语音工作室</span><strong>随心说，自然写。</strong></div></section>
    ${banner()}
    <div class="workbench-grid"><section class="record-card ${isRecording ? 'is-recording' : ''}"><div class="card-topline"><span class="small-label">VOICE CAPTURE <span> / 01</span></span><span class="badge ${route.local ? 'green' : 'blue'}">${icon(route.local ? 'shield' : 'cloud')}${route.local ? '本地模式' : '云端模式'}</span></div>
      <div class="record-stage"><div class="record-orbit orbit-one"></div><div class="record-orbit orbit-two"></div><button id="record-button" class="record-button ${isRecording ? 'recording' : ''}" data-action="record"${disabled(working || state.starting)} aria-label="${isRecording ? '停止录音并转写' : '开始录音'}">${icon(isRecording ? 'stop' : 'mic')}</button><div class="orbit-spark spark-one"></div><div class="orbit-spark spark-two"></div></div>
      <h2>${state.cancelRequested ? '正在取消录音…' : isRecording ? '正在聆听你的想法…' : state.starting ? '正在打开麦克风…' : working ? escape(state.busy) : '轻轻一点，开始表达'}</h2><p class="record-instruction">${isRecording ? '再次按快捷键或点击结束，最多 2 分钟' : state.starting ? state.cancelRequested ? '麦克风已停止，正在清理录音会话' : '请允许应用访问麦克风' : working ? '请稍候，完成后会显示转写结果' : '输入框中按快捷键，说完后再按一次'}</p>
      <div class="waveform ${isRecording ? 'active' : ''}" aria-hidden="true">${Array.from({ length: 43 }, (_, index) => `<span class="wave-bar wave-${index % 7}"></span>`).join('')}</div>
      <div class="record-time"><span id="record-clock">${formatTime(state.seconds * 1000)}</span><span class="time-limit"> / 02:00</span></div>
      <p class="record-delivery-hint">${state.session ? state.session.autoPasteEligible ? '完成后尝试粘贴到原输入框 · 不发送回车' : escape(state.session.reason || '本次录音在应用内开始，不自动粘贴') : settings.general.autoPaste ? state.snapshot.runtime.autoPasteAvailable ? '快捷键录音可自动粘贴 · 点按钮录音不自动粘贴' : '自动粘贴组件未就绪 · 可从剪贴板手动粘贴' : '自动粘贴已关闭 · 可复制后按 Ctrl + V'}</p>
      <div class="record-bottom"><span>${icon('keyboard')}<kbd>${escape(formatShortcut(settings.general.shortcut))}</kbd></span>${isRecording || state.starting ? `<button class="text-button" data-action="cancel-recording"${disabled(state.cancelRequested)}>${icon('close')}取消录音</button>` : `<button class="text-button" data-action="demo"${disabled(blocked())}>${icon('play')}体验演示样例</button>`}</div>
    </section>
    <div class="workbench-right"><section class="pipeline-card"><div class="section-title"><h2>你的语音工作流</h2><button class="icon-button" data-nav="settings" aria-label="配置语音工作流" title="配置语音工作流">${icon('settings')}</button></div><p class="section-caption">三个步骤，各自选用合适的小模型。</p><div class="pipeline">
      ${pipelineStep('01', 'wave', '语音检测', settings.vad.mode === 'energy' ? '轻量能量检测' : settings.vad.mode === 'off' ? '已关闭' : 'Silero VAD', settings.vad.mode === 'energy' ? '内置 · 无需下载' : settings.vad.mode === 'off' ? '不裁剪静音片段' : '本地 ONNX 模型')}
      ${pipelineStep('02', 'mic', '语音转写', route.name, route.status)}
      ${pipelineStep('03', 'sparkle', '文字润色', settings.polish.mode === 'off' ? '保留原始表达' : settings.polish.apiModel, settings.polish.mode === 'off' ? '润色已关闭' : settings.polish.mode === 'local' ? '已运行的本地服务 · 待验证' : '云端服务 · 待验证')}
      </div><button class="button secondary workflow-button" data-nav="settings">配置工作流 ${icon('arrow')}</button></section>
      <section class="setup-note"><span class="setup-note-icon">${icon(needSetup ? 'folder' : 'shield')}</span><div><strong>${needSetup ? '准备模型，让声音留在本机。' : '每一次连接，都由你决定。'}</strong><p>${needSetup ? '通过项目准备脚本或手动放置模型文件；模型与推理缓存始终留在本项目。' : '选择云端会发送音频；本地模式连接失败时，不会自动切换到云端。'}</p><button class="text-button" data-nav="${needSetup ? 'models' : 'settings'}">${needSetup ? '查看模型库' : '查看当前配置'} ${icon('arrow')}</button></div></section>
    </div></div>
    <section class="transcript-card"><div class="section-title"><div class="section-heading">${icon('text')}<h2>文字，在这里成形</h2>${state.resultSource ? `<span class="badge ${state.resultSource === 'demo' ? 'amber' : 'neutral'}">${sourceLabels[state.resultSource] || escape(state.resultSource)}</span>` : ''}</div><div class="editor-actions"><button class="text-button" data-action="restore-raw"${disabled(!state.rawText || state.text === state.rawText || blocked())}>原始转写</button><button class="button compact secondary" data-action="polish"${disabled(!state.text.trim() || blocked() || settings.polish.mode === 'off')}>${icon('sparkle')}润色</button><button class="button compact primary" data-action="copy"${disabled(!state.text.trim())}>${icon('copy')}复制文本</button></div></div>
      ${state.resultWarnings.length ? `<div class="result-warning">${icon('info')}<span>${state.resultWarnings.map(escape).join('；')}</span></div>` : ''}
      ${deliveryNote(state.delivery, state.resultSource)}
      <textarea id="transcript" class="transcript-editor" aria-label="转写文本，可编辑" placeholder="你的声音会在这里变成文字。\n还没有模型？点击「体验演示样例」，先感受一次完整流程。" maxlength="20000"${disabled(working)}>${escape(state.text)}</textarea>
      <div class="editor-footer"><span>${state.resultSource === 'demo' ? '演示文字，不是实际语音识别结果；不会自动粘贴。' : '自动粘贴不发送回车。手动编辑、润色不会再次粘贴；需要时点击复制。'}</span><span id="character-count">${state.text.length.toLocaleString()} 字符</span></div></section>
    <div class="bottom-grid"><section class="recent-card"><div class="section-title"><h2>最近的表达</h2><button class="text-button muted" data-nav="history">全部历史 ${icon('arrow')}</button></div>${history.length ? `<div class="recent-list">${history.slice(0, 2).map(record => `<button class="recent-item" data-action="load-history" data-id="${escape(record.id)}"><span class="recent-file">${icon('file')}</span><span class="recent-text"><strong>${escape(record.text.slice(0, 80)) || '空转写'}</strong><small>${dateTime(record.createdAt)}<span>·</span>${sourceLabels[record.source] || '转写'}<span>·</span>${formatTime(record.durationMs || 0)}</small></span>${icon('arrowUp')}</button>`).join('')}</div>` : `<div class="empty-recent">${icon('history')}<span>还没有转写记录。第一段灵感，从上面开始。</span></div>`}</section><section class="stats-card"><span class="small-label">A GROWING COLLECTION</span><div><strong>${minutes}<small>分钟</small></strong><strong>${words.toLocaleString()}<small>字符</small></strong></div><p>真实转写累计 · 不含演示样例</p></section></div>`;
}

function pipelineStep(number, symbol, title, value, detail) {
  return `<div class="pipeline-step"><div class="pipeline-icon">${icon(symbol)}</div><div><span class="pipeline-title">${title}<small>${number}</small></span><strong>${escape(value)}</strong><span class="pipeline-detail">${escape(detail)}</span></div></div>`;
}

function pageHeading(kicker, title, description, action = '') {
  return `<section class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="page-description">${description}</p></div>${action}</section>${banner()}`;
}

function recommendation(model) {
  const level = model.recommendation?.level || 'unknown';
  return `<span class="badge ${level === 'recommended' ? 'green' : level === 'avoid' ? 'red' : level === 'caution' ? 'amber' : 'neutral'}">${icon(level === 'recommended' ? 'check' : level === 'avoid' ? 'alert' : 'info')}${{ recommended: '配置适合', caution: '谨慎选择', avoid: '暂不建议', unknown: '待检测设备' }[level]}</span>`;
}

function renderModels() {
  const filtered = state.snapshot.models.filter(model => state.modelFilter === 'all' || model.task === state.modelFilter);
  return `${pageHeading('A MODEL FOR EVERY MOMENT', '小模型，大有分工。', '语音检测、语音转写、文字润色，独立选择与配置。', '<button class="button secondary" data-action="open-models">' + icon('folder') + '打开模型目录</button>')}
    <div class="message calm">${icon('shield')}<div><strong>模型与缓存，都留在项目目录。</strong><p>使用项目准备脚本或手动放置模型文件。这里展示实际文件状态与设备建议；选择模型不会触发下载。</p></div><span class="badge green">项目内准备</span></div>
    <div class="filter-row"><div class="segmented" role="group" aria-label="按模型功能筛选">${[['all', '全部模型'], ['asr', '语音转写'], ['vad', '语音检测'], ['polish', '文字润色']].map(([id, label]) => `<button data-action="filter-models" data-filter="${id}" class="${state.modelFilter === id ? 'active' : ''}" aria-pressed="${state.modelFilter === id}">${label}</button>`).join('')}</div><span class="muted-text">${filtered.length} 个可选模型 · 体积为估算</span></div>
    <div class="model-grid">${filtered.map(model => {
      const active = state.snapshot.settings[model.task].modelId === model.id;
      return `<article class="model-card ${active ? 'selected-model' : ''}"><div class="model-card-head"><div class="model-symbol ${model.task}">${icon(model.task === 'asr' ? 'wave' : model.task === 'vad' ? 'shield' : 'sparkle')}</div>${recommendation(model)}</div><span class="small-label model-family">${escape(model.family)} / ${taskLabels[model.task]}</span><h2>${escape(model.name)}</h2><p class="model-description">${escape(model.description)}</p><div class="model-specs"><span>文件体积<strong>${formatSize(model.sizeMB)}</strong></span><span>建议内存<strong>${model.recommendedRamGB} GB</strong></span><span>显存参考<strong>${model.minVramGB ? `${model.minVramGB} GB` : '可用 CPU'}</strong></span></div><p class="model-reason">${icon('info')}${escape(model.recommendation?.reason || '检测设备后可查看建议。')}</p><div class="model-file-status"><span class="status-dot ${model.installed ? 'available' : 'missing'}"></span>${model.installed ? '发现文件 · 运行能力尚未验证' : '未发现文件 · 待准备'}</div><code class="model-path" title="${escape(model.relativePath)}">${escape(model.relativePath)}</code><button class="button ${active ? 'selected-button' : 'secondary'} model-select" data-action="select-model" data-id="${escape(model.id)}"${disabled(blocked() || active)}>${icon(active ? 'check' : 'arrow')}${active ? '已选为此步骤的模型' : '选择此模型'}</button></article>`;
    }).join('')}</div><div class="footnote">${icon('info')}设备建议是保守估算，不代表运行速度。选择模型不会下载文件或启动外部服务。whisper.cpp 与文字润色使用你已运行的本地服务，实际加载路径也需设在本项目内。</div>`;
}

function renderDevice() {
  const hardware = state.snapshot.hardware;
  const heading = pageHeading('KNOW YOUR MACHINE', '让模型，适合你的电脑。', '读取实际硬件信息，留出日常使用的余量，再选择模型。', `<button class="button primary" data-action="scan"${disabled(blocked())}>${icon('refresh', state.busy === '正在检测设备…' ? 'spinning' : '')}${state.busy === '正在检测设备…' ? '正在检测…' : '重新检测设备'}</button>`);
  if (!hardware) return `${heading}<section class="empty-panel">${icon('chip')}<h2>先认识一下你的设备</h2><p>读取 CPU、内存、显卡与项目磁盘可用空间。<br />检测结果只用于本地模型建议。</p><button class="button primary" data-action="scan"${disabled(blocked())}>${icon('refresh')}开始检测</button></section>${storageCard()}`;
  const gpus = hardware.gpus || [];
  const hasVram = gpu => Number.isFinite(gpu.vramGB) && gpu.vramGB > 0;
  const primaryGpu = gpus.find(gpu => /nvidia/i.test(gpu.name) && hasVram(gpu)) || gpus.find(hasVram) || gpus[0];
  const otherGpus = gpus.filter(gpu => gpu !== primaryGpu);
  const vramLabel = gpu => gpu?.vramGB == null ? '显存容量未知' : `${gpu.vramGB} GB 显存`;
  const specs = [
    ['chip', '处理器', hardware.cpu?.name || '未能识别', `${hardware.cpu?.cores || '未知'} 个逻辑核心`],
    ['memory', '系统内存', `${hardware.memory?.totalGB ?? '未知'} GB`, `当前可用 ${hardware.memory?.freeGB ?? '未知'} GB`],
    ['monitor', '显卡', primaryGpu?.name || '未能识别', primaryGpu ? vramLabel(primaryGpu) : '可选择 CPU 推理'],
    ['disk', '项目所在磁盘', hardware.disk?.freeGB == null ? '可用空间未知' : `${hardware.disk.freeGB} GB`, '模型与缓存共用此磁盘'],
  ];
  return `${heading}<div class="device-meta"><span>${icon('monitor')}${escape(hardware.os || 'Windows')}</span><span>检测时间 ${dateTime(hardware.detectedAt)}</span></div><div class="hardware-grid">${specs.map(([symbol, label, value, detail]) => `<section class="hardware-card"><span class="hardware-icon">${icon(symbol)}</span><span class="small-label">${label}</span><h2>${escape(value)}</h2><p>${escape(detail)}</p>${symbol === 'monitor' && otherGpus.length ? `<div class="gpu-other-list"><span>其他显示设备</span>${otherGpus.map(gpu => `<div><strong>${escape(gpu.name)}</strong><small>${escape(vramLabel(gpu))}</small></div>`).join('')}</div>` : ''}</section>`).join('')}</div>
    ${hardware.warnings?.length ? `<div class="message warning">${icon('alert')}<div><strong>部分检测信息需要留意</strong><p>${hardware.warnings.map(escape).join('<br />')}</p></div></div>` : ''}
    <section class="recommendations-card"><div class="section-title"><h2>这台电脑的模型建议</h2><span class="badge neutral">保守估算</span></div><p class="section-caption">为 Windows 和其他应用预留内存；CUDA 与运行环境仍需单独验证。</p><div class="recommendation-table"><div class="recommendation-row table-head"><span>模型</span><span>功能</span><span>建议</span><span>判断依据</span></div>${state.snapshot.models.map(model => `<div class="recommendation-row"><strong>${escape(model.name)}</strong><span>${taskLabels[model.task]}</span><span>${recommendation(model)}</span><span>${escape(model.recommendation?.reason || '信息不足')}</span></div>`).join('')}</div></section>${storageCard()}`;
}

function storageCard() {
  return `<section class="storage-card"><div class="storage-icon">${icon('folder')}</div><div><h2>模型的家，就在项目里。</h2><p>固定项目根目录，所有模型与缓存均保存在这里。</p><code>${escape(state.snapshot.paths.root)}</code><div class="storage-locations"><span>models / 模型文件</span><span>cache / 推理缓存</span><span>data / 配置与历史</span></div></div><button class="button secondary" data-action="open-root">打开项目目录 ${icon('arrowUp')}</button></section>`;
}

const monitorStageNames = { preparing: '准备', recording: '录音', audio: '音频校验', vad: '语音检测', asr: '转写', polish: '润色', delivery: '交付' };
const monitorStatusNames = { running: '进行中', success: '已完成', warning: '完成有提示', failed: '失败', skipped: '已跳过', canceled: '已取消', interrupted: '已中断' };
const monitorErrorReasons = {
  MODEL_MISSING: '本地模型文件尚未准备完整，请检查项目模型目录。', MODEL_INVALID: '模型选择或模型文件不适用于当前功能。',
  RUNTIME_MISSING: '本地 Python 或推理依赖不可用，请检查运行环境。', RUNTIME_RESPONSE: '本地运行时没有返回有效结果，请检查依赖与模型文件。',
  LOCAL_INFERENCE: '本地推理失败，请检查模型格式、可用内存和 CPU / CUDA 环境。', PATH_UNSAFE: '模型或缓存路径超出项目目录，已停止加载。', REQUEST_INVALID: '本地运行时拒绝了无效请求，请重新开始录音。',
  API_KEY_REQUIRED: '尚未保存此功能的 API 密钥，请到偏好设置中配置。', API_KEY_INVALID: 'API 密钥格式无效，请检查后重新保存。',
  PROVIDER_CONNECTION: '无法连接模型服务，请检查地址、服务状态和网络。', PROVIDER_TIMEOUT: '模型处理超时，可稍后重试或选择更小的模型。',
  PROVIDER_HTTP: '服务返回错误状态，请检查 API 配置和服务状态。', PROVIDER_RESPONSE: '服务响应无效，请检查 API 是否兼容。',
  PROVIDER_INVALID: '推理服务配置不受支持，请重新选择引擎。', PROVIDER_REDIRECT: '服务要求跳转，已停止请求；请配置最终服务地址。',
  AUDIO_SHORT: '录音过短，请说完一句话后再结束。', AUDIO_TOO_SHORT: '录音不足 0.3 秒，请稍后再结束录音。', AUDIO_SILENT: '没有检测到有效声音，请检查麦克风或语音检测阈值。',
  AUDIO_EMPTY: '没有收到音频样本，请检查麦克风。', AUDIO_INVALID: '录音数据无效，请重新录制。', AUDIO_FORMAT: '录音格式不符合要求，请重新录制。',
  AUDIO_DURATION: '录音样本与时长不一致，请重新录制。', AUDIO_TOO_LONG: '录音超过两分钟，请分段录制。', AUDIO_TOO_LARGE: '音频数据过大，请缩短录音。',
  NO_TRANSCRIPT: '模型没有返回文字，请确认录音中包含清晰语音。', MICROPHONE_UNAVAILABLE: '麦克风不可用或权限被拒绝，请检查设备与 Windows 隐私设置。',
  DELIVERY_SKIPPED: '未满足自动粘贴条件；请检查原输入框焦点，必要时手动复制。', DELIVERY_FAILED: '剪贴板或粘贴操作未完成，请在工作台手动复制。',
  INTERRUPTED: '应用或录音会话已中断，此任务没有正常完成。', RENDERER_INTERRUPTED: '录音界面已关闭或重新加载，任务已中断。', CANCELED: '操作已取消，没有继续转写或粘贴。',
  HELPER_UNAVAILABLE: 'Windows 粘贴组件不可用，可改用手动复制。', HELPER_TIMEOUT: 'Windows 粘贴组件响应超时，可改用手动复制。',
  SHORTCUT_BUSY: '快捷键被其他应用占用，请设置其他组合。', INVALID_SESSION: '录音会话已失效，请重新开始。', BUSY: '上一项任务仍在处理中，请稍候。',
  ENDPOINT_INVALID: '服务地址格式无效，请检查偏好设置。', INVALID_ENDPOINT: '服务地址不符合当前模式，请检查偏好设置。',
  HTTPS_REQUIRED: '云端服务必须使用 HTTPS 地址。', LOCAL_ENDPOINT_REQUIRED: '本地服务必须使用本机回环地址。',
  TEXT_EMPTY: '没有可润色的文字。', TEXT_TOO_LONG: '文字超出单次润色长度，请分段处理。',
};
const monitorErrorReason = code => Object.hasOwn(monitorErrorReasons, code) ? monitorErrorReasons[code] : '此步骤未完成，请检查功能配置后重试。';
function monitoringErrorLine(code, label) {
  return `<div class="task-error-code">${icon('info')}<span><strong>${escape(label)}</strong>${escape(monitorErrorReason(code))}</span><code>${escape(code || 'UNKNOWN_ERROR')}</code></div>`;
}
const metricNames = { cpu: '系统 CPU', memory: '系统内存', app: '应用内存', gpu: 'GPU 使用率' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const displayNumber = (value, digits = 1) => finite(value) ? value.toFixed(digits) : '—';
const elapsedLabel = ms => !finite(ms) ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.floor(ms % 60000 / 1000)} s`;
function sampleClock(value) {
  const date = new Date(value);
  return !value || Number.isNaN(date.valueOf()) ? '尚未采样' : date.toLocaleTimeString('zh-CN', { hour12: false });
}
function monitoringValue(sample, metric, gpuName) {
  if (!sample) return null;
  if (metric === 'cpu') return finite(sample.cpuPercent) ? sample.cpuPercent : null;
  if (metric === 'memory') return finite(sample.memoryUsedGB) && finite(sample.memoryTotalGB) && sample.memoryTotalGB > 0 ? sample.memoryUsedGB / sample.memoryTotalGB * 100 : null;
  if (metric === 'app') return finite(sample.appMemoryMB) ? sample.appMemoryMB : null;
  const gpu = gpuName ? sample.gpus?.find(item => item.name === gpuName) : sample.gpus?.[0];
  return finite(gpu?.utilizationPercent) ? gpu.utilizationPercent : null;
}
function resourceTrend(values, maximum, compact = false) {
  if (!values.some(finite)) return `<div class="trend-empty ${compact ? 'compact' : ''}">${compact ? '暂无读数' : '等待有效读数；未知值不会用 0 补齐。'}</div>`;
  const width = compact ? 190 : 900;
  const height = compact ? 43 : 146;
  const top = compact ? 4 : 8;
  const bottom = height - top;
  const groups = [];
  let current = [];
  values.forEach((value, index) => {
    if (!finite(value)) { if (current.length) groups.push(current); current = []; return; }
    const x = values.length === 1 ? width / 2 : index / (values.length - 1) * width;
    const y = bottom - Math.min(maximum, Math.max(0, value)) / maximum * (bottom - top);
    current.push([x.toFixed(2), y.toFixed(2)]);
  });
  if (current.length) groups.push(current);
  return `<svg class="resource-trend ${compact ? 'compact' : ''}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${!compact ? [top, height / 2, bottom].map(y => `<line class="trend-gridline" x1="0" y1="${y}" x2="${width}" y2="${y}"/>`).join('') : ''}${groups.map(group => group.length === 1 ? `<circle cx="${group[0][0]}" cy="${group[0][1]}" r="${compact ? 2 : 3}" fill="currentColor"/>` : `<polyline points="${group.map(point => point.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="${compact ? 1.5 : 2}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
}
function monitoringHealth(monitor) {
  const health = monitor.health || [];
  if (!health.length) return '<p class="monitor-empty-inline">功能配置状态尚未提供。</p>';
  const names = { asr: ['语音转写', 'wave'], vad: ['语音检测', 'shield'], polish: ['文字润色', 'sparkle'], shortcut: ['全局快捷键', 'keyboard'], paste: ['自动粘贴', 'copy'] };
  const statuses = { configured: ['已配置', 'neutral'], missing: ['待准备', 'amber'], disabled: ['已关闭', 'neutral'], unavailable: ['不可用', 'amber'], ready: ['已就绪', 'green'] };
  return `<div class="health-grid">${health.map(item => { const [name, symbol] = names[item.id] || ['其他功能', 'info']; const [label, color] = statuses[item.state] || ['状态未知', 'neutral']; return `<article class="health-card"><div class="health-card-top"><span>${icon(symbol)}</span><span class="badge ${color}">${label}</span></div><h3>${name}</h3><p>${escape(item.detail || '暂无状态说明。')}</p></article>`; }).join('')}</div>`;
}
function monitoringTasks(monitor) {
  const tasks = (monitor.tasks || []).slice(0, 100).filter(task => state.taskFilter === 'all' || state.taskFilter === 'running' && task.status === 'running' || state.taskFilter === 'issues' && ['failed', 'warning', 'interrupted'].includes(task.status));
  if (!tasks.length) return `<div class="monitor-task-empty">${icon('activity')}<strong>${state.taskFilter === 'all' ? '下一次表达，会在这里留下运行轨迹。' : '当前筛选下没有任务。'}</strong><p>仅记录阶段、耗时和错误码，不记录语音、转写文字或目标窗口。</p></div>`;
  return `<div class="monitor-tasks">${tasks.map(task => {
    const expanded = state.expandedTask === task.id;
    const route = { local: '本地', cloud: '云端', demo: '演示' }[task.route] || '未知路线';
    const trigger = { button: '按钮启动', shortcut: '快捷键启动', manual: '手动启动' }[task.trigger] || '未知入口';
    const status = monitorStatusNames[task.status] || '状态未知';
    const stages = Array.isArray(task.stages) ? task.stages : [];
    const stageErrors = stages.filter(stage => stage.errorCode || stage.status === 'failed');
    const taskError = task.errorCode && !stageErrors.some(stage => stage.errorCode === task.errorCode) ? monitoringErrorLine(task.errorCode, '任务') : '';
    return `<article class="monitor-task ${expanded ? 'expanded' : ''}"><button class="monitor-task-head" data-action="toggle-monitor-task" data-id="${escape(task.id)}" aria-expanded="${expanded}"><span class="monitor-task-symbol status-${escape(task.status)}">${icon(task.kind === 'demo' ? 'play' : task.kind === 'polish' ? 'sparkle' : 'wave')}</span><span class="monitor-task-identity"><strong>${{ transcribe: '语音转写', polish: '文字润色', demo: '演示样例' }[task.kind] || '运行任务'}</strong><small>${dateTime(task.createdAt)} · ${route} · ${trigger}</small></span><span class="task-outcome status-${escape(task.status)}"><span></span>${status}</span><span class="monitor-task-duration">${elapsedLabel(task.durationMs)}</span><span class="task-expand-arrow">${icon('arrow')}</span></button>
      ${expanded ? `<div class="monitor-task-detail"><div class="stage-timeline">${Object.entries(monitorStageNames).map(([name, label]) => { const stage = stages.find(item => item.name === name); return `<div class="stage-tile ${stage ? `status-${escape(stage.status)}` : 'not-run'}"><span class="stage-indicator"></span><strong>${label}</strong><small>${stage ? monitorStatusNames[stage.status] || '未知' : '未运行'}</small><b>${stage ? elapsedLabel(stage.durationMs) : '—'}</b>${stage?.errorCode ? `<code>${escape(stage.errorCode)}</code>` : ''}</div>`; }).join('')}</div>${taskError}${stageErrors.map(stage => monitoringErrorLine(stage.errorCode, monitorStageNames[stage.name] || '阶段')).join('')}<p class="task-privacy-note">阶段耗时包含等待与处理时间；未启用的阶段显示「未运行」。</p></div>` : ''}</article>`;
  }).join('')}</div>`;
}
function renderMonitoring() {
  const monitor = state.monitor;
  const heading = pageHeading('A CLEAR VIEW OF EVERY MOMENT', '每一次运行，都心中有数。', '资源实时看，阶段分开看。记录诊断信息，保留表达的隐私。', `<div class="button-group"><button class="button secondary" data-action="toggle-monitoring"${disabled(!monitor || Boolean(state.monitorAction))}>${icon(monitor?.paused ? 'play' : 'pause')}${monitor?.paused ? '恢复采样' : '暂停采样'}</button><button class="button primary" data-action="refresh-monitoring"${disabled(Boolean(state.monitorAction))}>${icon('refresh', state.monitorAction === 'refresh' ? 'spinning' : '')}${state.monitorAction === 'refresh' ? '正在采样…' : '立即采样'}</button></div>`);
  if (!monitor) return `${heading}<section class="empty-panel">${icon('activity')}<h2>运行监控正在准备中</h2><p>等待桌面服务提供第一份监控快照。<br />不会模拟资源占用，也不会自动连接模型服务。</p><button class="button secondary" data-action="load-monitoring"${disabled(Boolean(state.monitorAction))}>${icon('refresh')}重新读取</button></section>`;
  const samples = (monitor.samples || []).slice(-60);
  const latest = samples.at(-1);
  const primaryGpu = latest?.gpus?.find(gpu => finite(gpu.utilizationPercent) || finite(gpu.totalMB)) || latest?.gpus?.[0];
  const values = samples.map(sample => monitoringValue(sample, state.monitorMetric, primaryGpu?.name));
  const scale = state.monitorMetric === 'app' ? Math.max(128, Math.ceil(Math.max(0, ...values.filter(finite)) / 64) * 64) : 100;
  const unit = state.monitorMetric === 'app' ? 'MB' : '%';
  const resourceCards = [
    { key: 'cpu', icon: 'chip', label: '系统 CPU', value: displayNumber(latest?.cpuPercent), unit: '%', caption: '整机使用率 · 首个读数需等待' },
    { key: 'memory', icon: 'memory', label: '系统内存', value: displayNumber(latest?.memoryUsedGB), unit: 'GB', caption: finite(latest?.memoryTotalGB) ? `总计 ${displayNumber(latest.memoryTotalGB)} GB · 已用 ${displayNumber(monitoringValue(latest, 'memory'))}%` : '等待系统内存读数' },
    { key: 'app', icon: 'workspace', label: 'Murmur 应用内存', value: displayNumber(latest?.appMemoryMB, 0), unit: 'MB', caption: '应用进程工作集 · 估算' },
    { key: 'gpu', icon: 'monitor', label: 'GPU 使用率', value: displayNumber(primaryGpu?.utilizationPercent, 0), unit: '%', caption: primaryGpu?.name || '未取得 GPU 读数' },
  ];
  const counters = monitor.counters || {};
  return `${heading}<div class="monitor-meta"><span class="monitor-sampling ${monitor.paused ? 'paused' : ''}"><i></i>${monitor.paused ? '资源采样已暂停，任务记录继续' : `每 ${(monitor.intervalMs || 5000) / 1000} 秒采样 · 仅在本机处理`}</span><span>资源更新 ${sampleClock(monitor.sampledAt)}</span></div>
    ${(monitor.alerts || []).map(alert => `<div class="message ${alert.level === 'error' ? 'error' : alert.level === 'warning' ? 'warning' : 'calm'} monitor-alert">${icon(alert.level === 'error' || alert.level === 'warning' ? 'alert' : 'info')}<div><strong>${escape(alert.message || alert.code || '监控状态提示')}</strong>${alert.code ? `<p><code>${escape(alert.code)}</code></p>` : ''}</div></div>`).join('')}
    ${monitor.storage?.message ? `<div class="message ${monitor.storage.persisted ? 'calm' : 'warning'} monitor-alert">${icon(monitor.storage.persisted ? 'shield' : 'alert')}<div><strong>${monitor.storage.persisted ? '诊断记录保存在项目内' : '诊断记录存储需要留意'}</strong><p>${escape(monitor.storage.message)}</p></div></div>` : ''}
    <div class="monitor-resource-grid">${resourceCards.map(card => { const series = samples.map(sample => monitoringValue(sample, card.key, primaryGpu?.name)); const max = card.key === 'app' ? Math.max(1, ...series.filter(finite)) * 1.15 : 100; return `<button class="monitor-resource-card ${state.monitorMetric === card.key ? 'selected' : ''}" data-action="monitor-metric" data-metric="${card.key}" aria-pressed="${state.monitorMetric === card.key}"><span class="monitor-resource-label">${icon(card.icon)}${card.label}</span><span class="monitor-resource-value">${card.value}<small>${card.value === '—' ? '未知' : card.unit}</small></span><span class="monitor-resource-caption">${escape(card.caption)}</span>${resourceTrend(series, max, true)}</button>`; }).join('')}</div>
    <section class="monitor-trend-card"><div class="section-title"><div><h2>${metricNames[state.monitorMetric]}趋势</h2><p class="section-caption">最近 ${samples.length} / 60 个采样 · 最多约 5 分钟</p></div><span class="badge ${monitor.paused ? 'amber' : 'green'}">${monitor.paused ? '已暂停' : '实时采样'}</span></div><div class="monitor-chart" role="img" aria-label="${metricNames[state.monitorMetric]}最近 ${samples.length} 个采样趋势；最新读数 ${displayNumber(values.at(-1))} ${unit}"><div class="monitor-chart-axis"><span>${scale} ${unit}</span><span>${scale / 2}</span><span>0</span></div><div class="monitor-chart-plot">${resourceTrend(values, scale)}</div></div><div class="monitor-chart-times"><span>${sampleClock(samples[0]?.at)}</span><span>${sampleClock(latest?.at)}</span></div><div class="monitor-chart-note">${icon('info')}应用内存不含外部 Python 或模型服务；工作集求和可能重复计算共享页。GPU 最多每 15 秒更新，未知值保持为空。</div>
      ${latest?.gpus?.length ? `<div class="monitor-gpu-list">${latest.gpus.map(gpu => `<div><span>${icon('monitor')}<strong>${escape(gpu.name)}</strong></span><span>使用率 ${displayNumber(gpu.utilizationPercent, 0)}% · 显存 ${displayNumber(gpu.usedMB, 0)} / ${displayNumber(gpu.totalMB, 0)} MB</span></div>`).join('')}<small>GPU 更新 ${sampleClock(latest.gpuSampledAt)}</small></div>` : ''}</section>
    <section class="monitor-health-section"><div class="section-title"><div><h2>功能配置状态</h2><p class="section-caption">配置完成不代表服务已连接；此处不会发送后台探测请求。</p></div><button class="text-button" data-nav="settings">调整配置 ${icon('arrow')}</button></div>${monitoringHealth(monitor)}</section>
    <section class="monitor-task-section"><div class="section-title"><div><h2>任务运行记录</h2><p class="section-caption">最近 100 项 · 点击任务查看各阶段耗时</p></div><div class="monitor-counters"><span>完成 <strong>${finite(counters.completed) ? counters.completed : '—'}</strong></span><span>失败 <strong>${finite(counters.failed) ? counters.failed : '—'}</strong></span><span>取消 / 中断 <strong>${finite(counters.canceled) ? counters.canceled : '—'}</strong></span></div></div><div class="monitor-task-filter segmented" role="group" aria-label="筛选监控任务">${[['all', '全部任务'], ['running', '进行中'], ['issues', '异常与提示']].map(([filter, label]) => `<button data-action="monitor-task-filter" data-filter="${filter}" class="${state.taskFilter === filter ? 'active' : ''}" aria-pressed="${state.taskFilter === filter}">${label}</button>`).join('')}</div>${monitoringTasks(monitor)}</section><div class="footnote">${icon('shield')}监控不记录转写内容、API 密钥或目标窗口，不上传遥测。暂停仅影响资源采样，任务阶段仍会记录。</div>`;
}

function renderHistory() {
  const history = state.snapshot.history;
  const filtered = history.filter(record => `${record.text} ${record.model}`.toLowerCase().includes(state.historySearch.toLowerCase()));
  return `${pageHeading('WORDS WORTH KEEPING', '把表达，留在手边。', '这里保存文字，不保存录音。最多保留最近 200 条。', `<div class="button-group"><button class="button secondary" data-action="export-txt"${disabled(!history.length || blocked())}>${icon('download')}导出 TXT</button><button class="button secondary" data-action="export-json"${disabled(!history.length || blocked())}>JSON</button></div>`)}
    <div class="history-toolbar"><label class="search-field">${icon('search')}<input id="history-search" type="search" placeholder="搜索转写内容或模型…" value="${escape(state.historySearch)}" aria-label="搜索转写历史" /></label><span class="muted-text">共 ${history.length} 条记录</span><button class="text-button destructive" data-action="clear-history"${disabled(!history.length || blocked())}>${icon('trash')}清空历史</button></div>
    <div id="history-results">${historyResults(filtered)}</div>`;
}

function historyResults(records) {
  return records.length ? `<div class="history-list">${records.map(record => `<article class="history-card"><div class="history-card-header"><div><span class="badge ${record.source === 'demo' ? 'amber' : 'neutral'}">${sourceLabels[record.source] || '转写'}</span><span>${dateTime(record.createdAt)}</span><span>${formatTime(record.durationMs || 0)}</span></div><div><button class="icon-button" data-action="copy-history" data-id="${escape(record.id)}" title="复制这条记录" aria-label="复制这条记录">${icon('copy')}</button><button class="icon-button destructive" data-action="delete-history" data-id="${escape(record.id)}" title="删除这条记录" aria-label="删除这条记录"${disabled(blocked())}>${icon('trash')}</button></div></div><p>${escape(record.text)}</p>${record.warnings?.length ? `<div class="history-warning">${icon('info')}${record.warnings.map(escape).join('；')}</div>` : ''}${deliveryNote(record.delivery || { status: 'not-requested', reason: '旧记录未保存交付状态。' }, record.source)}<div class="history-card-footer"><span>${escape(record.model)} · ${record.text.length} 字符${record.source === 'demo' ? ' · 非真实识别' : ''}</span><button class="text-button" data-action="load-history" data-id="${escape(record.id)}">在工作台编辑 ${icon('arrow')}</button></div></article>`).join('')}</div>` : `<section class="empty-panel">${icon('history')}<h2>${state.historySearch ? '没有找到匹配的表达' : '这里，等待你的第一段表达。'}</h2><p>${state.historySearch ? '试试更短的关键词，或者换一个模型名称。' : '录一段想法，或体验一次演示。<br />之后可以在这里回看、复制和导出。'}</p>${state.historySearch ? '' : '<button class="button primary" data-nav="workbench">前往工作台 ' + icon('arrow') + '</button>'}</section>`;
}

function field(label, control, hint = '', className = '') { return `<label class="form-field ${className}"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`; }
function input(name, value, placeholder = '', type = 'text', extra = '') { return `<input name="${name}" type="${type}" value="${escape(value)}" placeholder="${escape(placeholder)}" ${extra} />`; }
function select(name, value, options) { return `<select name="${name}">${options.map(([key, label]) => `<option value="${escape(key)}"${selected(key, value)}>${escape(label)}</option>`).join('')}</select>`; }
function modelSelect(task, value) { return select(`${task}.modelId`, value, state.snapshot.models.filter(model => model.task === task).map(model => [model.id, `${model.name} · ${formatSize(model.sizeMB)}`])); }
function speechProviders() { return state.snapshot.speechProviders || []; }
function speechProvider(id) { return speechProviders().find(provider => provider.id === id); }
function normalizeEndpoint(value) { return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''; }
function hasAsrKey(asr = (state.draft || state.snapshot.settings).asr) {
  const bindings = state.snapshot.settings.asr.keyEndpoints || {};
  const provider = asr.provider || 'custom';
  const endpoint = normalizeEndpoint(asr.endpoint);
  return Boolean(endpoint && Object.hasOwn(bindings, provider) && bindings[provider] === endpoint);
}
function asrKeyStatus() {
  return state.clearKeys.asr ? '保存后清除此服务商的密钥' : state.keys.asr ? '密钥待保存 · 尚未实际验证' : hasAsrKey() ? '已配置，尚未实际验证' : '待填写密钥';
}
function asrKeyContents() {
  const asr = (state.draft || state.snapshot.settings).asr;
  const hasKey = hasAsrKey(asr);
  const otherAddress = !hasKey && state.snapshot.settings.asr.keyEndpoints?.[asr.provider || 'custom'];
  return `${field('语音 API 密钥', input('key.asr', state.keys.asr || '', hasKey ? '已安全保存；留空保留当前地址的密钥' : '可稍后填写 API Key', 'password', 'autocomplete="off" spellcheck="false"'), otherAddress ? '此服务商已保存其他地址的密钥，当前地址不会使用它。' : hasKey ? '已有匹配此服务商和地址的加密密钥，不会回显。' : '可以先保存配置，转写前再填写。密钥由 Windows 加密保存。')}<label class="checkbox-row"><input name="clearKey.asr" type="checkbox"${checked(state.clearKeys.asr)} /><span>保存后删除此服务商已存的密钥</span></label>`;
}
function updateAsrKeyDisplay({ bindingChanged = false } = {}) {
  const status = document.querySelector('#asr-key-status');
  if (status) status.textContent = asrKeyStatus();
  const fields = document.querySelector('#asr-key-fields');
  if (bindingChanged && fields) fields.innerHTML = asrKeyContents();
}
function clearAsrKeyDraft() {
  const hadDraft = Boolean(state.keys.asr || state.clearKeys.asr);
  delete state.keys.asr;
  delete state.clearKeys.asr;
  if (hadDraft) toast('服务商或地址已改变，未保存的语音密钥和删除选项已清空。', 'info');
}
function keyField(task, label) {
  if (task === 'asr') return `<div id="asr-key-fields" class="key-fields">${asrKeyContents()}</div>`;
  const hasKey = state.snapshot.settings[task].hasKey;
  return `<div class="key-fields">${field(label, input(`key.${task}`, state.keys[task] || '', hasKey ? '已安全保存；留空保留原密钥' : '输入 API Key', 'password', 'autocomplete="off" spellcheck="false"'), hasKey ? '已有加密密钥，应用不会回显。' : '保存时由 Windows 加密，不写入转写历史。')}<label class="checkbox-row"><input name="clearKey.${task}" type="checkbox"${checked(state.clearKeys[task])} /><span>删除已保存的密钥</span></label></div>`;
}
function renderCloudAsr(asr) {
  const provider = speechProvider(asr.provider || 'custom');
  const preset = provider && provider.id !== 'custom';
  const endpointControl = preset ? select('asr.endpoint', asr.endpoint, provider.endpoints.map(endpoint => [endpoint.value, endpoint.label])) : input('asr.endpoint', asr.endpoint, 'https://your-service.example/v1', 'url', 'spellcheck="false"');
  return `<div class="provider-note full-width"><div class="provider-note-heading"><span class="provider-symbol">${icon('cloud')}</span><div><span class="small-label">SPEECH API</span><strong>${escape(provider?.name || '自定义兼容服务')}</strong></div><span id="asr-key-status" class="badge neutral" role="status">${escape(asrKeyStatus())}</span></div><p>${escape(provider?.notes || '填写兼容 OpenAI 文件转写协议的 HTTPS 地址、模型名称和密钥。')}</p><div class="provider-links">${provider?.docsUrl ? `<button type="button" class="text-button" data-action="provider-docs" data-provider="${escape(provider.id)}">${provider.id === 'custom' ? '兼容协议文档' : '官方接入文档'} ${icon('arrowUp')}</button>` : ''}${provider?.keyUrl ? `<button type="button" class="text-button" data-action="provider-key" data-provider="${escape(provider.id)}">获取 API 密钥 ${icon('arrowUp')}</button>` : ''}</div></div>
    ${field(preset ? '官方接入地域 / 地址' : '服务地址', endpointControl, preset ? `<code class="provider-endpoint">${escape(asr.endpoint)}</code>` : '必须使用 HTTPS。录音会发送至所填地址；请确认服务商与你的密钥对应。', 'full-width')}
    ${field('API 模型名称', input('asr.apiModel', asr.apiModel, provider?.defaultModel || 'whisper-1', 'text', 'list="speech-model-suggestions" spellcheck="false"') + `<datalist id="speech-model-suggestions">${(provider?.models || []).map(model => `<option value="${escape(model)}"></option>`).join('')}</datalist>`, '可选择建议或填写账户支持的模型标识。建议不代表该账户已开通。')}
    ${keyField('asr', '语音 API 密钥')}<p class="provider-key-guidance full-width">${icon('shield')}密钥仅用于对应服务商和地址。切换服务商或地址会清空未保存的语音密钥；已保存的其他服务商密钥保留。保存配置不会发起验证或计费请求。</p>`;
}

function applySettingsInput(target) {
  if (!state.draft) state.draft = clone(state.snapshot.settings);
  const [section, key] = target.name.split('.');
  const previousProvider = state.draft.asr.provider || 'custom';
  const previousEndpoint = normalizeEndpoint(state.draft.asr.endpoint);
  if (section === 'key') state.keys[key] = target.value;
  else if (section === 'clearKey') state.clearKeys[key] = target.checked;
  else state.draft[section][key] = target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value;
  if (target.name === 'asr.provider' && previousProvider !== target.value) {
    const provider = speechProvider(target.value);
    if (provider) { state.draft.asr.endpoint = provider.defaultEndpoint; state.draft.asr.apiModel = provider.defaultModel; }
  }
  const bindingChanged = previousProvider !== (state.draft.asr.provider || 'custom') || previousEndpoint !== normalizeEndpoint(state.draft.asr.endpoint);
  if (bindingChanged) clearAsrKeyDraft();
  if (bindingChanged || target.name === 'key.asr' || target.name === 'clearKey.asr') updateAsrKeyDisplay({ bindingChanged });
  state.dirty = true;
}

function shortcutKeycaps(value) { return formatShortcut(value).split(' + ').map(part => `<kbd>${escape(part)}</kbd>`).join('<span class="shortcut-plus">+</span>'); }
function shortcutEditor(settings) {
  const capture = state.shortcutCapture;
  const message = capture?.phase === 'acquiring' ? '正在暂停全局快捷键…' : capture?.phase === 'releasing' ? '正在恢复快捷键监听…' : capture?.preview || '按下并松开快捷键';
  return `<div class="shortcut-editor full-width ${capture ? 'capturing' : ''}"><span class="shortcut-field-label">全局录音快捷键</span><div class="shortcut-editor-row"><div id="shortcut-display" class="shortcut-display" tabindex="0" role="textbox" aria-readonly="true" aria-label="当前录音快捷键">${capture ? `<span class="shortcut-capture-preview">${escape(message)}</span>` : shortcutKeycaps(settings.general.shortcut)}</div><button type="button" class="button secondary" data-action="begin-shortcut-capture"${disabled(blocked() || Boolean(capture))}>${icon('keyboard')}录制快捷键</button>${capture ? `<button type="button" class="text-button" data-action="cancel-shortcut-capture"${disabled(capture.phase === 'releasing')}>取消</button>` : ''}<button type="button" class="text-button shortcut-reset" data-action="reset-shortcut"${disabled(blocked())}>恢复默认</button></div><p id="shortcut-capture-help" class="shortcut-capture-help ${capture?.message ? 'invalid' : ''}" aria-live="polite">${escape(capture?.message || (capture ? '等待按键期间不会启动录音。Esc、切换窗口或离开此页会取消；最长 30 秒。' : '默认：右 Alt。按一下开始录音，再按一下结束；录入后点击「保存配置」生效。'))}</p><small>支持单独右 Alt、F1–F24（F12 除外），以及 Ctrl / Alt / Shift / Win 加一个按键。组合不区分左右修饰键；独立 Fn 无法录入。</small></div>`;
}
function updateShortcutCaptureDisplay() {
  const capture = state.shortcutCapture;
  if (!capture || state.page !== 'settings') return;
  const display = document.querySelector('#shortcut-display');
  const help = document.querySelector('#shortcut-capture-help');
  if (display) display.innerHTML = `<span class="shortcut-capture-preview">${escape(capture.phase === 'acquiring' ? '正在暂停全局快捷键…' : capture.phase === 'releasing' ? '正在恢复快捷键监听…' : capture.preview || '按下并松开快捷键')}</span>`;
  if (help) { help.textContent = capture.message || '等待按键期间不会启动录音。Esc、切换窗口或离开此页会取消；最长 30 秒。'; help.classList.toggle('invalid', Boolean(capture.message)); }
}
function setShortcutDraft(value) {
  if (!state.draft) state.draft = clone(state.snapshot.settings);
  state.draft.general.shortcut = value;
  state.dirty = true;
}
async function releaseShortcutCapture(capture) {
  if (capture.releasePromise) return capture.releasePromise;
  capture.phase = 'releasing';
  clearTimeout(capture.timer);
  capture.engine.reset();
  updateShortcutCaptureDisplay();
  // Acquisition can still be waiting for the main process to stop its listener.
  // Its continuation will release the eventual token before resolving done.
  if (!capture.token) return capture.done;
  capture.releasePromise = (async () => {
    try {
      const snapshot = await call('endShortcutCapture', { token: capture.token });
      updateSnapshot(snapshot);
      if (capture.candidate && state.page === 'settings') { setShortcutDraft(capture.candidate); toast('快捷键已录入草稿，保存配置后生效。'); }
      else if (capture.notice) toast(capture.notice, 'info');
    } catch (error) { state.error = error.message; toast(error.message, 'error'); }
    finally {
      if (state.shortcutCapture === capture) state.shortcutCapture = null;
      capture.resolveDone();
      if (state.page === 'settings') render();
    }
  })();
  return capture.releasePromise;
}
async function cancelShortcutCapture(notice = '') {
  const capture = state.shortcutCapture;
  if (!capture) return;
  capture.candidate = null;
  capture.notice = notice;
  capture.canceled = true;
  return releaseShortcutCapture(capture);
}
async function beginShortcutCapture() {
  if (blocked() || state.shortcutCapture || state.page !== 'settings') return;
  const capture = { phase: 'acquiring', token: null, preview: '', message: '', candidate: null, canceled: false, engine: createShortcutCaptureState() };
  capture.done = new Promise(resolve => { capture.resolveDone = resolve; });
  state.shortcutCapture = capture;
  render();
  try {
    const result = await call('beginShortcutCapture');
    capture.token = result.token;
    if (capture.canceled || state.shortcutCapture !== capture || state.page !== 'settings' || !document.hasFocus()) { await releaseShortcutCapture(capture); return; }
    capture.phase = 'active';
    capture.timer = setTimeout(() => { if (state.shortcutCapture === capture) cancelShortcutCapture('快捷键录制已超时，原草稿保持不变。'); }, 30000);
    updateShortcutCaptureDisplay();
    document.querySelector('#shortcut-display')?.focus({ preventScroll: true });
  } catch (error) {
    clearTimeout(capture.timer);
    if (capture.token) { capture.candidate = null; await releaseShortcutCapture(capture); }
    else { if (state.shortcutCapture === capture) state.shortcutCapture = null; capture.resolveDone(); }
    if (!capture.canceled) { state.error = error.message; toast(error.message, 'error'); }
    if (state.page === 'settings') render();
  }
}

function renderSettings() {
  const settings = state.draft || state.snapshot.settings;
  return `${pageHeading('MAKE IT YOURS', '每一步，都听你的。', '模型按功能独立配置。保存后，下次转写使用新配置。')}
    ${settings.general.autoPaste && !state.snapshot.runtime.autoPasteAvailable ? `<div class="message warning">${icon('info')}<div><strong>自动粘贴组件暂未就绪</strong><p>快捷键录音仍可使用，转写结果保留在剪贴板；请手动按 Ctrl + V。不会尝试切换窗口或发送回车。</p></div></div>` : ''}
    <form id="settings-form"><fieldset class="settings-fieldset"${disabled(blocked())}><section class="settings-card"><div class="settings-card-heading"><span class="stage-number">01</span><div><h2>语音检测 <span>Voice activity</span></h2><p>判断音频里是否有人声，避免把长时间静音送入转写。</p></div>${icon('shield')}</div><div class="form-grid">${field('检测方式', select('vad.mode', settings.vad.mode, [['energy', '内置能量检测 · 无需下载'], ['silero', 'Silero VAD · 本地模型'], ['off', '关闭语音检测']]))}${settings.vad.mode === 'silero' ? field('语音检测模型', modelSelect('vad', settings.vad.modelId), '通过项目准备脚本或手动将 ONNX 文件放入模型目录。') : field('能量阈值', input('vad.threshold', settings.vad.threshold, '0.015', 'number', 'min="0.001" max="0.2" step="0.001"'), '数值越低越敏感。默认 0.015；关闭检测时不生效。')}</div></section>
    <section class="settings-card"><div class="settings-card-heading"><span class="stage-number">02</span><div><h2>语音转写 <span>Speech to text</span></h2><p>连接项目内的小模型，或选择语音 API 服务商。</p></div>${icon('wave')}</div><div class="form-grid">${field('处理位置', select('asr.mode', settings.asr.mode, [['local', '本地 · 在自己的设备处理'], ['cloud', '云端 · 发送至配置的语音 API']]))}${settings.asr.mode === 'cloud' ? field('语音服务商', select('asr.provider', settings.asr.provider || 'custom', speechProviders().length ? speechProviders().map(provider => [provider.id, provider.name]) : [['custom', '自定义兼容服务']]), '选择后填入建议地址和模型；密钥可稍后补充。') : field('推理引擎', select('asr.engine', settings.asr.engine, [['faster-whisper', 'Faster Whisper · 项目内推理'], ['whisper-cpp', 'whisper.cpp · 已运行的本地服务']]))}
    ${settings.asr.mode === 'cloud' ? renderCloudAsr(settings.asr) : settings.asr.engine === 'faster-whisper' ? `${field('转写模型', modelSelect('asr', settings.asr.modelId), '通过项目准备脚本或手动将文件放入 models 目录。')}${field('计算设备', select('asr.device', settings.asr.device, [['cpu', 'CPU · 默认通用'], ['cuda', 'CUDA · 需 NVIDIA 运行环境']]), '硬件检测不等于 CUDA 已配置可用。')}${field('Python 可执行文件', input('asr.pythonPath', settings.asr.pythonPath, 'python'), '填写已准备好 faster-whisper 的 Python 路径；填 python 时优先使用项目 .venv。', 'full-width')}` : `${field('服务地址', input('asr.endpoint', settings.asr.endpoint, 'http://127.0.0.1:8080', 'url'), '只允许本机回环地址。先启动本地服务，且模型存储需指向本项目。', 'full-width')}<div class="field-note">whisper.cpp 使用服务端已加载的模型。模型库选择不会替服务切换模型。</div>${keyField('asr', '语音 API 密钥')}`}
    ${field('识别语言', select('asr.language', settings.asr.language, [['auto', '自动检测'], ['zh', '中文'], ['en', '英文']]))}</div></section>
    <section class="settings-card"><div class="settings-card-heading"><span class="stage-number">03</span><div><h2>文字润色 <span>Writing polish</span></h2><p>整理标点和表达；润色失败时保留原始转写。</p></div>${icon('sparkle')}</div><div class="form-grid">${field('润色方式', select('polish.mode', settings.polish.mode, [['off', '关闭 · 保留原始转写'], ['local', '本地 · 已运行的兼容服务'], ['cloud', '云端 · 兼容聊天 API']]))}${field('表达风格', select('polish.style', settings.polish.style, [['natural', '自然 · 保留说话习惯'], ['concise', '简洁 · 精炼重点'], ['formal', '正式 · 适合邮件与文档']]))}
    ${settings.polish.mode !== 'off' ? `${field('服务地址', input('polish.endpoint', settings.polish.endpoint, settings.polish.mode === 'local' ? 'http://127.0.0.1:8081/v1' : 'https://api.openai.com/v1', 'url'), settings.polish.mode === 'local' ? '只允许本机回环地址。使用你已运行的服务，模型文件也应放在本项目内。' : '云端必须使用 HTTPS；转写文字会发送至此地址。', 'full-width')}${field('API 模型名称', input('polish.apiModel', settings.polish.apiModel, 'qwen2.5-1.5b'), '须与服务实际提供的模型名称一致。')}${settings.polish.mode === 'local' ? field('计划使用的本地模型', modelSelect('polish', settings.polish.modelId), '用于模型规划，不会替外部服务下载或加载模型。') : ''}${keyField('polish', '润色 API 密钥')}` : '<p class="field-note full-width">润色已关闭，转写完成后直接保留识别文字。可随时开启，也可在工作台手动修改。</p>'}</div></section>
    <section class="settings-card"><div class="settings-card-heading"><span class="stage-number">04</span><div><h2>桌面与隐私 <span>Desktop preferences</span></h2><p>让轻声融入日常工作，数据始终有迹可循。</p></div>${icon('settings')}</div><div class="preference-row"><div><strong>快捷键录音后自动粘贴</strong><p>在其他应用的输入框中按快捷键开始、再按一次结束。转写后复制并粘贴到原输入框，不发送回车。</p><p>如果焦点已改变或目标不可用，仅保留剪贴板并显示原因。按钮录音和演示不会自动粘贴。</p></div><label class="switch"><input type="checkbox" name="general.autoPaste"${checked(settings.general.autoPaste)} aria-label="快捷键录音后自动粘贴" /><span></span></label></div><div class="preference-row"><div><strong>转写后自动复制</strong><p>完成后复制到剪贴板，可手动按 Ctrl + V；快捷键自动粘贴始终先复制，不受此开关影响。</p></div><label class="switch"><input type="checkbox" name="general.autoCopy"${checked(settings.general.autoCopy)} aria-label="转写后自动复制" /><span></span></label></div><div class="preference-row"><div><strong>保存转写历史</strong><p>仅保存文字、模型及粘贴结果，不保存录音或目标窗口信息。</p></div><label class="switch"><input type="checkbox" name="general.saveHistory"${checked(settings.general.saveHistory)} aria-label="保存转写历史" /><span></span></label></div><div class="form-grid desktop-fields">${shortcutEditor(settings)}</div><div class="project-path-row"><span>${icon('folder')}模型目录</span><code>${escape(state.snapshot.paths.models)}</code><button type="button" class="text-button" data-action="open-models">打开 ${icon('arrowUp')}</button></div><div class="settings-info">${icon('shield')}关闭窗口会隐藏到系统托盘；右键托盘图标可退出。模型通过项目准备脚本或手动放入项目目录。</div>${!state.snapshot.runtime.encryptionAvailable ? '<div class="message warning">' + icon('alert') + '<div><strong>系统加密当前不可用</strong><p>无法安全保存 API 密钥。请检查 Windows 用户环境。</p></div></div>' : ''}</section>
    <div class="save-bar"><span id="save-state">${icon(state.dirty ? 'info' : 'check')}${state.dirty ? '有尚未保存的修改' : '当前配置已载入'}</span><div><button type="button" class="button secondary" data-action="reset-draft"${disabled(!state.dirty || blocked())}>撤销修改</button><button class="button primary" type="submit"${disabled(blocked())}>${icon('check')}${state.busy === '正在保存配置…' ? '正在保存…' : '保存配置'}</button></div></div></fieldset></form>`;
}

function render() {
  if (!state.snapshot) return;
  const active = document.activeElement;
  const focusState = document.hasFocus() && active && main.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName) ? { id: active.id, name: active.name, action: active.dataset.action, itemId: active.dataset.id, metric: active.dataset.metric, filter: active.dataset.filter, start: active.selectionStart, end: active.selectionEnd, scroll: active.scrollTop } : null;
  const scrollTop = main.scrollTop;
  const [title, detail] = labels[state.page];
  document.querySelector('#breadcrumb').textContent = title;
  document.querySelector('#breadcrumb-detail').textContent = detail;
  document.querySelectorAll('[data-nav]').forEach(button => { button.classList.toggle('active', button.dataset.nav === state.page); if (button.closest('nav') || button.classList.contains('settings-nav')) button.setAttribute('aria-current', button.dataset.nav === state.page ? 'page' : 'false'); });
  main.innerHTML = ({ workbench: renderWorkbench, models: renderModels, device: renderDevice, monitor: renderMonitoring, history: renderHistory, settings: renderSettings })[state.page]();
  main.scrollTop = scrollTop;
  if (focusState) {
    const selector = focusState.action ? `[data-action="${CSS.escape(focusState.action)}"]${focusState.itemId ? `[data-id="${CSS.escape(focusState.itemId)}"]` : ''}${focusState.metric ? `[data-metric="${CSS.escape(focusState.metric)}"]` : ''}${focusState.filter ? `[data-filter="${CSS.escape(focusState.filter)}"]` : ''}` : focusState.name ? `[name="${CSS.escape(focusState.name)}"]` : null;
    const replacement = focusState.id ? document.getElementById(focusState.id) : selector ? main.querySelector(selector) : null;
    if (replacement && !replacement.disabled) { replacement.focus({ preventScroll: true }); if (focusState.start != null && replacement.setSelectionRange) replacement.setSelectionRange(focusState.start, focusState.end); replacement.scrollTop = focusState.scroll; }
  }
}

async function navigate(page) {
  if (!labels[page]) return;
  if (state.recording || state.starting) { toast('请先结束当前录音，再切换页面。', 'info'); return; }
  if (state.shortcutCapture) await cancelShortcutCapture();
  state.page = page;
  render();
  main.scrollTo({ top: 0, behavior: 'instant' });
  if (page === 'monitor' && !state.monitor && !state.monitorAction) updateMonitoring('load');
}

async function updateMonitoring(action) {
  if (state.monitorAction) return;
  state.error = '';
  state.monitorAction = action;
  if (state.page === 'monitor') render();
  try {
    const monitor = action === 'refresh' ? await call('refreshMonitoring') : action === 'toggle' ? await call('setMonitoring', { paused: !state.monitor?.paused }) : await call('getMonitoring');
    if (monitor?.schemaVersion === 1) state.monitor = monitor;
  } catch (error) { state.error = error.message; toast(error.message, 'error'); }
  finally { state.monitorAction = null; if (state.page === 'monitor') render(); }
}

const recorder = new MicrophoneRecorder({
  onLevel(level, seconds) {
    state.seconds = seconds;
    const clock = document.querySelector('#record-clock');
    if (clock) clock.textContent = formatTime(seconds * 1000);
    document.querySelectorAll('.wave-bar').forEach((bar, index) => { bar.style.height = `${Math.max(3, 4 + level * 38 * (.35 + .65 * Math.abs(Math.sin(index * .59 + seconds * 5))))}px`; });
  },
  onLimit() { toast('已达到 2 分钟上限，正在结束录音。', 'info'); toggleRecording(); },
});

async function acceptResult(result) {
  state.text = result.text || '';
  state.rawText = result.rawText || result.text || '';
  state.resultSource = result.record?.source || '';
  state.resultWarnings = result.warnings || [];
  state.delivery = result.record?.delivery || null;
  updateSnapshot(await call('getSnapshot'));
}

async function clearRecordingSession(sessionId = state.session?.sessionId, reason = 'canceled') {
  if (!sessionId) return;
  if (state.session?.sessionId === sessionId) state.session.cancelReason = reason;
  await call('cancelRecording', { sessionId, reason });
  if (state.session?.sessionId === sessionId) state.session = null;
}

async function cancelActiveRecording() {
  if (state.cancelRequested || state.busy || (!state.starting && !state.recording)) return;
  state.cancelRequested = true;
  recorder.dispose();
  state.recording = false;
  if (state.starting) { render(); return; }
  state.busy = '正在取消录音…';
  render();
  try { await clearRecordingSession(); toast('录音已取消，没有转写或粘贴。', 'info'); }
  catch (error) { state.error = error.message; toast(error.message, 'error'); }
  finally { state.cancelRequested = false; state.busy = null; state.seconds = 0; render(); }
}

async function toggleRecording({ trigger = 'button' } = {}) {
  if (!state.snapshot || state.busy || state.shortcutCapture) return;
  if (state.starting) { await cancelActiveRecording(); return; }
  if (state.recording) {
    const sessionId = state.session?.sessionId;
    let audio;
    try { audio = recorder.stop(); }
    catch (error) { recorder.dispose(); state.error = error.message; }
    state.recording = false;
    await runTask('正在把声音变成文字…', async () => {
      if (!audio || audio.durationMs < 300) {
        await clearRecordingSession(sessionId, audio ? 'short' : 'error');
        throw new Error(audio ? '这段录音太短。请至少说半秒钟后再结束。' : '录音未能完成，请重新开始。');
      }
      try {
        const result = await call('transcribe', { ...audio, sessionId });
        state.session = null;
        await acceptResult(result);
        const status = result.record?.delivery?.status;
        toast(status === 'pasted' ? '转写完成，已粘贴到原输入框；没有发送回车。' : status === 'copied' ? '转写完成，已复制到剪贴板。' : status === 'failed' || status === 'skipped' ? '转写完成，未自动粘贴。请查看交付提示。' : '转写完成，可以编辑文字了。', status === 'failed' || status === 'skipped' ? 'info' : 'success');
      } catch (error) {
        // The main process normally clears on completion. This also covers a
        // rejected request before inference or a renderer-side transport error.
        try { await clearRecordingSession(sessionId, 'error'); } catch { /* A stale session is retried before the next capture. */ }
        throw error;
      }
    });
    return;
  }
  state.page = 'workbench'; state.starting = true; state.cancelRequested = false; state.error = ''; state.seconds = 0; render();
  let startStep = 'session';
  try {
    if (state.session) await clearRecordingSession(state.session.sessionId, state.session.cancelReason || 'error');
    if (state.cancelRequested) return;
    const session = await call('beginRecording', { trigger: trigger === 'shortcut' ? 'shortcut' : 'button' });
    state.session = session;
    if (state.cancelRequested) { await clearRecordingSession(); return; }
    startStep = 'microphone';
    const started = await recorder.start();
    if (!started || state.cancelRequested) { recorder.dispose(); await clearRecordingSession(); return; }
    startStep = 'ready';
    await call('recordingReady', { sessionId: session.sessionId });
    if (state.cancelRequested) { recorder.dispose(); await clearRecordingSession(); return; }
    state.recording = true;
  } catch (error) {
    recorder.dispose();
    state.recording = false;
    try { await clearRecordingSession(state.session?.sessionId, state.cancelRequested ? 'canceled' : startStep === 'microphone' ? 'microphone' : 'error'); } catch { /* Retain the ID for cleanup before any later start. */ }
    if (!state.cancelRequested) { state.error = error.message; toast(error.message, 'error'); }
  } finally {
    if (state.cancelRequested) toast('录音已取消，没有转写或粘贴。', 'info');
    state.starting = false;
    state.cancelRequested = false;
    render();
  }
}

async function confirmDelete(title, description) {
  const dialog = document.querySelector('#confirm-dialog');
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-copy').textContent = description;
  dialog.returnValue = '';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}

async function saveSettings() {
  if (state.shortcutCapture) await cancelShortcutCapture();
  await runTask('正在保存配置…', async () => {
    const keys = {};
    for (const task of ['asr', 'polish']) { if (state.clearKeys[task]) keys[task] = ''; else if (state.keys[task]) keys[task] = state.keys[task]; }
    const snapshot = await call('saveSettings', { settings: state.draft || state.snapshot.settings, keys });
    state.dirty = false; state.draft = null; state.keys = {}; state.clearKeys = {};
    updateSnapshot(snapshot);
  }, { success: '配置已保存，下次转写将使用新设置。' });
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button, a.brand');
  if (!target || target.disabled) return;
  if (target.matches('a.brand')) { event.preventDefault(); navigate('workbench'); return; }
  if (target.dataset.nav) { navigate(target.dataset.nav); return; }
  if (target.dataset.window) { try { await call('windowAction', { action: target.dataset.window }); } catch (error) { toast(error.message, 'error'); } return; }
  const action = target.dataset.action;
  if (!action) return;
  // Action buttons inside the settings form must never submit the form.
  if (target.type !== 'submit' || target.dataset.action) event.preventDefault();
  try {
    if (action === 'record') return await toggleRecording();
    if (action === 'cancel-recording') return await cancelActiveRecording();
    if (action === 'begin-shortcut-capture') return await beginShortcutCapture();
    if (action === 'cancel-shortcut-capture') return await cancelShortcutCapture();
    if (action === 'reset-shortcut') { if (state.shortcutCapture) await cancelShortcutCapture(); setShortcutDraft('RightAlt'); render(); return; }
    if (action === 'load-monitoring') return await updateMonitoring('load');
    if (action === 'refresh-monitoring') return await updateMonitoring('refresh');
    if (action === 'toggle-monitoring') return await updateMonitoring('toggle');
    if (action === 'monitor-metric' && metricNames[target.dataset.metric]) { state.monitorMetric = target.dataset.metric; render(); return; }
    if (action === 'monitor-task-filter' && ['all', 'running', 'issues'].includes(target.dataset.filter)) { state.taskFilter = target.dataset.filter; render(); return; }
    if (action === 'toggle-monitor-task') { state.expandedTask = state.expandedTask === target.dataset.id ? null : target.dataset.id; render(); return; }
    if (action === 'dismiss-error') { state.error = ''; render(); return; }
    if (action === 'demo') return await runTask('正在准备演示样例…', async () => { await acceptResult(await call('demo')); toast('演示样例已生成；这不是实际语音识别。', 'info'); });
    if (action === 'copy') { await call('copyText', { text: state.text }); toast('已复制，按 Ctrl + V 即可粘贴。'); return; }
    if (action === 'polish') return await runTask('正在整理你的表达…', async () => { const result = await call('polishText', { text: state.text }); state.text = result.text; state.resultWarnings = result.warnings || []; toast(result.warnings?.length ? '已保留文字，请留意提示。' : '润色完成。', result.warnings?.length ? 'info' : 'success'); });
    if (action === 'restore-raw') { state.text = state.rawText; render(); toast('已恢复原始转写。'); return; }
    if (action === 'provider-docs' || action === 'provider-key') { await call('openProviderLink', { provider: target.dataset.provider, kind: action === 'provider-docs' ? 'docs' : 'key' }); return; }
    if (action.startsWith('open-')) { await call('openFolder', { kind: action.slice(5) }); return; }
    if (action === 'scan') return await runTask('正在检测设备…', async () => updateSnapshot(await call('refreshHardware')), { success: '设备检测已更新。' });
    if (action === 'filter-models') { state.modelFilter = target.dataset.filter; render(); return; }
    if (action === 'select-model') {
      if (state.dirty) { toast('偏好设置还有未保存的修改，请先保存或撤销。', 'info'); navigate('settings'); return; }
      const model = state.snapshot.models.find(model => model.id === target.dataset.id);
      if (!model) return;
      return await runTask('正在保存模型选择…', async () => { const settings = clone(state.snapshot.settings); settings[model.task].modelId = model.id; updateSnapshot(await call('saveSettings', { settings })); }, { success: `已选择 ${model.name}；不会下载文件或启动服务。` });
    }
    if (action === 'load-history') { const record = state.snapshot.history.find(record => record.id === target.dataset.id); if (!record) return; state.text = record.text; state.rawText = record.rawText; state.resultSource = record.source; state.resultWarnings = record.warnings || []; state.delivery = record.delivery || { status: 'not-requested', reason: '旧记录未保存交付状态。' }; navigate('workbench'); return; }
    if (action === 'copy-history') { const record = state.snapshot.history.find(record => record.id === target.dataset.id); if (record) { await call('copyText', { text: record.text }); toast('这条记录已复制。'); } return; }
    if (action === 'delete-history' && await confirmDelete('删除这条表达？', '此操作会永久删除本地历史记录，工作台中的编辑文本不会被清空。')) return await runTask('正在删除…', async () => updateSnapshot(await call('deleteHistory', { id: target.dataset.id })), { success: '记录已删除。' });
    if (action === 'clear-history' && await confirmDelete('清空所有转写历史？', '所有历史文字都将从本地记录中删除。你可以先导出一份副本。')) return await runTask('正在清空历史…', async () => updateSnapshot(await call('clearHistory')), { success: '历史记录已清空。' });
    if (action.startsWith('export-')) return await runTask('正在导出历史…', async () => { const result = await call('exportHistory', { format: action.slice(7) }); if (!result.canceled) toast(`已导出至 ${result.path}`); });
    if (action === 'reset-draft') { if (state.shortcutCapture) await cancelShortcutCapture(); state.dirty = false; state.draft = null; state.keys = {}; state.clearKeys = {}; render(); return; }
    if (action === 'retry-startup') await initialize();
  } catch (error) { state.error = error.message; toast(error.message, 'error'); render(); }
});

document.addEventListener('submit', event => { if (event.target.id === 'settings-form') { event.preventDefault(); saveSettings(); } });
document.addEventListener('keydown', event => {
  const capture = state.shortcutCapture;
  if (!capture) return;
  event.preventDefault(); event.stopPropagation();
  if (event.code === 'Escape') { cancelShortcutCapture(); return; }
  if (capture.phase !== 'active') return;
  const result = capture.engine.keydown(event);
  if (result.type === 'preview') { capture.preview = result.label; capture.message = ''; updateShortcutCaptureDisplay(); }
}, true);
document.addEventListener('keyup', event => {
  const capture = state.shortcutCapture;
  if (!capture) return;
  event.preventDefault(); event.stopPropagation();
  if (capture.phase !== 'active') return;
  const result = capture.engine.keyup(event);
  if (result.type === 'candidate') { capture.candidate = result.value; capture.preview = formatShortcut(result.value); releaseShortcutCapture(capture); }
  else if (result.type === 'invalid') { capture.preview = ''; capture.message = result.message; updateShortcutCaptureDisplay(); }
}, true);
document.addEventListener('pointerdown', event => { if (state.shortcutCapture && !event.target.closest('.shortcut-editor')) cancelShortcutCapture(); }, true);
document.addEventListener('visibilitychange', () => { if (document.hidden && state.shortcutCapture) cancelShortcutCapture(); });
window.addEventListener('blur', () => { if (state.shortcutCapture) cancelShortcutCapture(); });
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'transcript') {
    state.text = target.value;
    document.querySelector('#character-count').textContent = `${state.text.length.toLocaleString()} 字符`;
    document.querySelector('[data-action="copy"]').disabled = !state.text.trim();
    document.querySelector('[data-action="polish"]').disabled = !state.text.trim() || blocked() || state.snapshot.settings.polish.mode === 'off';
    document.querySelector('[data-action="restore-raw"]').disabled = !state.rawText || state.text === state.rawText || blocked();
  }
  if (target.id === 'history-search') { state.historySearch = target.value; document.querySelector('#history-results').innerHTML = historyResults(state.snapshot.history.filter(record => `${record.text} ${record.model}`.toLowerCase().includes(state.historySearch.toLowerCase()))); }
  if (target.closest('#settings-form') && target.name) {
    applySettingsInput(target);
    const saveState = document.querySelector('#save-state');
    saveState.innerHTML = icon('info') + '有尚未保存的修改';
    document.querySelector('[data-action="reset-draft"]').disabled = blocked();
  }
});
document.addEventListener('change', event => {
  if (!event.target.closest('#settings-form') || !['asr.mode', 'asr.engine', 'asr.provider', 'asr.endpoint', 'vad.mode', 'polish.mode'].includes(event.target.name)) return;
  if (!state.draft) return;
  if (event.target.name === 'asr.mode') {
    const previousEndpoint = normalizeEndpoint(state.draft.asr.endpoint);
    if (state.draft.asr.mode === 'cloud') { state.draft.asr.engine = 'openai'; if (state.draft.asr.endpoint.startsWith('http://')) state.draft.asr.endpoint = speechProvider(state.draft.asr.provider || 'custom')?.defaultEndpoint || 'https://api.openai.com/v1'; }
    else { state.draft.asr.engine = 'faster-whisper'; if (state.draft.asr.endpoint.startsWith('https://')) state.draft.asr.endpoint = 'http://127.0.0.1:8080'; }
    if (previousEndpoint !== normalizeEndpoint(state.draft.asr.endpoint)) clearAsrKeyDraft();
  }
  if (event.target.name === 'polish.mode') {
    if (state.draft.polish.mode === 'cloud' && state.draft.polish.endpoint.startsWith('http://')) state.draft.polish.endpoint = 'https://api.openai.com/v1';
    if (state.draft.polish.mode === 'local' && state.draft.polish.endpoint.startsWith('https://')) state.draft.polish.endpoint = 'http://127.0.0.1:8081/v1';
  }
  render();
});

const unsubscribe = [];
async function initialize() {
  try {
    updateSnapshot(await call('getSnapshot'));
    render();
  } catch (error) {
    main.innerHTML = `<section class="empty-panel startup-error">${icon('alert')}<h1>工作室暂时未能打开</h1><p>${escape(error.message)}</p><button class="button primary" data-action="retry-startup">${icon('refresh')}重试连接</button></section>`;
  }
}
hydrateIcons();
if (api) {
  if (api.onToggleRecording) unsubscribe.push(api.onToggleRecording(payload => { if (!state.shortcutCapture) toggleRecording({ trigger: payload?.trigger === 'shortcut' ? 'shortcut' : 'button' }); }));
  if (api.onStateChanged) unsubscribe.push(api.onStateChanged(async snapshot => { try { const next = snapshot?.settings ? snapshot : await call('getSnapshot'); updateSnapshot(next); if (state.shortcutCapture?.phase === 'active' && next.runtime.shortcutSuspended === false) await cancelShortcutCapture('快捷键录制已结束，原草稿保持不变。'); if (!(state.page === 'settings' && (state.dirty || state.shortcutCapture)) && !state.recording && !state.starting) render(); } catch (error) { toast(error.message, 'error'); } }));
  if (api.onNotice) unsubscribe.push(api.onNotice(notice => toast(typeof notice === 'string' ? notice : notice?.message || '应用状态已更新。', notice?.type === 'error' ? 'error' : 'info')));
  if (api.onMonitoring) unsubscribe.push(api.onMonitoring(monitor => { if (monitor?.schemaVersion === 1) { state.monitor = monitor; if (state.page === 'monitor') render(); } }));
}
window.addEventListener('beforeunload', () => { recorder.dispose(); if (state.session?.sessionId) api?.cancelRecording?.({ sessionId: state.session.sessionId, reason: 'error' }).catch(() => {}); const capture = state.shortcutCapture; if (capture) { capture.candidate = null; capture.canceled = true; clearTimeout(capture.timer); if (capture.token) api?.endShortcutCapture?.({ token: capture.token }).catch(() => {}); } unsubscribe.forEach(fn => fn?.()); });
initialize();
