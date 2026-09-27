const modifierCodes = {
  ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', MetaLeft: 'Super', MetaRight: 'Super',
};
const terminalCodes = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};
const displayNames = {
  RightAlt: '右 Alt', Control: 'Ctrl', Ctrl: 'Ctrl', CommandOrControl: 'Ctrl', Alt: 'Alt', Shift: 'Shift',
  Super: 'Win', Command: 'Win', Space: '空格', Enter: '回车', Backspace: '退格', Delete: '删除', Insert: '插入',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
};
const modifierOrder = ['Control', 'Alt', 'Shift', 'Super'];

export function formatShortcut(value) {
  return String(value || '').split('+').map(part => displayNames[part.trim()] || part.trim()).join(' + ');
}

function terminalForCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return Object.hasOwn(terminalCodes, code) ? terminalCodes[code] : null;
}

function isReserved(modifiers, key) {
  const signature = [...modifiers, key].join('+');
  if (['Control+V', 'Alt+F4', 'Alt+Tab', 'Control+Alt+Delete'].includes(signature)) return true;
  if (modifiers.length === 1 && modifiers[0] === 'Super' && ['L', 'D', 'E', 'R', 'I', 'U', 'A', 'S', 'X', 'M', 'V', 'Tab', 'Space'].includes(key)) return true;
  if (signature === 'Shift+Super+M') return true;
  return modifiers.join('+') === 'Control+Super' && ['D', 'F4', 'Left', 'Right'].includes(key);
}

export function shortcutFromCodes(codes) {
  const unique = [...new Set(codes)];
  if (unique.length === 1 && unique[0] === 'AltRight') return { ok: true, value: 'RightAlt' };
  const modifiers = modifierOrder.filter(modifier => unique.some(code => modifierCodes[code] === modifier));
  const terminals = unique.filter(code => !Object.hasOwn(modifierCodes, code));
  if (terminals.length !== 1) return { ok: false, message: '请使用单独右 Alt、一个功能键，或修饰键加一个按键。' };
  const key = terminalForCode(terminals[0]);
  if (!key) return { ok: false, message: '这个按键暂不支持。可使用字母、数字、功能键或常用导航键；独立 Fn 无法录入。' };
  if (key === 'F12') return { ok: false, message: 'F12 是系统保留按键，请选择其他快捷键。' };
  if (!modifiers.length && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return { ok: false, message: '普通按键需要搭配 Ctrl、Alt、Shift 或 Win，避免影响日常输入。' };
  if (isReserved(modifiers, key)) return { ok: false, message: '此组合用于系统操作或粘贴，请换一个快捷键。' };
  return { ok: true, value: [...modifiers, key].join('+') };
}

export function createShortcutCaptureState() {
  const pressed = new Set();
  const chord = new Set();
  let altGraph = false;
  let composing = false;
  const reset = () => { pressed.clear(); chord.clear(); altGraph = false; composing = false; };
  const preview = () => [...chord].map(code => code === 'AltRight' && chord.size === 1 ? '右 Alt' : displayNames[modifierCodes[code] || terminalForCode(code)] || code).filter((part, index, list) => list.indexOf(part) === index).join(' + ');
  return {
    reset,
    preview,
    keydown(event) {
      if (event.code === 'Escape') { reset(); return { type: 'cancel' }; }
      if (event.repeat || !event.code) return { type: 'ignored' };
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229) { composing = true; return { type: 'ignored' }; }
      if (!chord.size) composing = false;
      if (event.getModifierState?.('AltGraph')) altGraph = true;
      pressed.add(event.code);
      chord.add(event.code);
      return { type: 'preview', label: preview() };
    },
    keyup(event) {
      if (!pressed.has(event.code)) return { type: 'ignored' };
      pressed.delete(event.code);
      if (pressed.size) return { type: 'preview', label: preview() };
      const result = altGraph ? { ok: false, message: '检测到 AltGr 字符输入组合，请换一个快捷键。' } : composing ? { ok: false, message: '输入法正在组合文字，请结束输入后重新按键。' } : shortcutFromCodes([...chord]);
      reset();
      return result.ok ? { type: 'candidate', value: result.value } : { type: 'invalid', message: result.message };
    },
  };
}
