'use strict';

const { AppError } = require('./contracts.cjs');

const SAMPLE_RATE = 16000;
const MIN_DURATION_MS = 300;
const MAX_DURATION_MS = 120000;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function validateWav(audio, claimedDurationMs) {
  let wav;
  if (Buffer.isBuffer(audio)) wav = Buffer.from(audio);
  else if (audio instanceof ArrayBuffer) wav = Buffer.from(audio.slice(0));
  else if (ArrayBuffer.isView(audio)) wav = Buffer.from(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength));
  else throw new AppError('AUDIO_INVALID', '录音数据无效，请重新录音。');
  if (!wav.length) throw new AppError('AUDIO_EMPTY', '录音为空，请检查麦克风后重试。');
  if (wav.length > MAX_AUDIO_BYTES) throw new AppError('AUDIO_TOO_LARGE', '录音文件超过 4 MB，请缩短录音。');
  if (!Number.isFinite(claimedDurationMs) || claimedDurationMs < 0) {
    throw new AppError('AUDIO_INVALID', '录音时长无效。');
  }
  const invalid = () => { throw new AppError('AUDIO_FORMAT', '需要完整的 16 kHz、单声道、PCM16 WAV 录音。'); };
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') invalid();
  if (wav.readUInt32LE(4) + 8 !== wav.length) invalid();
  let format;
  let pcm;
  let offset = 12;
  while (offset < wav.length) {
    if (offset + 8 > wav.length) invalid();
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wav.length || end + (size % 2) > wav.length) invalid();
    if (id === 'fmt ') {
      if (format || size < 16) invalid();
      format = {
        type: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4), byteRate: wav.readUInt32LE(start + 8),
        blockAlign: wav.readUInt16LE(start + 12), bits: wav.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      if (pcm) invalid();
      pcm = wav.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (!format || !pcm || format.type !== 1 || format.channels !== 1 || format.sampleRate !== SAMPLE_RATE ||
      format.byteRate !== 32000 || format.blockAlign !== 2 || format.bits !== 16 || pcm.length % 2) invalid();
  if (!pcm.length) throw new AppError('AUDIO_EMPTY', '录音没有音频样本，请检查麦克风。');
  const durationMs = pcm.length / 32;
  if (durationMs < MIN_DURATION_MS) throw new AppError('AUDIO_TOO_SHORT', '录音不足 0.3 秒，请说完一句话再停止。');
  if (durationMs > MAX_DURATION_MS) throw new AppError('AUDIO_TOO_LONG', '单次录音最多 2 分钟，请分段录制。');
  // UI timers can drift; limits always come from the actual PCM samples.
  if (Math.abs(durationMs - claimedDurationMs) > Math.max(1000, durationMs * 0.1)) {
    throw new AppError('AUDIO_DURATION', '录音时长与音频样本不一致，请重新录音。');
  }
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  if (peak <= 1) throw new AppError('AUDIO_SILENT', '录音中没有声音，请检查麦克风和输入音量。');
  return { wav, pcm, durationMs, sampleRate: SAMPLE_RATE };
}

function hasEnergy(pcm, threshold = 0.015) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new AppError('VAD_INVALID', '语音检测阈值必须大于 0 且不超过 1。');
  }
  const frameSamples = 320; // 20 ms frames avoid averaging speech into surrounding silence.
  let activeSamples = 0;
  for (let byte = 0; byte < pcm.length; byte += frameSamples * 2) {
    const count = Math.min(frameSamples, (pcm.length - byte) / 2);
    let energy = 0;
    for (let i = 0; i < count; i++) energy += (pcm.readInt16LE(byte + i * 2) / 32768) ** 2;
    if (Math.sqrt(energy / count) >= threshold) activeSamples += count;
  }
  return activeSamples >= SAMPLE_RATE * 0.1;
}

module.exports = { validateWav, hasEnergy, SAMPLE_RATE, MIN_DURATION_MS, MAX_DURATION_MS, MAX_AUDIO_BYTES };
