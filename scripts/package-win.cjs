'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {prepare}=require('./prepare-runtime.cjs');
const {safe,copyContained}=require('./files.cjs');
const {buildNative}=require('./build-native.cjs');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'dist','Murmur');
try{
  prepare();buildNative();safe(root,target);fs.mkdirSync(target,{recursive:true});
  copyContained(root,path.join(root,'runtime','electron'),target);
  const electronExe=safe(root,path.join(target,'electron.exe')), appExe=safe(root,path.join(target,'Murmur.exe'));
  fs.copyFileSync(electronExe,appExe);fs.unlinkSync(electronExe);
  const destination=safe(root,path.join(target,'resources','app'));fs.mkdirSync(destination,{recursive:true});
  for(const item of ['desktop','core','renderer','assets','package.json'])copyContained(root,path.join(root,item),path.join(destination,item));
  fs.mkdirSync(safe(root,path.join(destination,'runtime')),{recursive:true});
  copyContained(root,path.join(root,'runtime','local_inference.py'),path.join(destination,'runtime','local_inference.py'));
  fs.mkdirSync(safe(root,path.join(destination,'runtime','native')),{recursive:true});
  copyContained(root,path.join(root,'runtime','native','Murmur.Input.exe'),path.join(destination,'runtime','native','Murmur.Input.exe'));
  copyContained(root,path.join(root,'runtime','native','Murmur.Shortcut.exe'),path.join(destination,'runtime','native','Murmur.Shortcut.exe'));
  // Keep writable models and data in the repository even after packaging.
  fs.writeFileSync(safe(root,path.join(destination,'project-root.json')),JSON.stringify({projectRoot:'../../../..'},null,2),'utf8');
  const icon=spawnSync('python',[path.join(root,'scripts','set-exe-icon.py'),appExe,path.join(root,'assets','icon.ico')],{stdio:'inherit',windowsHide:true});
  if(icon.status!==0)throw new Error('Windows executable icon could not be embedded. Python 3 is needed to package.');
  fs.writeFileSync(safe(root,path.join(target,'README.txt')),'Murmur 0.1.0 Windows prototype\r\nRun Murmur.exe. Keep this directory under the project dist folder.\r\nModels and user data remain in the project root. No model weights are included.\r\nThis development executable is unsigned.\r\n','utf8');
  console.log(`Built ${appExe}\nModel weights downloaded: 0. User data is excluded from the app bundle.`);
}catch(error){console.error(error.message);process.exitCode=1;}
