'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { assertContained } = require('./paths.cjs');
const execute = promisify(execFile);
const gb = bytes => Math.round((Number(bytes) / 1024 ** 3) * 10) / 10;

async function nvidiaInfo() {
  const names = process.platform === 'win32' ? [
    'nvidia-smi.exe',
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
  ] : ['nvidia-smi'];
  for (const executable of names) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
    try {
      const { stdout } = await execute(executable, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
      const gpus = stdout.trim().split(/\r?\n/u).filter(Boolean).map(line => {
        const columns = line.split(',');
        const memory = Number(columns.pop()?.trim());
        return { name: columns.join(',').trim(), vramGB: Number.isFinite(memory) && memory > 0 ? Math.round(memory / 1024 * 10) / 10 : null };
      }).filter(item => item.name);
      if (gpus.length) return gpus;
    } catch { /* No NVIDIA driver or executable is a supported configuration. */ }
  }
  return [];
}

async function windowsInfo(root) {
  const drive = path.parse(root).root.slice(0, 2);
  const script = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$cpu = @(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors)\n$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name)\n$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version\n$disk = Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='${/^[A-Za-z]:$/u.test(drive) ? drive : ''}'\" | Select-Object FreeSpace\n[pscustomobject]@{cpu=$cpu;gpu=$gpu;os=$os;disk=$disk} | ConvertTo-Json -Depth 5 -Compress`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  return JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
}

async function detectHardware(paths) {
  assertContained(paths.root, paths.root);
  const cpus = os.cpus();
  const result = {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: { name: cpus[0]?.model?.trim() || '\u672a\u77e5\u5904\u7406\u5668', cores: cpus.length || 0 },
    memory: { totalGB: gb(os.totalmem()), freeGB: gb(os.freemem()) },
    gpus: [], disk: { freeGB: null }, detectedAt: new Date().toISOString(), warnings: [],
  };
  try {
    const disk = fs.statfsSync(paths.root);
    result.disk.freeGB = gb(disk.bavail * disk.bsize);
  } catch { /* CIM is a second source on Windows. */ }
  const [nvidia, cim] = await Promise.allSettled([nvidiaInfo(), process.platform === 'win32' ? windowsInfo(paths.root) : Promise.resolve(null)]);
  if (cim.status === 'fulfilled' && cim.value) {
    const info = cim.value;
    const cpuInfo = Array.isArray(info.cpu) ? info.cpu : info.cpu ? [info.cpu] : [];
    if (cpuInfo.length) {
      result.cpu.name = cpuInfo.map(item => item.Name?.trim()).filter(Boolean).join(' / ') || result.cpu.name;
      result.cpu.cores = cpuInfo.reduce((sum, item) => sum + (Number(item.NumberOfLogicalProcessors) || 0), 0) || result.cpu.cores;
    }
    if (info.os?.Caption) result.os = `${info.os.Caption} ${info.os.Version || ''} (${os.arch()})`.trim();
    result.gpus = (Array.isArray(info.gpu) ? info.gpu : info.gpu ? [info.gpu] : []).filter(item => item.Name).map(item => ({ name: String(item.Name), vramGB: null }));
    if (info.disk?.FreeSpace != null && Number.isFinite(Number(info.disk.FreeSpace))) result.disk.freeGB = gb(info.disk.FreeSpace);
  } else if (cim.status === 'rejected') {
    result.warnings.push('\u65e0\u6cd5\u5b8c\u6210 Windows \u786c\u4ef6\u67e5\u8be2\uff1b\u5df2\u4fdd\u7559\u7cfb\u7edf\u63a5\u53e3\u8fd4\u56de\u7684 CPU \u548c\u5185\u5b58\u4fe1\u606f\u3002');
  }
  if (nvidia.status === 'fulfilled' && nvidia.value.length) {
    for (const gpu of nvidia.value) {
      const match = result.gpus.findIndex(item => item.name.toLowerCase() === gpu.name.toLowerCase());
      if (match >= 0) result.gpus[match] = gpu;
      else result.gpus.push(gpu);
    }
  }
  if (!result.gpus.length) result.warnings.push('\u672a\u83b7\u53d6 GPU \u4fe1\u606f\uff1b\u8fd9\u4e0d\u4ee3\u8868\u8bbe\u5907\u6ca1\u6709\u663e\u5361\u3002');
  if (result.gpus.some(gpu => gpu.vramGB === null)) result.warnings.push('\u90e8\u5206\u663e\u5361\u7684\u72ec\u7acb\u663e\u5b58\u672a\u77e5\uff1b\u672a\u4f7f\u7528\u53ef\u80fd\u622a\u65ad\u7684 WMI AdapterRAM \u503c\u3002');
  if (result.disk.freeGB === null) result.warnings.push('\u672a\u83b7\u53d6\u9879\u76ee\u6240\u5728\u78c1\u76d8\u7684\u53ef\u7528\u7a7a\u95f4\u3002');
  return result;
}
module.exports = { detectHardware };
