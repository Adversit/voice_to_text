'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const {prepare}=require('./prepare-runtime.cjs');
const {buildNative}=require('./build-native.cjs');
try{
  const apiSmoke=process.argv.includes('--api-smoke-test');
  if(!apiSmoke)try{buildNative({includeFixture:process.argv.includes('--smoke-test')});}catch(error){console.warn('Automatic paste helper unavailable; clipboard mode remains available:',error.message);}
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  // Normal launch is a user-facing GUI. The API-only fixture always stays hidden
  // and does not build or launch native input helpers.
  const child=spawn(prepare(),[path.resolve(__dirname,'..'),...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:apiSmoke});
  child.on('error',e=>{console.error(e.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}catch(e){console.error(e.message);process.exitCode=1;}
