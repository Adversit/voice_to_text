'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPaths, assertContained, inferenceEnv } = require('../core/paths.cjs');

// Explicit manual setup. No installation happens from a recording or UI action.
const root = path.resolve(__dirname, '..');
const paths = createPaths(root);
const environment = assertContained(root, path.join(root, '.venv'));
const python = assertContained(root, path.join(environment, 'Scripts', 'python.exe'));
const env = { ...inferenceEnv(paths), PYTHONNOUSERSITE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_CONFIG_FILE: 'NUL' };
delete env.PYTHONPATH;
delete env.PYTHONHOME;
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 600000 });
  if (result.status !== 0) throw new Error(`Project Python preparation failed (${result.error?.code || result.status}).`);
}
try {
  if (process.platform !== 'win32') throw new Error('This setup command currently targets Windows.');
  if (process.argv.slice(2).some(arg => arg !== '--offline')) throw new Error('Usage: node scripts/prepare-python.cjs [--offline]');
  if (!fs.existsSync(python)) run(process.env.MURMUR_BOOTSTRAP_PYTHON || 'python', ['-m', 'venv', environment]);
  assertContained(root, python);
  const offline = process.argv.includes('--offline') ? ['--no-index', '--find-links', assertContained(root, path.join(paths.cache, 'wheels'))] : [];
  run(python, ['-m', 'pip', 'install', ...offline, '--only-binary=:all:', '--cache-dir', path.join(paths.cache, 'pip'), 'faster-whisper==1.2.1', 'ctranslate2==4.8.2']);
  // Installed metadata is insufficient: Windows native DLL imports must work.
  run(process.execPath, [assertContained(root, path.join(root, 'scripts', 'probe-python.cjs'))]);
  console.log(`Project Python ready: ${python}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
