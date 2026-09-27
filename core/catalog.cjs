'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { assertContained } = require('./paths.cjs');

// Disk sizes are rounded reference values. Memory thresholds are conservative
// product estimates, not benchmark results or promises of inference speed.
const whisper = (variant, sizeMB, minRamGB, recommendedRamGB, minVramGB) => ({
  id: `whisper-${variant}`, name: `Whisper ${variant}`, task: 'asr', family: 'faster-whisper', sizeMB,
  minRamGB, recommendedRamGB, minVramGB, relativePath: `asr/whisper-${variant}`,
  description: '\u591a\u8bed\u8a00\u8bed\u97f3\u8bc6\u522b\uff0c\u652f\u6301\u4e2d\u82f1\u6587\u3002\u4f7f\u7528 CTranslate2 \u683c\u5f0f\uff1b\u9700\u8981\u672c\u5730 Python \u63a8\u7406\u73af\u5883\u3002',
  sourceUrl: `https://huggingface.co/Systran/faster-whisper-${variant}`,
});
const qwen = (size, sizeMB, minRamGB, recommendedRamGB, minVramGB) => ({
  id: `qwen-${size}b`, name: `Qwen 2.5 ${size}B`, task: 'polish', family: 'GGUF Q4_K_M', sizeMB,
  minRamGB, recommendedRamGB, minVramGB, relativePath: `polish/qwen-${size}b/qwen2.5-${size}b-instruct-q4_k_m.gguf`,
  description: '中英文文本润色。GGUF 文件需通过另行启动的本地 OpenAI 兼容服务加载；选择模型不会启动服务。',
  sourceUrl: `https://huggingface.co/Qwen/Qwen2.5-${size}B-Instruct-GGUF`,
});
const CATALOG = Object.freeze([
  whisper('tiny', 78, 4, 8, 1), whisper('base', 148, 4, 8, 1.5),
  whisper('small', 488, 8, 12, 3), whisper('medium', 1530, 12, 16, 5),
  {
    id: 'silero-vad', name: 'Silero VAD', task: 'vad', family: 'ONNX', sizeMB: 3,
    minRamGB: 2, recommendedRamGB: 4, minVramGB: 0, relativePath: 'vad/silero-vad/silero_vad.onnx',
    description: '\u68c0\u6d4b\u4eba\u58f0\u4e0e\u9759\u97f3\u3002\u539f\u578b\u9ed8\u8ba4\u4f7f\u7528\u65e0\u6a21\u578b\u80fd\u91cf\u68c0\u6d4b\uff0c\u53ef\u540e\u7eed\u5207\u6362 ONNX \u6a21\u578b\u3002',
    sourceUrl: 'https://github.com/snakers4/silero-vad',
  },
  qwen('0.5', 398, 4, 8, 1.5), qwen('1.5', 1120, 8, 12, 3), qwen('3', 1930, 12, 16, 4),
]);

