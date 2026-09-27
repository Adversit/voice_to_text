'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AppError, defaults, validateSettings } = require('./contracts.cjs');
const { DEFAULT_SHORTCUT } = require('./shortcuts.cjs');
const { assertContained } = require('./paths.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

function validateDelivery(delivery) {
  if (delivery === undefined) return { status: 'not-requested', reason: '' };
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)
    || !['pasted', 'copied', 'skipped', 'failed', 'not-requested'].includes(delivery.status)
    || typeof delivery.reason !== 'string' || delivery.reason.length > 2000) {
    throw new AppError('INVALID_HISTORY', '\u6587\u672c\u6295\u9012\u72b6\u6001\u683c\u5f0f\u65e0\u6548\u3002');
  }
  // Native target identity is ephemeral. Only these two public fields survive.
  return { status: delivery.status, reason: delivery.reason };
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || typeof record.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(record.id)
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.text !== 'string' || record.text.length > 20000
    || typeof record.rawText !== 'string' || record.rawText.length > 20000
    || !Number.isFinite(record.durationMs) || record.durationMs < 0 || record.durationMs > 120000
    || !['local', 'cloud', 'demo'].includes(record.source)
    || typeof record.model !== 'string' || record.model.length > 200
    || !Array.isArray(record.warnings) || record.warnings.some(item => typeof item !== 'string' || item.length > 2000)
    || (record.label !== undefined && (typeof record.label !== 'string' || record.label.length > 200))) {
    throw new AppError('INVALID_HISTORY', '\u5386\u53f2\u8bb0\u5f55\u683c\u5f0f\u65e0\u6548\u3002');
  }
  return { id: record.id, createdAt: record.createdAt, text: record.text, rawText: record.rawText, durationMs: record.durationMs,
    source: record.source, model: record.model, ...(record.label === undefined ? {} : { label: record.label }), warnings: [...record.warnings], delivery: validateDelivery(record.delivery) };
}

