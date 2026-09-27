'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('murmurOverlay',{onStatus:callback=>ipcRenderer.on('murmur:overlay-status',(_event,value)=>callback(value))});
