'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { assertContained, inferenceEnv } = require('./paths.cjs');

function validTarget(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.hwnd === 'string' && /^[1-9]\d{0,18}$/.test(value.hwnd) &&
    Number.isInteger(value.pid) && value.pid > 0 && value.pid <= 0x7fffffff &&
    typeof value.processStartTicks === 'string' && /^[1-9]\d{0,18}$/.test(value.processStartTicks) &&
    Array.isArray(value.runtimeId) && value.runtimeId.length > 0 && value.runtimeId.length <= 64 &&
    value.runtimeId.every(item => Number.isInteger(item) && item >= -0x80000000 && item <= 0x7fffffff);
}

function createWindowsInput({ paths, ownerPid, helperPath }) {
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) throw new TypeError('ownerPid must identify the desktop process');
  const helper = assertContained(paths.root, helperPath || path.join(paths.runtime, 'native', 'Murmur.Input.exe'));
  const pending = new Map();
  function available() {
    try { return process.platform === 'win32' && fs.statSync(assertContained(paths.root, helper)).isFile(); } catch { return false; }
  }
  async function invoke(command, payload) {
    if (!available()) throw new Error('HELPER_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      const chunks = [];
      let length = 0, terminalError, settled = false;
      const child = spawn(assertContained(paths.root, helper), [command], {
        cwd: paths.root, env: inferenceEnv(paths), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => { terminalError = new Error('HELPER_TIMEOUT'); child.kill(); }, 5000);
      pending.set(child, () => { terminalError = new Error('HELPER_CANCELED'); child.kill(); });
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        pending.delete(child);
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      child.on('error', () => finish(new Error('HELPER_UNAVAILABLE')));
      child.stdin.on('error', () => {});
      child.stderr.resume();
      child.stdout.on('data', chunk => {
        if (terminalError) return;
        length += chunk.length;
        if (length > 16384) { terminalError = new Error('HELPER_RESPONSE'); child.kill(); }
        else chunks.push(chunk);
      });
      child.on('close', code => {
        if (terminalError) { finish(terminalError); return; }
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
          if (code !== 0 || result?.ok !== true || !result.data || typeof result.data !== 'object') throw new Error('HELPER_RESPONSE');
          finish(null, result.data);
        } catch { finish(new Error('HELPER_RESPONSE')); }
      });
      child.stdin.end(JSON.stringify({ ...payload, ownerPid }));
    });
  }
  async function capture() {
    try {
      const result = await invoke('capture', {});
      if (result.target !== null && !validTarget(result.target)) throw new Error('HELPER_RESPONSE');
      if (typeof result.reason !== 'string' || result.reason.length > 1000) throw new Error('HELPER_RESPONSE');
      return { target: result.target, reason: result.reason };
    } catch {
      return { target: null, reason: '自动粘贴助手不可用或输入框无法验证；录音完成后会复制文字，请手动粘贴。' };
    }
  }
  async function paste({ target, clipboardHash } = {}) {
    if (!validTarget(target) || target.pid === ownerPid || typeof clipboardHash !== 'string' || !/^[a-f0-9]{64}$/.test(clipboardHash)) {
      return { status: 'skipped', reason: '没有有效的原始输入框或剪贴板校验信息，请手动粘贴。' };
    }
    try {
      const result = await invoke('paste', { target, clipboardHash });
      if (!['pasted', 'skipped', 'failed'].includes(result.status) || typeof result.reason !== 'string' || result.reason.length > 1000) throw new Error('HELPER_RESPONSE');
      return { status: result.status, reason: result.reason };
    } catch {
      return { status: 'failed', reason: '自动粘贴助手不可用或响应超时；文字仍在剪贴板，请手动粘贴。' };
    }
  }
  function cancelPending() {
    const count = pending.size;
    for (const cancel of pending.values()) cancel();
    return count;
  }
  async function waitForKeyRelease({ keyCode } = {}) {
    if (!Number.isInteger(keyCode) || keyCode < 1 || keyCode > 255) return false;
    try {
      const result = await invoke('key-release', { keyCode });
      return result.released === true;
    } catch { return false; }
  }
  return { capture, paste, available, cancelPending, waitForKeyRelease };
}

module.exports = { createWindowsInput, validTarget };
