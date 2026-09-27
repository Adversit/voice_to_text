'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');
const { createPaths, assertContained } = require('../core/paths.cjs');
const manifest = require('./model-manifest.cjs');

function proxyAgent(url) {
  if (['modelscope.cn', 'cdn-lfs-cn-1.modelscope.cn'].includes(url.hostname)) return false;
  const value = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!value) return false;
  const proxy = new URL(value);
  if (proxy.protocol !== 'http:' || proxy.username || proxy.password) throw new Error('Model setup supports an HTTP CONNECT proxy without URL credentials.');
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (options, callback) => {
    let done = false;
    const finish = (error, socket) => { if (done) return; done = true; callback(error, socket); };
    const address = `${options.host}:${options.port || 443}`;
    const tunnel = http.request({ hostname: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: address, headers: { Host: address }, agent: false });
    tunnel.setTimeout(30000, () => tunnel.destroy(new Error('Proxy connection timed out.')));
    tunnel.on('error', () => finish(new Error('Model proxy connection failed.')));
    tunnel.on('connect', (response, socket, head) => {
      if (response.statusCode !== 200 || head.length) { socket.destroy(); finish(new Error('Model proxy tunnel refused.')); return; }
      const secure = tls.connect({ socket, servername: options.servername || options.host, rejectUnauthorized: true });
      secure.setTimeout(30000, () => { secure.destroy(); finish(new Error('Model TLS handshake timed out.')); });
      secure.once('secureConnect', () => { secure.setTimeout(0); finish(null, secure); });
      secure.once('error', () => finish(new Error('Model TLS connection failed.')));
    });
    tunnel.end();
  };
  return agent;
}

function allowedUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !(host === 'huggingface.co' || host === 'raw.githubusercontent.com' || host.endsWith('.hf.co') || host === 'modelscope.cn' || host === 'cdn-lfs-cn-1.modelscope.cn')) throw new Error('Unapproved model download destination.');
  return url;
}

function request(value, offset, end, redirects = 0) {
  const url = allowedUrl(value);
  if (redirects > 8) return Promise.reject(new Error('Too many model redirects.'));
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Murmur-model-preparation/1', 'Accept-Encoding': 'identity' };
    if (offset || end !== undefined) headers.Range = `bytes=${offset}-${end ?? ''}`;
    const req = https.get(url, { headers, agent: proxyAgent(url) }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        try { resolve(request(new URL(response.headers.location, url), offset, end, redirects + 1)); }
        catch (error) { reject(error); }
      } else resolve(response);
    });
    req.setTimeout(60000, () => req.destroy(new Error('Model download timed out.')));
    req.on('error', () => reject(new Error('Model download connection failed.')));
  });
}

async function verify(file, asset) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size !== asset.size) throw new Error(`Size mismatch: ${asset.name}.`);
  const sha256 = crypto.createHash('sha256');
  const git = crypto.createHash('sha1').update(`blob ${stat.size}\0`);
  for await (const chunk of fs.createReadStream(file)) { sha256.update(chunk); git.update(chunk); }
  const result = sha256.digest('hex');
  const gitBlob = git.digest('hex');
  if ((asset.sha256 && result !== asset.sha256) || (asset.gitBlob && gitBlob !== asset.gitBlob)) throw new Error(`Hash mismatch: ${asset.name}.`);
  return { name: asset.name, size: stat.size, sha256: result, upstreamHash: asset.sha256 || asset.gitBlob, upstreamHashType: asset.sha256 ? 'sha256' : 'git-blob-sha1' };
}

function rangeStart(response, offset, size) {
  if (response.statusCode === 200) return 0;
  if (response.statusCode !== 206) throw new Error(`Model download HTTP ${response.statusCode}.`);
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
  if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[3]) !== size || Number(range[2]) >= size) throw new Error('Model download returned an invalid byte range.');
  return offset;
}

function availableBytes(directory) {
  const info = fs.statfsSync(directory, { bigint: true });
  return info.bavail * info.bsize;
}

