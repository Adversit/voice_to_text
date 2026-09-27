// Audio never leaves this module until the user explicitly stops recording.
// The main process validates this WAV again before selecting any provider.
export class MicrophoneRecorder {
  constructor({ onLevel = () => {}, onLimit = () => {} } = {}) {
    this.onLevel = onLevel;
    this.onLimit = onLimit;
    this.phase = 'idle';
    this.generation = 0;
    this.parts = [];
  }

  async start() {
    if (this.phase !== 'idle') throw new Error('录音正在启动或进行中。');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境无法使用麦克风，请从桌面应用打开。');
    this.phase = 'starting';
    const generation = ++this.generation;
    let acquiredStream;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (generation !== this.generation) {
        acquiredStream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = acquiredStream;
      this.context = new AudioContext();
      await this.context.resume();
      if (generation !== this.generation) { this.dispose(); return false; }
      this.sampleRate = this.context.sampleRate;
      this.parts = [];
      this.frames = 0;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.mute = this.context.createGain();
      this.mute.gain.value = 0;
      this.processor.onaudioprocess = event => {
        if (this.phase !== 'recording') return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = Math.max(0, this.sampleRate * 120 - this.frames);
        if (!remaining) return;
        const block = new Float32Array(input.subarray(0, Math.min(input.length, remaining)));
        this.parts.push(block);
        this.frames += block.length;
        let power = 0;
        for (const sample of block) power += sample * sample;
        this.onLevel(Math.min(1, Math.sqrt(power / block.length) * 7), this.frames / this.sampleRate);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.mute);
      this.mute.connect(this.context.destination);
      this.phase = 'recording';
      this.timer = setTimeout(() => this.onLimit(), 120000);
      return true;
    } catch (error) {
      acquiredStream?.getTracks().forEach(track => track.stop());
      this.dispose();
      const messages = { NotAllowedError: '麦克风权限被拒绝。请在 Windows 隐私设置中允许桌面应用访问麦克风，然后重试。', NotFoundError: '没有找到麦克风。请连接输入设备后重试。', NotReadableError: '麦克风暂时不可用，可能正在被其他应用占用。', SecurityError: '当前环境阻止了麦克风访问，请使用桌面应用。' };
      throw new Error(messages[error.name] || `无法启动录音：${error.message}`);
    }
  }

  stop() {
    if (this.phase === 'starting') { this.dispose(); return null; }
    if (this.phase !== 'recording') return null;
    const frames = this.frames;
    const sampleRate = this.sampleRate;
    const samples = new Float32Array(frames);
    let offset = 0;
    for (const part of this.parts) { samples.set(part, offset); offset += part.length; }
    this.dispose();
    this.parts = [];
    const sampleCount = Math.floor(frames * 16000 / sampleRate);
    const audio = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(audio);
    const writeAscii = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
    writeAscii(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeAscii(36, 'data'); view.setUint32(40, sampleCount * 2, true);
    // Average each source interval; this also avoids alias-heavy point sampling.
    for (let i = 0; i < sampleCount; i++) {
      const start = i * sampleRate / 16000;
      const end = (i + 1) * sampleRate / 16000;
      let sum = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += (samples[j] || 0) * Math.max(0, Math.min(end, j + 1) - Math.max(start, j));
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return { audio, durationMs: sampleCount / 16 };
  }

  dispose() {
    ++this.generation;
    clearTimeout(this.timer);
    this.phase = 'idle';
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
    this.source?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.processor = this.source = this.stream = this.mute = this.context = null;
  }
}
