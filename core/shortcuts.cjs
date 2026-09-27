'use strict';

const DEFAULT_SHORTCUT = 'RightAlt';
const MODIFIERS = Object.freeze({ CommandOrControl: 'Control', Control: 'Control', Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Super: 'Super', Command: 'Super' });
const KEY_CODES = Object.freeze({ Space: 32, Tab: 9, Enter: 13, Backspace: 8, Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34, Up: 38, Down: 40, Left: 37, Right: 39 });
const LABELS = Object.freeze({ CommandOrControl: 'Ctrl', Control: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win', Command: 'Win',
  Space: '空格', Enter: '回车', Backspace: '退格', Delete: '删除', Insert: '插入', Up: '↑', Down: '↓', Left: '←', Right: '→' });
const signature = (modifiers, key) => [...modifiers].sort().join('+') + '+' + key;
const RESERVED = new Set([
  [['Control'], 'V'], [['Alt'], 'F4'], [['Alt'], 'Tab'], [['Alt'], 'Escape'],
  [['Control'], 'Escape'], [['Control', 'Shift'], 'Escape'], [['Control', 'Alt'], 'Delete'],
  ...['L', 'D', 'E', 'R', 'I', 'U', 'A', 'S', 'X', 'M', 'V', 'Tab', 'Space'].map(key => [['Super'], key]),
  [['Super', 'Shift'], 'M'], ...['D', 'F4', 'Left', 'Right'].map(key => [['Super', 'Control'], key]),
].map(([modifiers, key]) => signature(modifiers, key)));

function invalid(message = '快捷键格式无效。请使用右 Alt、F1–F24（F12 除外），或修饰键与受支持按键的组合。') {
  const error = new Error(message);
  error.code = 'INVALID_SETTINGS';
  throw error;
}

function parseShortcut(value, { allowReserved = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\u0000-\u001f]/u.test(value)) invalid();
  const result = value.trim();
  if (result === DEFAULT_SHORTCUT) return { value: result, kind: 'native', keyCode: 165 };
  const parts = result.split('+');
  const key = parts.pop();
  const modifiers = parts.map(part => {
    if (!Object.hasOwn(MODIFIERS, part)) invalid();
    return MODIFIERS[part];
  });
  const unique = new Set(modifiers);
  if (unique.size !== modifiers.length) invalid('快捷键包含重复修饰键或同义名称，请每种修饰键只使用一次。');
  const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(key);
  if (!functionKey && !Object.hasOwn(KEY_CODES, key) && !/^[A-Z0-9]$/u.test(key)) invalid();
  if (!modifiers.length && !functionKey) invalid('单独字符和普通按键不能用作全局录音快捷键。请添加修饰键，或使用右 Alt / 功能键。');
  if (!allowReserved) {
    if (key === 'F12') invalid('F12 保留给系统调试用途，请选择其他快捷键。');
    if (key === 'V' && unique.size === 1 && unique.has('Control')) invalid('Ctrl+V 用于系统粘贴和自动回填，不能设为录音快捷键。请使用右 Alt 等其他按键。');
    if (RESERVED.has(signature(unique, key))) invalid('此组合用于 Windows 系统操作，请选择其他录音快捷键。');
  }
  const keyCode = functionKey ? 111 + Number(key.slice(1)) : Object.hasOwn(KEY_CODES, key) ? KEY_CODES[key] : key.charCodeAt(0);
  return { value: result, kind: 'accelerator', keyCode };
}

function formatShortcut(value) {
  // A retained legacy reserved shortcut must remain displayable for correction.
  const parsed = parseShortcut(value, { allowReserved: true });
  if (parsed.kind === 'native') return '右 Alt';
  return parsed.value.split('+').map(part => LABELS[part] || part).join(' + ');
}

module.exports = { DEFAULT_SHORTCUT, parseShortcut, formatShortcut };
