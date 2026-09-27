'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const {prepare}=require('./prepare-runtime.cjs');
const {buildNative}=require('./build-native.cjs');
try{
  try{buildNative({includeFixture:process.argv.includes('--smoke-test')});}catch(error){console.warn('Automatic paste helper unavailable; clipboard mode remains available:',error.message);}
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  // This is the user-facing GUI, not a background helper. SW_HIDE suppresses
  // the first native window on Windows even when BrowserWindow.show() is used.
  const child=spawn(prepare(),[path.resolve(__dirname,'..'),...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:false});
  child.on('error',e=>{console.error(e.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}catch(e){console.error(e.message);process.exitCode=1;}
