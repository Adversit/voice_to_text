'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertContained, createPaths, inferenceEnv } = require('../core/paths.cjs');

const root = path.resolve(__dirname, '..');

function buildNative({ includeFixture = false } = {}) {
  if (process.platform !== 'win32') throw new Error('Native input helper requires Windows.');
  const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const compiler = path.join(framework, 'csc.exe');
  if (!fs.existsSync(compiler)) throw new Error('The existing .NET Framework C# compiler is unavailable. No download was attempted.');
  const paths = createPaths(root);
  const directory = assertContained(root, path.join(paths.runtime, 'native'));
  fs.mkdirSync(directory, { recursive: true });
  const references = ['System.dll', 'System.Core.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll'].map(name => path.join(framework, name));
  for (const name of ['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll']) references.push(path.join(framework, 'WPF', name));
  const build = (source, name) => {
    const input = assertContained(root, path.join(root, 'native', source));
    const output = assertContained(root, path.join(directory, name));
    const result = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${output}`, ...references.map(file => `/reference:${file}`), input], {
      cwd: root, env: inferenceEnv(paths), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0 || !fs.existsSync(output)) throw new Error(`Native helper compilation failed: ${(result.stdout || result.stderr || result.error?.message || 'unknown compiler failure').trim()}`);
    return output;
  };
  const helper = build('FocusBridge.cs', 'Murmur.Input.exe');
  build('ShortcutBridge.cs', 'Murmur.Shortcut.exe');
  if (includeFixture) build('PasteTarget.cs', 'Murmur.PasteTarget.exe');
  return helper;
}

if (require.main === module) {
  try { console.log(buildNative({ includeFixture: process.argv.includes('--fixture') })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildNative };
