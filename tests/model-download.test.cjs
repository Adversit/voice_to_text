'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createPaths, assertContained } = require('../core/paths.cjs');
const { allowedUrl, rangeStart, verify, downloadAsset, downloadSegmented, selectModels } = require('../scripts/download-models.cjs');

const repository = path.resolve(__dirname, '..');
const cache = assertContained(repository, path.join(repository, 'cache'));
function fixture(t) {
  fs.mkdirSync(cache, { recursive: true });
  const root = fs.mkdtempSync(path.join(cache, 'model-download-test-'));
  t.after(() => { assertContained(cache, root); fs.rmSync(root, { recursive: true, force: true }); });
  const paths = createPaths(root);
  const model = { id: 'fixture', directory: 'asr/fixture', base: 'https://huggingface.co/fixture/resolve/pinned/' };
  const asset = { name: 'model.bin', size: 3, sha256: crypto.createHash('sha256').update('abc').digest('hex') };
  const folder = path.join(paths.models, model.directory);
  fs.mkdirSync(folder, { recursive: true });
  return { paths, model, asset, target: path.join(folder, asset.name) };
}
function response(body, statusCode = 200, headers = {}) { return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers }); }

test('manual model CLI accepts only curated identifiers and approved HTTPS redirect destinations', () => {
  assert.equal(selectModels(['--all']).length, 3);
  assert.equal(selectModels(['silero-vad'])[0].id, 'silero-vad');
  for (const args of [[], ['../outside'], ['https://example.com'], ['--all', 'silero-vad'], ['silero-vad', 'silero-vad']]) assert.throws(() => selectModels(args));
  for (const url of ['https://huggingface.co/a', 'https://cas-bridge.xethub.hf.co/a', 'https://raw.githubusercontent.com/a', 'https://modelscope.cn/a', 'https://cdn-lfs-cn-1.modelscope.cn/a']) assert.ok(allowedUrl(url));
  for (const url of ['http://huggingface.co/a', 'https://evil-hf.co/a', 'https://huggingface.co.evil.test/a', 'https://user:pass@huggingface.co/a', 'https://huggingface.co:444/a', 'https://other.modelscope.cn/a', 'file:///C:/a']) assert.throws(() => allowedUrl(url));
});

test('resume accepts only matching Content-Range and handles server restart explicitly', () => {
  assert.equal(rangeStart({ statusCode: 200, headers: {} }, 1, 3), 0);
  assert.equal(rangeStart({ statusCode: 206, headers: { 'content-range': 'bytes 1-2/3' } }, 1, 3), 1);
  for (const range of ['bytes 0-2/3', 'bytes 1-3/3', 'bytes 1-2/4', 'bytes 1-2/*']) assert.throws(() => rangeStart({ statusCode: 206, headers: { 'content-range': range } }, 1, 3));
  assert.throws(() => rangeStart({ statusCode: 403, headers: {} }, 0, 3));
});

test('download resumes a partial, verifies upstream SHA256 and adopts only complete content', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.target}.part`, 'a');
  const result = await downloadAsset({ ...f, progress() {}, open: async (_url, offset) => { assert.equal(offset, 1); return response('bc', 206, { 'content-range': 'bytes 1-2/3' }); } });
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'abc');
  assert.equal(fs.existsSync(`${f.target}.part`), false);
  assert.equal(result.sha256, f.asset.sha256);
});

test('a server ignoring Range causes a clean restart, never duplicate appended bytes', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.target}.part`, 'x');
  await downloadAsset({ ...f, progress() {}, open: async () => response('abc') });
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'abc');
});

test('verified complete files skip network and conflicting complete files remain untouched', async t => {
  const f = fixture(t); fs.writeFileSync(f.target, 'abc');
  let calls = 0;
  const open = async () => { calls++; return response('abc'); };
  await downloadAsset({ ...f, progress() {}, open });
  assert.equal(calls, 0);
  fs.writeFileSync(f.target, 'xyz');
  await assert.rejects(downloadAsset({ ...f, progress() {}, open }), /Hash mismatch/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'xyz');
  assert.equal(calls, 0);
});

test('Git blob hash validates small upstream files while receipt also records SHA256', async t => {
  const f = fixture(t); fs.writeFileSync(f.target, 'abc');
  const gitBlob = crypto.createHash('sha1').update('blob 3\0abc').digest('hex');
  const result = await verify(f.target, { name: 'model.bin', size: 3, gitBlob });
  assert.equal(result.upstreamHashType, 'git-blob-sha1');
  assert.equal(result.sha256, f.asset.sha256);
  await assert.rejects(verify(f.target, { name: 'model.bin', size: 3, gitBlob: '0'.repeat(40) }), /Hash mismatch/);
});

test('corrupt complete transfers have bounded retries and never become installed', async t => {
  const f = fixture(t); let calls = 0;
  await assert.rejects(downloadAsset({ ...f, progress() {}, open: async () => { calls++; return response('xyz'); } }), /Hash mismatch/);
  assert.equal(calls, 3);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.readdirSync(path.dirname(f.target)).filter(name => name.includes('.invalid-')).length, 3);
});

