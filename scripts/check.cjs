'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
let count=0;
for(const folder of ['core','desktop','renderer','scripts','tests']){
  if(!fs.existsSync(path.join(root,folder)))continue;
  for(const name of fs.readdirSync(path.join(root,folder))){
    if(!/\.(cjs|js)$/.test(name))continue;
    const file=path.join(root,folder,name);
    const source=fs.readFileSync(file,'utf8');
    if(/\?{5,}|\uFFFD/.test(source))throw new Error(`Possible UTF-8 damage: ${file}`);
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
    if(result.status!==0){process.stderr.write(result.stderr);process.exitCode=1;}count++;
  }
}
const documents=['agent.md','AGENTS.md','README.md',...fs.readdirSync(path.join(root,'docs')).filter(name=>name.endsWith('.md')).map(name=>`docs/${name}`)];
for(const file of documents){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  if(/\?{5,}|\uFFFD/.test(source))throw new Error(`Possible UTF-8 damage: ${file}`);
}
console.log(`Checked ${count} JavaScript files and ${documents.length} documents; UTF-8 text re-read completed.`);
