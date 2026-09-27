'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { assertContained, inferenceEnv } = require('../core/paths.cjs');
const { AppError } = require('../core/contracts.cjs');

function createNativeShortcut({ helperPath, ownerPid, paths, onActivate, onFailure, testMode = false }) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new TypeError('Invalid owner PID.');
  helperPath = assertContained(paths.root, helperPath);
  let current = null;
  let testTargetPid = 0;
  const unavailable = () => new AppError('SHORTCUT_UNAVAILABLE', '右 Alt 监听不可用，请重新保存快捷键或重启应用。');

  async function stop() {
    const state = current;
    if (!state) return;
    current = null;
    state.stopping = true;
    clearTimeout(state.timer);
    if (!state.ready) state.reject(unavailable());
    state.child.stdin.end();
    await new Promise((resolve, reject) => {
      let timer, killTimer;
      const finish = () => { clearTimeout(timer); clearTimeout(killTimer); resolve(); };
      state.child.once('close', finish);
      timer = setTimeout(() => {
        state.child.kill();
        killTimer = setTimeout(() => reject(unavailable()), 1000);
      }, 1000);
      if (state.closed) finish();
    });
  }

  async function start() {
    if (current?.failed) await stop();
    if (current) return current.promise;
    // Recheck at use time: a directory can have become a junction since construction.
    assertContained(paths.root, helperPath);
    if (process.platform !== 'win32' || !fs.existsSync(helperPath)) throw unavailable();
    const state = { ready: false, stopping: false, closed: false, failed: false, buffer: '' };
    state.promise = new Promise((resolve, reject) => { state.resolve = resolve; state.reject = reject; });
    const args = ['listen', String(ownerPid), ...(testMode ? ['--test-mode'] : [])];
    const child = state.child = spawn(helperPath, args, { cwd: paths.root, env: inferenceEnv(paths), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    current = state;
    const fail = () => {
      if (state.failed || state.stopping) return;
      state.failed = true;
      clearTimeout(state.timer);
      const error = unavailable();
      state.reject(error);
      child.kill();
      if (state.ready) onFailure?.(error);
    };
    state.timer = setTimeout(fail, 3000);
    child.on('error', fail);
    child.stdin.on('error', () => { if (!state.stopping) fail(); });
    child.on('close', () => { state.closed = true; if (!state.stopping) fail(); });
    child.stderr.on('data', fail); // The protocol never includes diagnostics or key data.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (state.failed || state.stopping) return;
      state.buffer += chunk;
      if (state.buffer.length > 4096) { fail(); return; }
      let newline;
      while ((newline = state.buffer.indexOf('\n')) >= 0) {
        const line = state.buffer.slice(0, newline).trim();
        state.buffer = state.buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { fail(); return; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) { fail(); return; }
        if (message.type === 'ready' && !state.ready && Object.keys(message).length === 1) {
          state.ready = true;
          clearTimeout(state.timer);
          if (testMode) child.stdin.write(`${JSON.stringify({ type: 'testTarget', pid: testTargetPid })}\n`);
          state.resolve();
        } else if (message.type === 'activate' && state.ready && Object.keys(message).length === 1) {
          onActivate?.();
        } else { fail(); return; }
      }
    });
    return state.promise;
  }

  function setTestTargetPid(pid) {
    if (!testMode) return;
    if (pid === null) pid = 0;
    if (!Number.isSafeInteger(pid) || pid < 0) throw new TypeError('Invalid test target PID.');
    testTargetPid = pid;
    if (current?.ready && !current.stopping) current.child.stdin.write(`${JSON.stringify({ type: 'testTarget', pid })}\n`);
  }
  return { start, stop, setTestTargetPid };
}

module.exports = { createNativeShortcut };
