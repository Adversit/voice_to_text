'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {assertContained}=require('../core/paths.cjs');
function resolveAsset(appRoot,address){
  const url=new URL(address);
  const rel=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(url.protocol!=='murmur:' || url.hostname!=='app' || url.username || url.password || url.port || !/^(renderer|assets)\/[a-zA-Z0-9_./-]+$/.test(rel))throw new Error('Invalid asset URL');
  const section=rel.split('/')[0];
  return assertContained(path.join(appRoot,section),path.join(appRoot,rel));
}
function projectDirectory(root,directory){
  const resolved=assertContained(root,directory);
  fs.mkdirSync(resolved,{recursive:true});
  return assertContained(root,resolved);
}
module.exports={resolveAsset,projectDirectory};
