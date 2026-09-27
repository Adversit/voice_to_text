'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {defaults,validateSettings}=require('../core/contracts.cjs');
const {getSpeechProviders}=require('../core/speech-apis.cjs');
const {createStore}=require('../core/store.cjs');
const {createPaths,assertContained}=require('../core/paths.cjs');
const root=path.resolve(__dirname,'..');
const codec={available:()=>true,encrypt:value=>Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value,'base64').toString('utf8')};
function setup(t,legacy){
  const base=fs.mkdtempSync(path.join(root,'cache','api-state-'));const paths=createPaths(base);
  t.after(()=>{assertContained(path.join(root,'cache'),base);fs.rmSync(base,{recursive:true,force:true});});
  const file=path.join(paths.data,'state.json');if(legacy)fs.writeFileSync(file,JSON.stringify(legacy),'utf8');
  const store=createStore(paths,codec);return {paths,file,store};
}
function cloud(settings,id){const info=getSpeechProviders().find(p=>p.id===id);return {...settings,asr:{...settings.asr,mode:'cloud',engine:'openai',provider:id,endpoint:info.defaultEndpoint,apiModel:info.defaultModel}};}
test('all four named APIs and custom validate without credentials; named hosts cannot be replaced',()=>{
  for(const id of ['openai','groq','siliconflow','dashscope','custom']){
    const settings=cloud(defaults(),id);assert.equal(validateSettings(settings).asr.provider,id);
    settings.asr.endpoint='https://different.example/v1';
    if(id==='custom')assert.doesNotThrow(()=>validateSettings(settings));else assert.throws(()=>validateSettings(settings),{code:'INVALID_ENDPOINT'});
  }
  const missing=defaults();delete missing.asr.provider;assert.throws(()=>validateSettings(missing),{code:'INVALID_SETTINGS'});
});
test('old settings/key migrate atomically to custom bound credential and preserve history/ciphertext',t=>{
  const settings=defaults();delete settings.asr.provider;settings.asr.mode='cloud';settings.asr.engine='openai';settings.asr.endpoint='https://legacy.example/v1';
  const encrypted=codec.encrypt('old-key');const original={schemaVersion:1,settings,secrets:{asr:encrypted,polish:codec.encrypt('polish')},history:[],migrations:{rightAltDefault:1}};
  const f=setup(t,original);f.store.init();assert.equal(f.store.getSettings().asr.provider,'custom');assert.equal(f.store.getSecret('asr'),'old-key');
  const disk=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(disk.secrets.asr,undefined);assert.deepEqual(disk.secrets.asrProviders.custom,{endpoint:settings.asr.endpoint,encrypted});
  assert.equal(disk.secrets.polish,original.secrets.polish);assert.deepEqual(disk.history,original.history);
  const again=createStore(f.paths,{available:()=>false});again.init();assert.equal(again.getPublicSettings().asr.hasKey,true);
});
test('provider changes never reuse keys; switching back restores its exact binding',t=>{
  const f=setup(t);f.store.init();let settings=cloud(f.store.getSettings(),'openai');f.store.saveSettings(settings,{asr:'openai-only',polish:'separate'});
  settings=cloud(settings,'groq');f.store.saveSettings(settings);assert.equal(f.store.getSecret('asr'),'');assert.equal(f.store.getPublicSettings().asr.hasKey,false);
  f.store.saveSettings(settings,{asr:'groq-only'});assert.equal(f.store.getSecret('asr'),'groq-only');
  settings=cloud(settings,'openai');f.store.saveSettings(settings);assert.equal(f.store.getSecret('asr'),'openai-only');assert.equal(f.store.getSecret('polish'),'separate');
  const publicState=JSON.stringify(f.store.getPublicSettings());assert.equal(publicState.includes('only'),false);assert.equal(publicState.includes('encrypted'),false);
  assert.deepEqual(Object.keys(f.store.getPublicSettings().asr.keyEndpoints).sort(),['groq','openai']);
});
test('custom endpoint and DashScope region changes invalidate key availability until bound again',t=>{
  const f=setup(t);f.store.init();let settings=cloud(defaults(),'custom');f.store.saveSettings(settings,{asr:'host-one'});
  settings.asr.endpoint='https://other.example/v1';f.store.saveSettings(settings);assert.equal(f.store.getSecret('asr'),'');assert.equal(f.store.getPublicSettings().asr.hasKey,false);
  settings=cloud(settings,'dashscope');f.store.saveSettings(settings,{asr:'beijing-key'});
  settings.asr.endpoint='https://dashscope-intl.aliyuncs.com/compatible-mode/v1';f.store.saveSettings(settings);assert.equal(f.store.getSecret('asr'),'');
});
test('explicit key removal only clears selected provider and public fields never persist',t=>{
  const f=setup(t);f.store.init();let settings=cloud(defaults(),'openai');f.store.saveSettings(settings,{asr:'one'});
  settings=cloud(settings,'groq');f.store.saveSettings(settings,{asr:'two'});f.store.saveSettings(f.store.getPublicSettings(),{asr:''});
  assert.equal(f.store.getSecret('asr'),'');f.store.saveSettings(cloud(settings,'openai'));assert.equal(f.store.getSecret('asr'),'one');
  const disk=fs.readFileSync(f.file,'utf8');assert.equal(disk.includes('hasKey'),false);assert.equal(disk.includes('keyEndpoints'),false);
});
test('ambiguous or corrupt bound credentials fail closed and preserve source bytes',t=>{
  for(const secrets of [{asrProviders:{unknown:{endpoint:'https://x.example',encrypted:'x'}}},{asrProviders:{openai:{endpoint:'https://evil.example',encrypted:'x'}}},{asr:'x',asrProviders:{custom:{endpoint:defaults().asr.endpoint,encrypted:'x'}}}]){
    const f=setup(t,{schemaVersion:1,settings:defaults(),secrets,history:[],migrations:{rightAltDefault:1}});const before=fs.readFileSync(f.file,'utf8');
    assert.throws(()=>f.store.init(),{code:'STORE_CORRUPT'});assert.equal(fs.readFileSync(f.file,'utf8'),before);assert.throws(()=>f.store.getSettings(),{code:'STORE_NOT_READY'});
  }
});
test('malformed binding addresses and impossible legacy preset bindings never migrate',t=>{
  const cases=['https://bad.example/\nv1',' https://bad.example/v1','https://bad.example/\\v1','https://bad.example/\u007fv1'].map(endpoint=>({settings:defaults(),secrets:{asrProviders:{custom:{endpoint,encrypted:'x'}}}}));
  cases.push({settings:{...defaults(),asr:{...defaults().asr,provider:'openai'}},secrets:{asr:'legacy'}});
  for(const sample of cases){
    const f=setup(t,{schemaVersion:1,...sample,history:[],migrations:{rightAltDefault:1}});const before=fs.readFileSync(f.file,'utf8');
    assert.throws(()=>f.store.init(),{code:'STORE_CORRUPT'});assert.equal(fs.readFileSync(f.file,'utf8'),before);
    assert.throws(()=>f.store.getSettings(),{code:'STORE_NOT_READY'});
  }
  for(const endpoint of ['https://bad.example/\\v1','https://bad.example/\u007fv1']){
    const settings=cloud(defaults(),'custom');settings.asr.endpoint=endpoint;
    assert.throws(()=>validateSettings(settings),{code:'INVALID_SETTINGS'});
  }
});
test('failed provider migration or key commit leaves prior bytes and binding unchanged',t=>{
  const f=setup(t);f.store.init();const first=cloud(defaults(),'openai');f.store.saveSettings(first,{asr:'first'});const before=fs.readFileSync(f.file,'utf8');
  const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('disk failure');};
  try{assert.throws(()=>f.store.saveSettings(cloud(first,'groq'),{asr:'second'}),{code:'STORE_WRITE_FAILED'});}finally{fs.renameSync=rename;}
  assert.equal(f.store.getSecret('asr'),'first');assert.equal(fs.readFileSync(f.file,'utf8'),before);
  const old=JSON.parse(before);delete old.settings.asr.provider;fs.writeFileSync(f.file,JSON.stringify(old),'utf8');const legacyBytes=fs.readFileSync(f.file,'utf8');const migrated=createStore(f.paths,codec);
  fs.renameSync=()=>{throw new Error('disk failure');};try{assert.throws(()=>migrated.init(),{code:'STORE_WRITE_FAILED'});}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(f.file,'utf8'),legacyBytes);assert.throws(()=>migrated.getSettings(),{code:'STORE_NOT_READY'});
});
