'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const methods = ['getSnapshot', 'saveSettings', 'refreshHardware', 'transcribe', 'polishText', 'demo',
  'deleteHistory', 'clearHistory', 'exportHistory', 'copyText', 'openFolder', 'windowAction',
  'beginRecording','recordingReady','cancelRecording','getMonitoring','refreshMonitoring','setMonitoring'];
const api = Object.fromEntries(methods.map(name => [name, payload => ipcRenderer.invoke(`murmur:${name}`, payload)]));
for (const [method, channel] of Object.entries({onToggleRecording:'toggle-recording',onStateChanged:'state-changed',onNotice:'notice',onMonitoring:'monitoring'})) {
  api[method] = callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected callback');
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(`murmur:${channel}`, listener);
    return () => ipcRenderer.removeListener(`murmur:${channel}`, listener);
  };
}
contextBridge.exposeInMainWorld('murmur', Object.freeze(api));
