'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPaths, assertContained, inferenceEnv } = require('../core/paths.cjs');
const root = path.resolve(__dirname, '..');
const paths = createPaths(root);
const python = assertContained(root, path.join(root, '.venv', 'Scripts', 'python.exe'));
const env = { ...inferenceEnv(paths), PYTHONNOUSERSITE: '1' };
delete env.PYTHONPATH; delete env.PYTHONHOME;
const source = `import importlib, importlib.metadata as metadata, json
result = {'imports': {}, 'versions': {}}
for name in ['faster_whisper', 'ctranslate2', 'onnxruntime', 'numpy', 'av']:
    try:
        module = importlib.import_module(name)
        result['imports'][name] = True
        result['versions'][name] = getattr(module, '__version__', None)
    except Exception as error:
        result['imports'][name] = False
        result.setdefault('errors', {})[name] = type(error).__name__
try:
    import ctranslate2
    result['cudaDevices'] = ctranslate2.get_cuda_device_count()
    result['cudaTypes'] = sorted(ctranslate2.get_supported_compute_types('cuda'))
    result['cpuTypes'] = sorted(ctranslate2.get_supported_compute_types('cpu'))
except Exception as error:
    result['cudaProbeError'] = type(error).__name__
print(json.dumps(result))
`;
const result = spawnSync(python, ['-B', '-c', source], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
if (result.status !== 0) { console.error(`Python probe failed (${result.error?.code || result.status}).`); process.exitCode = 1; }
else {
  const report = { checkedAt: new Date().toISOString(), python, ...JSON.parse(result.stdout) };
  const folder = assertContained(root, path.join(root, 'artifacts', 'local-model-check'));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'python-probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report));
  if (Object.values(report.imports).some(value => !value)) process.exitCode = 1;
}
