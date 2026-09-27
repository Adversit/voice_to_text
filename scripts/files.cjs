'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {assertContained}=require('../core/paths.cjs');
function safe(root,target){
  const resolved=assertContained(root,target);
  if(fs.lstatSync(resolved,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Build inputs and outputs must not be symbolic links or junctions.');
  return resolved;
}
function copyContained(root,source,target){
  safe(root,source);safe(root,target);
  if(fs.statSync(source).isDirectory()){
    fs.mkdirSync(target,{recursive:true});safe(root,target);
    for(const name of fs.readdirSync(source))copyContained(root,path.join(source,name),path.join(target,name));
  } else fs.copyFileSync(source,target);
}
module.exports={safe,copyContained};