function recommend(model, hardware) {
  const estimate = '\u4ec5\u4e3a\u8d44\u6e90\u4f30\u7b97\uff0c\u672a\u9a8c\u8bc1\u63a8\u7406\u901f\u5ea6\u6216 CUDA \u73af\u5883\u3002';
  if (!hardware || !Number.isFinite(hardware.memory?.totalGB) || hardware.memory.totalGB <= 0) {
    return { level: 'unknown', reason: '\u5c1a\u65e0\u53ef\u7528\u7684\u5185\u5b58\u68c0\u6d4b\u7ed3\u679c\uff0c\u8bf7\u5148\u5237\u65b0\u8bbe\u5907\u4fe1\u606f\u3002' };
  }
  const { totalGB, freeGB } = hardware.memory;
  const diskGB = hardware.disk?.freeGB;
  const fileGB = model.sizeMB / 1000;
  const workingGB = model.task === 'vad' ? 0.25 : model.task === 'asr' ? Math.max(1, fileGB * 2.5) : fileGB * 1.6 + 0.8;
  const reserveGB = 2;
  if (Number.isFinite(diskGB) && diskGB < fileGB * 1.2 + 1) {
    return { level: 'avoid', reason: '\u9879\u76ee\u6240\u5728\u78c1\u76d8\u7a7a\u95f4\u4e0d\u8db3\uff1b\u9700\u4e3a\u6a21\u578b\u3001\u7f13\u5b58\u548c\u4e34\u65f6\u6587\u4ef6\u9884\u7559\u7a7a\u95f4\u3002' };
  }
  if (totalGB < model.minRamGB) {
    return { level: 'avoid', reason: `\u7269\u7406\u5185\u5b58\u4f4e\u4e8e ${model.minRamGB} GB \u7684\u4fdd\u5b88\u4f7f\u7528\u95e8\u69db\uff0c\u5efa\u8bae\u9009\u62e9\u66f4\u5c0f\u6a21\u578b\u3002${estimate}` };
  }
  if (!Number.isFinite(freeGB) || freeGB < 0) return { level: 'unknown', reason: `\u53ef\u7528\u5185\u5b58\u672a\u77e5\uff0c\u65e0\u6cd5\u4f30\u8ba1\u5f53\u524d\u8d1f\u8f7d\u3002${estimate}` };
  if (freeGB < workingGB) {
    return { level: 'avoid', reason: `\u5f53\u524d\u53ef\u7528\u5185\u5b58\u4f4e\u4e8e\u7ea6 ${workingGB.toFixed(1)} GB \u7684\u6a21\u578b\u5de5\u4f5c\u4f30\u7b97\uff0c\u8bf7\u91ca\u653e\u5185\u5b58\u6216\u9009\u62e9\u66f4\u5c0f\u6a21\u578b\u3002` };
  }
  if (freeGB < workingGB + reserveGB || totalGB < model.recommendedRamGB) {
    return { level: 'caution', reason: `\u5185\u5b58\u4f59\u91cf\u6709\u9650\uff1b\u6a21\u578b\u5de5\u4f5c\u7a7a\u95f4\u7ea6 ${workingGB.toFixed(1)} GB\uff0c\u53e6\u5efa\u8bae\u4e3a\u5176\u4ed6\u5e94\u7528\u9884\u7559 ${reserveGB} GB\u3002${estimate}` };
  }
  if (!Number.isFinite(diskGB)) {
    return { level: 'caution', reason: `\u5185\u5b58\u4f59\u91cf\u53ef\u7528\uff0c\u4f46\u9879\u76ee\u78c1\u76d8\u7a7a\u95f4\u672a\u77e5\u3002${estimate}` };
  }
  const gpu = (hardware.gpus || []).find(item => Number.isFinite(item.vramGB) && item.vramGB >= model.minVramGB && /nvidia/iu.test(item.name));
  const gpuHint = model.minVramGB === 0 ? '\u65e0\u9700\u72ec\u7acb\u663e\u5361\u3002' : gpu ? '\u663e\u5b58\u5bb9\u91cf\u4e5f\u8fbe\u5230\u53c2\u8003\u95e8\u69db\uff1b\u4ecd\u9700\u53e6\u884c\u9a8c\u8bc1 GPU \u8fd0\u884c\u73af\u5883\u3002' : '\u53ef\u4f18\u5148\u5c1d\u8bd5 CPU\uff1bGPU \u52a0\u901f\u80fd\u529b\u672a\u786e\u8ba4\u3002';
  return { level: 'recommended', reason: `\u5185\u5b58\u4e0e\u78c1\u76d8\u4f59\u91cf\u7b26\u5408\u4fdd\u5b88\u4f30\u7b97\u3002${gpuHint}${estimate}` };
}

function installed(paths, model) {
  const isFile = relative => {
    try {
      assertContained(paths.root, paths.models);
      const target = assertContained(paths.models, path.join(paths.models, relative));
      const stat = fs.statSync(target);
      return stat.isFile() && stat.size > 0;
    } catch { return false; }
  };
  if (model.task !== 'asr') return isFile(model.relativePath);
  return ['config.json', 'model.bin', 'tokenizer.json'].every(name => isFile(path.join(model.relativePath, name)))
    && ['vocabulary.txt', 'vocabulary.json'].some(name => isFile(path.join(model.relativePath, name)));
}
function getModels(paths, hardware) {
  return CATALOG.map(model => ({ ...model, installed: installed(paths, model), recommendation: recommend(model, hardware) }));
}
module.exports = { getModels, recommend };