function createStore(paths, secretCodec) {
  let state = null;
  const location = () => {
    assertContained(paths.root, paths.data);
    return assertContained(paths.root, path.join(paths.data, 'state.json'));
  };
  const ready = () => {
    if (!state) throw new AppError('STORE_NOT_READY', '\u8bbe\u7f6e\u5c1a\u672a\u52a0\u8f7d\u5b8c\u6210\u3002');
  };
  function commit(next) {
    const destination = location();
    const temporary = assertContained(paths.root, `${destination}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8' });
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      location();
      fs.renameSync(temporary, destination);
      state = next;
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch { /* Retain original state on a failed commit. */ }
      if (error instanceof AppError) throw error;
      throw new AppError('STORE_WRITE_FAILED', '\u65e0\u6cd5\u4fdd\u5b58\u9879\u76ee\u8bbe\u7f6e\uff0c\u8bf7\u68c0\u67e5\u78c1\u76d8\u7a7a\u95f4\u548c\u6743\u9650\u3002');
    }
  }
  function init() {
    if (state) return;
    const destination = location();
    if (!fs.existsSync(destination)) {
      commit({ schemaVersion: 1, settings: defaults(), secrets: {}, history: [], migrations: { rightAltDefault: 1 } });
      return;
    }
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(destination, 'utf8').replace(/^\uFEFF/u, '')); }
    catch { throw new AppError('STORE_CORRUPT', '\u9879\u76ee\u8bbe\u7f6e\u6587\u4ef6\u65e0\u6cd5\u8bfb\u53d6\uff0c\u539f\u6587\u4ef6\u5df2\u4fdd\u7559\u3002'); }
    if (!parsed || parsed.schemaVersion !== 1) throw new AppError('UNSUPPORTED_SCHEMA', '\u9879\u76ee\u6570\u636e\u7248\u672c\u4e0d\u53d7\u652f\u6301\uff0c\u539f\u6587\u4ef6\u5df2\u4fdd\u7559\u3002');
    let next;
    let migrated = false;
    try {
      const missingShortcutMigration = !Object.hasOwn(parsed, 'migrations');
      if (!missingShortcutMigration && (!parsed.migrations || typeof parsed.migrations !== 'object' || Array.isArray(parsed.migrations)
        || Object.keys(parsed.migrations).length !== 1 || parsed.migrations.rightAltDefault !== 1)) throw new Error('Invalid migration state');
      const oldGeneral = parsed.settings?.general;
      const missingAutoPaste = oldGeneral && typeof oldGeneral === 'object' && !Array.isArray(oldGeneral) && !Object.hasOwn(oldGeneral, 'autoPaste');
      const replaceOldDefault = missingShortcutMigration && oldGeneral?.shortcut === 'CommandOrControl+Alt+Space';
      const settings = validateSettings(missingAutoPaste || replaceOldDefault
        ? { ...parsed.settings, general: { ...oldGeneral, ...(missingAutoPaste ? { autoPaste: true } : {}), ...(replaceOldDefault ? { shortcut: DEFAULT_SHORTCUT } : {}) } }
        : parsed.settings, { allowReservedShortcut: true });
      if (!parsed.secrets || typeof parsed.secrets !== 'object' || Array.isArray(parsed.secrets)
        || Object.entries(parsed.secrets).some(([key, value]) => !['asr', 'polish'].includes(key) || typeof value !== 'string' || !value || value.length > 65536)
        || !Array.isArray(parsed.history) || parsed.history.length > 200) throw new Error('Invalid state');
      const history = parsed.history.map(validateRecord);
      if (new Set(history.map(item => item.id)).size !== history.length) throw new Error('Duplicate record');
      next = { schemaVersion: 1, settings, secrets: { ...parsed.secrets }, history, migrations: { rightAltDefault: 1 } };
      migrated = missingShortcutMigration || Boolean(missingAutoPaste) || parsed.history.some(record => !Object.hasOwn(record, 'delivery'));
    } catch (error) {
      if (error.code === 'UNSUPPORTED_SCHEMA') throw error;
      throw new AppError('STORE_CORRUPT', '\u9879\u76ee\u6570\u636e\u683c\u5f0f\u5f02\u5e38\uff0c\u539f\u6587\u4ef6\u5df2\u4fdd\u7559\u3002');
    }
    // Assign in-memory state only after the additive migration is durably saved.
    if (migrated) commit(next);
    else state = next;
  }
  function getSettings() { ready(); return clone(state.settings); }
  function getPublicSettings() {
    const settings = getSettings();
    settings.asr.hasKey = Boolean(state.secrets.asr);
    settings.polish.hasKey = Boolean(state.secrets.polish);
    return settings;
  }
  function saveSettings(settings, keys = {}) {
    ready();
    const clean = validateSettings(settings);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).some(key => !['asr', 'polish'].includes(key))) throw new AppError('INVALID_KEYS', '\u5bc6\u94a5\u5b57\u6bb5\u65e0\u6548\u3002');
    const secrets = { ...state.secrets };
    for (const [name, value] of Object.entries(keys)) {
      if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f]/u.test(value)) throw new AppError('INVALID_KEYS', '\u5bc6\u94a5\u683c\u5f0f\u65e0\u6548\u3002');
      if (value === '') { delete secrets[name]; continue; }
      if (!secretCodec || !secretCodec.available()) throw new AppError('ENCRYPTION_UNAVAILABLE', '\u7cfb\u7edf\u52a0\u5bc6\u4e0d\u53ef\u7528\uff0c\u65e0\u6cd5\u4fdd\u5b58 API \u5bc6\u94a5\u3002');
      try {
        secrets[name] = secretCodec.encrypt(value);
        if (typeof secrets[name] !== 'string' || !secrets[name]) throw new Error('Invalid ciphertext');
      } catch { throw new AppError('ENCRYPTION_FAILED', '\u65e0\u6cd5\u5b89\u5168\u4fdd\u5b58 API \u5bc6\u94a5\u3002'); }
    }
    commit({ ...state, settings: clean, secrets });
    return getPublicSettings();
  }
  function getSecret(name) {
    ready();
    if (!['asr', 'polish'].includes(name)) throw new AppError('INVALID_KEYS', '\u5bc6\u94a5\u540d\u79f0\u65e0\u6548\u3002');
    if (!state.secrets[name]) return '';
    if (!secretCodec || !secretCodec.available()) throw new AppError('ENCRYPTION_UNAVAILABLE', '\u7cfb\u7edf\u52a0\u5bc6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5 Windows \u7528\u6237\u767b\u5f55\u72b6\u6001\u3002');
    try { return secretCodec.decrypt(state.secrets[name]); }
    catch { throw new AppError('DECRYPTION_FAILED', '\u65e0\u6cd5\u8bfb\u53d6\u5df2\u4fdd\u5b58\u7684\u5bc6\u94a5\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165\u3002'); }
  }
  function getHistory() { ready(); return clone(state.history); }
  function addHistory(record) {
    ready();
    const clean = validateRecord(record);
    if (state.history.some(item => item.id === clean.id)) throw new AppError('INVALID_HISTORY', '\u5386\u53f2\u8bb0\u5f55 ID \u91cd\u590d\u3002');
    commit({ ...state, history: [clean, ...state.history].slice(0, 200) });
    return clone(clean);
  }
  function updateHistory(id, patch) {
    ready();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(id)
      || !patch || typeof patch !== 'object' || Array.isArray(patch)
      || Object.keys(patch).some(key => !['delivery', 'warnings'].includes(key))
      || (Object.hasOwn(patch, 'delivery') && patch.delivery === undefined)) {
      throw new AppError('INVALID_HISTORY', '\u5386\u53f2\u8bb0\u5f55\u66f4\u65b0\u683c\u5f0f\u65e0\u6548\u3002');
    }
    const index = state.history.findIndex(record => record.id === id);
    if (index === -1) return null;
    const previous = state.history[index];
    const clean = validateRecord({ ...previous, ...patch });
    if (JSON.stringify(clean) === JSON.stringify(previous)) return clone(previous);
    const history = [...state.history];
    history[index] = clean;
    commit({ ...state, history });
    return clone(clean);
  }
  function deleteHistory(id) {
    ready();
    if (typeof id !== 'string' || id.length > 100) throw new AppError('INVALID_HISTORY', '\u5386\u53f2\u8bb0\u5f55 ID \u65e0\u6548\u3002');
    commit({ ...state, history: state.history.filter(item => item.id !== id) });
  }
  function clearHistory() { ready(); commit({ ...state, history: [] }); }
  return { init, getSettings, getPublicSettings, saveSettings, getSecret, getHistory, addHistory, updateHistory, deleteHistory, clearHistory };
}
module.exports = { createStore };