function acquireAssetLock(paths, model, asset) {
  const directory = assertContained(paths.models, path.join(paths.models, model.directory));
  fs.mkdirSync(directory, { recursive: true });
  const file = assertContained(paths.models, path.join(directory, `${asset.name}.download-lock.json`));
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { encoding: 'utf8', flag: 'wx' });
      return () => {
        assertContained(paths.models, file);
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertContained(paths.models, file);
      if (fs.statSync(file).size > 512) throw new Error('Invalid existing model download lock.');
      const saved = fs.readFileSync(file, 'utf8');
      let owner;
      try { owner = JSON.parse(saved); } catch { throw new Error('Invalid existing model download lock.'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') throw new Error('Invalid existing model download lock.');
      let exited = false;
      try { process.kill(owner.pid, 0); } catch (failure) { exited = failure.code === 'ESRCH'; }
      if (!exited) throw Object.assign(new Error(`Model asset is already downloading: ${model.id}/${asset.name}.`), { code: 'DOWNLOAD_BUSY' });
      // Never race another process by unlinking a stale path automatically.
      // Removing this exact lock after confirming its owner exited is an
      // explicit recovery step; all downloaded checkpoints remain untouched.
      throw Object.assign(new Error(`Stale model download lock from PID ${owner.pid}. Confirm the owner has exited, remove only ${file}, then retry; model checkpoints are preserved.`), { code: 'DOWNLOAD_STALE' });
    }
  }
  throw new Error('Could not acquire model download lock.');
}

async function downloadAsset(options) {
  const release = acquireAssetLock(options.paths, options.model, options.asset);
  try { return await downloadAssetUnlocked(options); }
  finally { release(); }
}