test('model download rejects a junction escape before invoking transport', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  const link = path.join(f.paths.models, 'escaped');
  fs.symlinkSync(cache, link, 'junction');
  let calls = 0;
  try { await assert.rejects(downloadAsset({ ...f, model: { ...f.model, directory: 'escaped' }, progress() {}, open: async () => { calls++; return response('abc'); } }), { code: 'UNSAFE_PATH' }); }
  finally { fs.unlinkSync(link); }
  assert.equal(calls, 0);
});

test('insufficient space checks remaining bytes before transport and preserves partial', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.target}.part`, 'a'); let calls = 0;
  await assert.rejects(downloadAsset({ ...f, progress() {}, freeBytes: () => 1n, open: async () => { calls++; return response('bc'); } }), { code: 'ENOSPC' });
  assert.equal(calls, 0); assert.equal(fs.readFileSync(`${f.target}.part`, 'utf8'), 'a'); assert.equal(fs.existsSync(f.target), false);
});

test('ENOSPC during transfer is surfaced without retry or adopting partial content', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.target}.part`, 'a'); let calls = 0;
  await assert.rejects(downloadAsset({ ...f, progress() {}, open: async () => { calls++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } }), { code: 'ENOSPC' });
  assert.equal(calls, 1); assert.equal(fs.readFileSync(`${f.target}.part`, 'utf8'), 'a'); assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.existsSync(`${f.target}.download-lock.json`), false);
});

test('parallel ranges reuse a sequential checkpoint and assemble in byte order with final hash verification', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.target}.part`, 'a'); const calls = [];
  await downloadSegmented({ ...f, chunkSize: 2, connections: 2, progress() {}, open: async (_url, start, end) => {
    calls.push([start, end]); return response('abc'.slice(start, end + 1), 206, { 'content-range': `bytes ${start}-${end}/3` });
  } });
  assert.deepEqual(calls.sort((a, b) => a[0] - b[0]), [[1, 1], [2, 2]]);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'abc'); assert.equal(fs.existsSync(`${f.target}.chunks`), false);
});

test('parallel transfer can split older larger checkpoints without downloading them again', async t => {
  const f = fixture(t); const folder = `${f.target}.chunks`; fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, '000000000000.part'), 'abc');
  let calls = 0;
  await downloadSegmented({ ...f, chunkSize: 2, connections: 2, progress() {}, open: async () => { calls++; throw new Error('Unexpected download.'); } });
  assert.equal(calls, 0); assert.equal(fs.readFileSync(f.target, 'utf8'), 'abc');
});

test('parallel transfer never adopts assembled bytes that fail the official hash', async t => {
  const f = fixture(t);
  await assert.rejects(downloadSegmented({ ...f, chunkSize: 2, connections: 2, progress() {}, open: async (_url, start, end) => response('xyz'.slice(start, end + 1), 206, { 'content-range': `bytes ${start}-${end}/3` }) }), /Hash mismatch/);
  assert.equal(fs.existsSync(f.target), false); assert.equal(fs.existsSync(`${f.target}.part`), false); assert.equal(fs.existsSync(`${f.target}.chunks`), false);
  assert.equal(fs.readdirSync(path.dirname(f.target)).filter(name => name.includes('.invalid-')).length, 2);
  await downloadSegmented({ ...f, chunkSize: 2, connections: 2, progress() {}, open: async (_url, start, end) => response('abc'.slice(start, end + 1), 206, { 'content-range': `bytes ${start}-${end}/3` }) });
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'abc');
});

test('same-asset concurrent downloads are rejected until owner releases its lock', async t => {
  const f = fixture(t); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = downloadAsset({ ...f, progress() {}, open: async () => { entered(); await new Promise(resolve => { release = resolve; }); return response('abc'); } });
  await ready;
  await assert.rejects(downloadAsset({ ...f, progress() {}, open: async () => { throw new Error('Must not start a second transfer.'); } }), { code: 'DOWNLOAD_BUSY' });
  release(); await pending;
  assert.equal(fs.existsSync(`${f.target}.download-lock.json`), false);
});

test('stale lock fails clearly and preserves lock and checkpoint for explicit recovery', async t => {
  const f = fixture(t);
  fs.writeFileSync(`${f.target}.download-lock.json`, JSON.stringify({ pid: 2147483646, token: 'interrupted-test' }));
  fs.writeFileSync(`${f.target}.part`, 'a');
  await assert.rejects(downloadAsset({ ...f, progress() {}, open: async () => { throw new Error('Must not start.'); } }), { code: 'DOWNLOAD_STALE' });
  assert.equal(fs.readFileSync(`${f.target}.part`, 'utf8'), 'a'); assert.equal(fs.existsSync(`${f.target}.download-lock.json`), true);
});

test('release never removes a lock replaced by a different owner', async t => {
  const f = fixture(t);
  const lock = `${f.target}.download-lock.json`;
  await assert.rejects(downloadAsset({ ...f, progress() {}, open: async () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'replacement-owner' }));
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  } }), { code: 'ENOSPC' });
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'replacement-owner');
});

test('complete assembled checkpoint is verified and adopted without requiring duplicate disk space', async t => {
  const f = fixture(t); fs.writeFileSync(`${f.target}.part`, 'abc');
  await downloadSegmented({ ...f, chunkSize: 2, progress() {}, freeBytes: () => 0n, open: async () => { throw new Error('Must not download.'); } });
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'abc');
});
