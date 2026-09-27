'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('./contracts.cjs');

function comparable(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function isInside(base, candidate) {
  const relative = path.relative(comparable(base), comparable(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function physicalPath(value) {
  let cursor = value;
  const suffix = [];
  while (true) {
    let exists = false;
    try {
      fs.lstatSync(cursor);
      exists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (exists) return path.resolve(fs.realpathSync.native(cursor), ...suffix.reverse());
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('No existing parent');
    suffix.push(path.basename(cursor));
    cursor = parent;
  }
}
function assertContained(base, candidate) {
  if (typeof base !== 'string' || typeof candidate !== 'string' || !base || !candidate || /\0/u.test(base + candidate)) {
    throw new AppError('UNSAFE_PATH', '\u5b58\u50a8\u8def\u5f84\u65e0\u6548\u3002');
  }
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, candidate);
  if (!isInside(resolvedBase, resolved)) throw new AppError('UNSAFE_PATH', '\u8def\u5f84\u5fc5\u987b\u4f4d\u4e8e\u672c\u9879\u76ee\u76ee\u5f55\u5185\u3002');
  if (process.platform === 'win32') {
    const segments = resolved.slice(path.parse(resolved).root.length).split(/[\\/]/u);
    if (segments.some(part => /[ .]$/u.test(part) || part.includes(':'))) throw new AppError('UNSAFE_PATH', '\u8def\u5f84\u5305\u542b\u4e0d\u5b89\u5168\u7684 Windows \u6587\u4ef6\u540d\u3002');
  }
  try {
    const realBase = physicalPath(resolvedBase);
    const realCandidate = physicalPath(resolved);
    if (comparable(realBase) !== comparable(resolvedBase) || !isInside(realBase, realCandidate)) {
      throw new AppError('UNSAFE_PATH', '\u68c0\u6d4b\u5230\u6307\u5411\u9879\u76ee\u5916\u7684\u7b26\u53f7\u94fe\u63a5\u6216\u76ee\u5f55\u8054\u63a5\u3002');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('PATH_UNAVAILABLE', '\u65e0\u6cd5\u9a8c\u8bc1\u9879\u76ee\u5b58\u50a8\u8def\u5f84\uff0c\u8bf7\u68c0\u67e5\u76ee\u5f55\u548c\u6743\u9650\u3002');
  }
  return resolved;
}

function createPaths(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new AppError('INVALID_ROOT', '\u9879\u76ee\u6839\u76ee\u5f55\u5fc5\u987b\u662f\u7edd\u5bf9\u8def\u5f84\u3002');
  const resolvedRoot = path.resolve(root);
  assertContained(resolvedRoot, resolvedRoot);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) throw new AppError('INVALID_ROOT', '\u9879\u76ee\u5f55\u4e0d\u5b58\u5728\uff0c\u4e0d\u4f1a\u56de\u9000\u5230\u7cfb\u7edf\u76ee\u5f55\u3002');
  const result = { root: resolvedRoot };
  for (const name of ['models', 'data', 'cache', 'runtime']) {
    result[name] = assertContained(resolvedRoot, path.join(resolvedRoot, name));
    fs.mkdirSync(result[name], { recursive: true });
    assertContained(resolvedRoot, result[name]);
  }
  result.temp = assertContained(resolvedRoot, path.join(result.cache, 'tmp'));
  fs.mkdirSync(result.temp, { recursive: true });
  return Object.freeze(result);
}

function inferenceEnv(paths) {
  const subdir = name => {
    assertContained(paths.root, paths.cache);
    const directory = assertContained(paths.root, path.join(paths.cache, name));
    fs.mkdirSync(directory, { recursive: true });
    return assertContained(paths.root, directory);
  };
  return {
    ...process.env,
    HF_HOME: subdir('huggingface'), HUGGINGFACE_HUB_CACHE: subdir('huggingface/hub'), HF_HUB_CACHE: subdir('huggingface/hub'),
    TRANSFORMERS_CACHE: subdir('transformers'), TORCH_HOME: subdir('torch'), XDG_CACHE_HOME: subdir('xdg'),
    TEMP: subdir('tmp'), TMP: subdir('tmp'), TMPDIR: subdir('tmp'), PIP_CACHE_DIR: subdir('pip'),
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
    PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  };
}
module.exports = { createPaths, assertContained, inferenceEnv };