async function downloadAssetUnlocked({ paths, model, asset, open = request, progress = console.log, freeBytes = availableBytes }) {
  const directory = assertContained(paths.models, path.join(paths.models, model.directory));
  assertContained(paths.root, directory);
  fs.mkdirSync(directory, { recursive: true });
  const target = assertContained(paths.models, path.join(directory, asset.name));
  assertContained(paths.root, target);
  if (fs.existsSync(target)) {
    const result = await verify(target, asset); // Never overwrite an unexpected complete file.
    progress(`${model.id}/${asset.name}: verified existing ${asset.size} bytes`);
    return result;
  }
  if (asset.size >= 32 * 1024 * 1024 && open === request) return downloadSegmented({ paths, model, asset, target, progress, freeBytes });
  const partial = `${target}.part`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    assertContained(paths.models, partial);
    let offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
    if (offset > asset.size) throw new Error(`Oversized partial file: ${asset.name}.`);
    if (BigInt(freeBytes(directory)) < BigInt(asset.size - offset)) throw Object.assign(new Error(`Insufficient project disk space: ${asset.name}.`), { code: 'ENOSPC' });
    try {
      if (offset < asset.size) {
        const response = await open(new URL(asset.url || asset.remote || asset.name, model.base), offset);
        let start;
        try { start = rangeStart(response, offset, asset.size); }
        catch (error) { response.destroy(); throw error; }
        assertContained(paths.root, partial);
        assertContained(paths.models, partial);
        let count = start, lastReport = Date.now();
        progress(`${model.id}/${asset.name}: attempt ${attempt}, ${start}/${asset.size} bytes`);
        const counter = new Transform({ transform(chunk, _encoding, callback) {
          count += chunk.length;
          if (count > asset.size) return callback(new Error('Model download exceeded expected size.'));
          if (Date.now() - lastReport >= 5000) { lastReport = Date.now(); progress(`${model.id}/${asset.name}: ${count}/${asset.size} bytes (${(100 * count / asset.size).toFixed(1)}%)`); }
          callback(null, chunk);
        } });
        await pipeline(response, counter, fs.createWriteStream(partial, { flags: start ? 'a' : 'w' }));
      }
      assertContained(paths.models, partial);
      const result = await verify(partial, asset);
      assertContained(paths.models, target);
      if (fs.existsSync(target)) throw new Error(`Destination appeared during download: ${asset.name}.`);
      fs.renameSync(partial, target);
      progress(`${model.id}/${asset.name}: verified ${asset.size} bytes, SHA256 ${result.sha256}`);
      return result;
    } catch (error) {
      lastError = error;
      assertContained(paths.models, partial);
      if (error.code === 'ENOSPC') throw error; // Preserve partial, never report installed.
      // A complete corrupt transfer must never be resumed/adopted. Keep it for
      // inspection inside models, then retry from a fresh partial file.
      if (fs.existsSync(partial) && fs.statSync(partial).size >= asset.size) {
        const invalid = assertContained(paths.models, `${partial}.invalid-${crypto.randomUUID()}`);
        assertContained(paths.models, partial);
        fs.renameSync(partial, invalid);
      }
      progress(`${model.id}/${asset.name}: attempt ${attempt} failed (${error.message}); partial retained inside models.`);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function downloadSegmented({ paths, model, asset, target, progress = console.log, freeBytes = availableBytes, open = request, chunkSize = 512 * 1024, connections = 12 }) {
  const partial = assertContained(paths.models, `${target}.part`);
  const directory = assertContained(paths.models, `${target}.chunks`);
  fs.mkdirSync(directory, { recursive: true });
  // Split older 8 MiB checkpoints before resuming with shorter requests. Keep
  // the old first block intact until every additional piece has been written.
  for (const name of fs.readdirSync(directory)) {
    if (!/^\d{12}\.part$/.test(name)) throw new Error('Unexpected model checkpoint file.');
    const file = assertContained(paths.models, path.join(directory, name));
    const size = fs.statSync(file).size, start = Number(name.slice(0, 12));
    if (start % chunkSize || start + size > asset.size || size > 8 * 1024 * 1024) throw new Error('Invalid model checkpoint bounds.');
    if (size <= chunkSize) continue;
    const data = fs.readFileSync(file);
    for (let position = chunkSize; position < data.length; position += chunkSize) {
      const piece = assertContained(paths.models, path.join(directory, `${String(start + position).padStart(12, '0')}.part`));
      const content = data.subarray(position, position + chunkSize);
      if (!fs.existsSync(piece) || fs.statSync(piece).size < content.length) fs.writeFileSync(piece, content);
    }
    fs.writeFileSync(file, data.subarray(0, chunkSize));
  }
  const chunks = Array.from({ length: Math.ceil(asset.size / chunkSize) }, (_, index) => {
    const start = index * chunkSize;
    return { start, end: Math.min(asset.size - 1, start + chunkSize - 1), file: assertContained(paths.models, path.join(directory, `${String(start).padStart(12, '0')}.part`)) };
  });
  // Reuse an earlier sequential transfer before making any new request.
  if (fs.existsSync(partial)) {
    const size = fs.statSync(partial).size;
    if (size > asset.size) throw new Error('Oversized model partial.');
    if (size === asset.size) {
      let verified;
      try { verified = await verify(partial, asset); }
      catch (error) {
        const suffix = `.invalid-${crypto.randomUUID()}`;
        fs.renameSync(partial, assertContained(paths.models, partial + suffix));
        fs.renameSync(directory, assertContained(paths.models, directory + suffix));
        throw error;
      }
      assertContained(paths.models, target);
      if (fs.existsSync(target)) throw new Error('Model destination appeared during resume.');
      fs.renameSync(partial, target);
      assertContained(paths.models, directory); fs.rmSync(directory, { recursive: true });
      progress(`${model.id}/${asset.name}: verified complete checkpoint ${asset.size} bytes`);
      return verified;
    }
    let copyBytes = 0;
    for (const chunk of chunks) {
      const needed = Math.max(0, Math.min(chunk.end + 1, size) - chunk.start);
      const existing = fs.existsSync(chunk.file) ? fs.statSync(chunk.file).size : 0;
      copyBytes += Math.max(0, needed - existing);
    }
    if (BigInt(freeBytes(directory)) < BigInt(copyBytes)) throw Object.assign(new Error('Insufficient project disk space for checkpoint.'), { code: 'ENOSPC' });
    const source = fs.openSync(partial, 'r');
    try {
      for (const chunk of chunks) {
        if (chunk.start >= size) break;
        const bytes = Math.min(chunk.end + 1, size) - chunk.start;
        if (fs.existsSync(chunk.file) && fs.statSync(chunk.file).size >= bytes) continue;
        const data = Buffer.allocUnsafe(bytes);
        let read = 0;
        while (read < bytes) { const got = fs.readSync(source, data, read, bytes - read, chunk.start + read); if (!got) throw new Error('Truncated model checkpoint.'); read += got; }
        assertContained(paths.models, chunk.file); fs.writeFileSync(chunk.file, data);
      }
    } finally { fs.closeSync(source); }
    assertContained(paths.models, partial); fs.unlinkSync(partial);
  }
  let received = 0, lastReport = 0;
  for (const chunk of chunks) {
    chunk.size = chunk.end - chunk.start + 1;
    chunk.have = fs.existsSync(chunk.file) ? fs.statSync(chunk.file).size : 0;
    if (chunk.have > chunk.size) throw new Error('Oversized model chunk.');
    received += chunk.have;
  }
  // Final atomic adoption requires an assembled file as well as the chunks.
  if (BigInt(freeBytes(directory)) < BigInt(2 * asset.size - received)) throw Object.assign(new Error('Insufficient project disk space for verified model assembly.'), { code: 'ENOSPC' });
  progress(`${model.id}/${asset.name}: ${received}/${asset.size} bytes, ${connections} bounded range connections`);
  let cursor = 0, failed = false;
  const workers = Array.from({ length: Math.min(connections, chunks.length) }, async () => {
    while (!failed && cursor < chunks.length) {
      const chunk = chunks[cursor++];
      if (chunk.have === chunk.size) continue;
      let error;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          assertContained(paths.models, chunk.file);
          const have = fs.existsSync(chunk.file) ? fs.statSync(chunk.file).size : 0;
          if (have === chunk.size) { error = null; break; }
          const start = chunk.start + have;
          const response = await open(new URL(asset.url || asset.remote || asset.name, model.base), start, chunk.end);
          const expected = `bytes ${start}-${chunk.end}/${asset.size}`;
          if (response.statusCode !== 206 || response.headers['content-range'] !== expected) { response.destroy(); throw new Error(`Model chunk range mismatch: HTTP ${response.statusCode}, expected ${expected}, received ${String(response.headers['content-range']).slice(0, 100)}.`); }
          let count = have;
          const counter = new Transform({ transform(data, _encoding, callback) {
            count += data.length;
            if (count > chunk.size) return callback(new Error('Model chunk exceeded expected size.'));
            received += data.length;
            if (Date.now() - lastReport >= 5000) { lastReport = Date.now(); progress(`${model.id}/${asset.name}: ${received}/${asset.size} bytes (${(100 * received / asset.size).toFixed(1)}%)`); }
            callback(null, data);
          } });
          assertContained(paths.models, chunk.file);
          await pipeline(response, counter, fs.createWriteStream(chunk.file, { flags: have ? 'a' : 'w' }));
          if (fs.statSync(chunk.file).size !== chunk.size) throw new Error('Truncated model chunk.');
          error = null; break;
        } catch (caught) {
          error = caught;
          if (caught.code === 'ENOSPC') break;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
      if (error) { failed = true; throw error; }
    }
  });
  const results = await Promise.allSettled(workers);
  const rejection = results.find(item => item.status === 'rejected');
  if (rejection) throw rejection.reason;
  async function* contents() { for (const chunk of chunks) { assertContained(paths.models, chunk.file); for await (const data of fs.createReadStream(chunk.file)) yield data; } }
  assertContained(paths.models, partial);
  await pipeline(Readable.from(contents()), fs.createWriteStream(partial, { flags: 'wx' }));
  let result;
  try { result = await verify(partial, asset); }
  catch (error) {
    const suffix = `.invalid-${crypto.randomUUID()}`;
    assertContained(paths.models, partial); assertContained(paths.models, directory);
    fs.renameSync(partial, assertContained(paths.models, partial + suffix));
    fs.renameSync(directory, assertContained(paths.models, directory + suffix));
    throw error;
  }
  assertContained(paths.models, target);
  if (fs.existsSync(target)) throw new Error('Model destination appeared during assembly.');
  fs.renameSync(partial, target);
  assertContained(paths.models, directory); fs.rmSync(directory, { recursive: true });
  progress(`${model.id}/${asset.name}: verified ${asset.size} bytes, SHA256 ${result.sha256}`);
  return result;
}

function selectModels(args) {
  if (args.length === 1 && args[0] === '--all') return manifest;
  if (!args.length || new Set(args).size !== args.length || args.some(id => !manifest.some(model => model.id === id))) throw new Error('Usage: node scripts/download-models.cjs --all | whisper-small silero-vad qwen-1.5b');
  return args.map(id => manifest.find(model => model.id === id));
}

async function main(args) {
  const models = selectModels(args);
  const paths = createPaths(path.resolve(__dirname, '..'));
  for (const model of models) {
    const files = [];
    for (const asset of model.files) files.push({ ...await downloadAsset({ paths, model, asset }), downloadHost: new URL(asset.url || model.base).hostname, downloadRevision: asset.downloadRevision || model.revision });
    const receipt = { schemaVersion: 1, id: model.id, source: model.source, revision: model.revision, license: model.license, verifiedAt: new Date().toISOString(), files };
    const target = assertContained(paths.models, path.join(paths.models, model.directory, 'murmur-download.json'));
    const temporary = assertContained(paths.models, `${target}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    assertContained(paths.models, target);
    fs.renameSync(temporary, target);
    console.log(`${model.id}: all files verified; receipt saved under models.`);
  }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { allowedUrl, rangeStart, verify, downloadAsset, downloadSegmented, selectModels };
