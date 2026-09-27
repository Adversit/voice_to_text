'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {resolveAsset,projectDirectory}=require('../desktop/security.cjs');
const root=path.resolve(__dirname,'..');
test('desktop protocol serves only confined renderer and icon assets',()=>{
  assert.equal(resolveAsset(root,'murmur://app/renderer/app.js'),path.join(root,'renderer','app.js'));
  assert.equal(resolveAsset(root,'murmur://app/assets/icon.png'),path.join(root,'assets','icon.png'));
  for(const url of ['murmur://app/core/store.cjs','murmur://other/renderer/app.js','https://app/renderer/app.js','murmur://app/renderer%2f..%2fcore/providers.cjs','murmur://app/assets%2f..%2fpackage.json','murmur://app/renderer/%2e%2e/core/store.cjs','murmur://app/renderer%5c..%5ccore/store.cjs','murmur://user:password@app/renderer/app.js'])assert.throws(()=>resolveAsset(root,url));
});
test('Electron nested cache directories refuse junctions outside project',()=>{
  projectDirectory(root,path.join(root,'cache'));
  const base=fs.mkdtempSync(path.join(root,'cache','desktop-path-test-'));
  const outside=fs.mkdtempSync(path.join(root,'cache','desktop-outside-'));
  const link=path.join(base,'electron');
  try{fs.symlinkSync(outside,link,'junction');assert.throws(()=>projectDirectory(base,link));assert.equal(projectDirectory(base,path.join(base,'normal')),path.join(base,'normal'));}
  finally{fs.unlinkSync(link);fs.rmdirSync(path.join(base,'normal'));fs.rmdirSync(base);fs.rmdirSync(outside);}
});
test('protocol rejects symlink or junction asset escape',()=>{
  const link=path.join(root,'renderer','test-security-junction');
  assert.equal(fs.existsSync(link),false);
  try{fs.symlinkSync(path.join(root,'core'),link,'junction');assert.throws(()=>resolveAsset(root,'murmur://app/renderer/test-security-junction/store.cjs'));}
  finally{if(fs.lstatSync(link,{throwIfNoEntry:false}))fs.unlinkSync(link);}
});
