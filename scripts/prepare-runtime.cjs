'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {safe}=require('./files.cjs');
const root=path.resolve(__dirname,'..');
const runtime=path.join(root,'runtime','electron');
function prepare(){
  safe(root,runtime);
  const exe=safe(root,path.join(runtime,'electron.exe'));
  if(fs.existsSync(exe)){
    validateRuntime(root,runtime);
    return exe;
  }
  if(process.platform!=='win32')throw new Error('This prototype runtime preparation supports Windows only.');
  const cacheRoot=path.join(process.env.LOCALAPPDATA || '', 'electron','Cache');
  const explicit=process.env.MURMUR_ELECTRON_ZIP;
  const name='electron-v40.2.1-win32-x64.zip';
  let archive=explicit || path.join(cacheRoot,name);
  // Electron's official cache stores verified archives in checksum-named folders.
  // Prefer these over a loose ZIP that may be an interrupted download.
  if(!explicit && fs.existsSync(cacheRoot)){
    for(const dir of fs.readdirSync(cacheRoot,{withFileTypes:true})){const candidate=path.join(cacheRoot,dir.name,name);if(dir.isDirectory() && fs.existsSync(candidate)){archive=candidate;break;}}
  }
  if(!fs.existsSync(archive))throw new Error('No cached Electron runtime found. No download was attempted. Set MURMUR_ELECTRON_ZIP to a locally available Electron 40.2.1 Windows x64 ZIP.');
  if(fs.existsSync(runtime) && fs.readdirSync(runtime).length)throw new Error('Incomplete runtime directory. Move runtime/electron aside before preparing again; no files were deleted or downloaded.');
  fs.mkdirSync(runtime,{recursive:true});
  const ps="$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:MURMUR_ZIP, $env:MURMUR_DEST)";
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{env:{...process.env,MURMUR_ZIP:path.resolve(archive),MURMUR_DEST:runtime},stdio:'inherit',windowsHide:true});
  if(result.status!==0 || !fs.existsSync(exe))throw new Error('Failed to extract local Electron archive.');
  validateRuntime(root,runtime);
  console.log('Prepared desktop runtime from local cache. Downloaded 0 bytes.');
  return exe;
}
function validateRuntime(project,runtimeDir){
  safe(project,runtimeDir);
  for(const name of ['electron.exe','chrome_100_percent.pak','chrome_200_percent.pak','resources.pak','icudtl.dat','v8_context_snapshot.bin','snapshot_blob.bin','libEGL.dll','libGLESv2.dll','d3dcompiler_47.dll','ffmpeg.dll','locales/en-US.pak','version']){
    const file=safe(project,path.join(runtimeDir,name));
    if(!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size)throw new Error(`Incomplete Electron runtime: ${name} is missing. Move runtime/electron aside and prepare it again from a complete local ZIP.`);
  }
  if(fs.readFileSync(path.join(runtimeDir,'version'),'utf8').trim()!=='40.2.1')throw new Error('Expected cached Electron 40.2.1 runtime.');
}
if(require.main===module){try{console.log(prepare());}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepare,validateRuntime};
