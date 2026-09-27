'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createStore}=require('../core/store.cjs');
const {defaults}=require('../core/contracts.cjs');
const {assertContained}=require('../core/paths.cjs');
let outcomes=[];
let reportWritten=false;

function prepareFixture({paths,projectRoot}){
  assert.equal(paths.root,path.join(projectRoot,'artifacts','api-smoke-workspace'));
  assertContained(projectRoot,paths.root);
  for(const name of ['state.json','monitor.json']){
    const file=assertContained(paths.root,path.join(paths.data,name));
    if(fs.existsSync(file)){assert(fs.statSync(file).isFile());fs.unlinkSync(file);}
  }
  outcomes=[];reportWritten=false;
}
function createBackends(){
  const counters={nativeStarts:0,nativeStops:0,acceleratorRegistrations:0,acceleratorRemovals:0};
  const listeners=new Set();
  return {counters,globalShortcut:{register(value){counters.acceleratorRegistrations++;listeners.add(value);return true;},unregister(value){counters.acceleratorRemovals++;listeners.delete(value);}},
    createNative(){return {async start(){counters.nativeStarts++;},async stop(){counters.nativeStops++;},setTestTargetPid(){}};}};
}
function writeReport(projectRoot){
  const passed=outcomes.filter(row=>row.status==='PASS').length;
  const failed=outcomes.filter(row=>row.status==='FAIL').length;
  const report=[ '# Hidden Electron API configuration smoke', '', `Date: ${new Date().toISOString()}.`, '',
    'Command: `node scripts/launch.cjs --api-smoke-test`', '',
    `Result: **${passed} passed, ${failed} failed**.`, '',
    '| Check | Result |', '| --- | --- |', ...outcomes.map(row=>`| ${row.name} | ${row.status}${row.code?` (${row.code})`:''} |`), '',
    'The isolated `artifacts/api-smoke-workspace` uses the real main/preload/renderer, validation/store and Windows safeStorage. The existing shortcut controller uses fake listener backends only in this launch mode; no real global shortcut/native keyboard helper is invoked. The only BrowserWindow remains hidden; no tray or overlay is created. Resource sampling and background hardware scan are skipped. Side-effect IPC is blocked, media permission is denied, and valid help links are blocked before shell opening.', '',
    'Synthetic credentials are encrypted into the isolated fixture and checked through a reopened real store; plaintext and ciphertext are not copied into this report or screenshot. No microphone/clipboard/paste/export/shell/network action is requested by the fixture. Settings changes do not create monitor tasks or history.', '',
    'Screenshot, if its check passed: `artifacts/api-settings.png`, captured from hidden webContents with empty credential fields. This verifies configuration behavior, not real supplier authentication, billable API requests, microphone accuracy, native shortcuts or local model inference.', '' ].join('\n');
  fs.writeFileSync(assertContained(projectRoot,path.join(projectRoot,'docs','TEST-API-DESKTOP.md')),report,'utf8');
  fs.writeFileSync(assertContained(projectRoot,path.join(projectRoot,'artifacts','api-smoke-results.json')),JSON.stringify(outcomes,null,2)+'\n','utf8');
  reportWritten=true;
}
function writeFailure({projectRoot,code='STARTUP_FAILED'}){
  if(reportWritten)return;
  outcomes.push({name:'Hidden fixture startup or execution',status:'FAIL',code:String(code).replace(/[^A-Z_a-z0-9]/g,'').slice(0,50)});
  writeReport(projectRoot);
}
async function run({app,mainWindow,paths,projectRoot,codec,backends}){
  const wc=mainWindow.webContents;
  const execute=source=>wc.executeJavaScript(source);
  const call=(name,payload)=>execute(`window.murmur[${JSON.stringify(name)}](${JSON.stringify(payload)})`);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label)=>{const until=Date.now()+6000;while(Date.now()<until){if(await predicate())return;await pause(40);}throw Object.assign(new Error(label),{code:'WAIT_TIMEOUT'});};
  const check=async(name,action)=>{
    try{await action();assert.equal(mainWindow.isVisible(),false);outcomes.push({name,status:'PASS'});}
    catch(error){outcomes.push({name,status:'FAIL',code:error.code || error.name});throw error;}
  };
  const timer=setTimeout(()=>{outcomes.push({name:'Bounded fixture completion',status:'FAIL',code:'TIMEOUT'});writeReport(projectRoot);app.exit(1);},90000);
  let everVisible=false;
  mainWindow.on('show',()=>{everVisible=true;mainWindow.hide();});
  const nodeValue=name=>execute(`document.querySelector('[name=${JSON.stringify(name)}]')?.value`);
  const edit=async(name,value)=>execute(`(()=>{const element=document.querySelector('[name=${JSON.stringify(name)}]');if(!element)throw new Error('Missing form field');if(element.type==='checkbox')element.checked=${JSON.stringify(value)};else element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const click=selector=>execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const settingsPage=async()=>{await wait(()=>execute('Boolean(document.querySelector("[data-nav=settings]"))'),'navigation');await click('[data-nav="settings"]');await wait(()=>execute('Boolean(document.querySelector("#settings-form"))'),'settings');};
  const saveUI=async()=>{
    await execute('document.querySelector("#settings-form").requestSubmit()');
    await wait(()=>execute('Boolean(document.querySelector("#save-state")?.textContent.includes("当前配置已载入") && !document.querySelector(".settings-fieldset")?.disabled)'),'save settings');
    const result=await call('getSnapshot');assert.equal(result.ok,true);return result.data;
  };
  const reload=async()=>{const loaded=new Promise(resolve=>wc.once('did-finish-load',resolve));wc.reload();await loaded;await settingsPage();};
  const reopened=()=>{const fresh=createStore(paths,codec);fresh.init();return fresh;};
  const keyStatus=()=>execute('document.querySelector("#asr-key-status")?.textContent');
  const secret='api-fixture-asr-synthetic-only';
  const polishSecret='api-fixture-polish-synthetic-only';
  let catalog;
  try{
    await check('Hidden isolated app, real preload and encryption available',async()=>{
      await wait(()=>execute('Boolean(window.murmur && document.querySelector("#record-button"))'),'renderer startup');
      const snap=(await call('getSnapshot')).data;catalog=snap.speechProviders;
      assert.equal(snap.paths.root,paths.root);assert.equal(snap.runtime.encryptionAvailable,true);
      assert.equal(snap.runtime.downloadsEnabled,false);assert.equal(snap.runtime.modelPreparation,'manual');
      assert.equal(await execute('typeof require'),'undefined');assert.equal(catalog.length,5);
      assert.equal(require('electron').BrowserWindow.getAllWindows().length,1);
      assert.equal(snap.monitor.tasks.length,0);assert.equal(snap.monitor.samples.length,0);assert.equal(snap.history.length,0);
      assert(backends.counters.nativeStarts>0);
    });
    await settingsPage();await edit('asr.mode','cloud');
    for(const provider of catalog){
      await check(`${provider.id}: UI preset defaults, save without key and reload`,async()=>{
        await edit('asr.provider',provider.id);
        assert.equal(await nodeValue('asr.endpoint'),provider.defaultEndpoint);
        assert.equal(await nodeValue('asr.apiModel'),provider.defaultModel);
        assert.equal(await execute('document.querySelector("[name=\\"asr.endpoint\\"]").tagName'),provider.id==='custom'?'INPUT':'SELECT');
        const snap=await saveUI();assert.equal(snap.settings.asr.provider,provider.id);assert.equal(snap.settings.asr.hasKey,false);
        assert.equal(snap.monitor.health.find(item=>item.id==='asr').state,'missing');
        await reload();assert.equal(await nodeValue('asr.provider'),provider.id);assert.equal(await nodeValue('asr.endpoint'),provider.defaultEndpoint);
        assert.equal(await keyStatus(),'待填写密钥');assert.equal(reopened().getSettings().asr.provider,provider.id);
      });
    }
    await check('Provider draft switch clears ASR key and preserves polish/shortcut drafts',async()=>{
      const initial=(await call('getSnapshot')).data.settings;initial.general.shortcut='Control+F8';
      assert.equal((await call('saveSettings',{settings:initial})).ok,true);await reload();
      await edit('polish.mode','cloud');await edit('polish.apiModel','fixture-polish-model');await edit('key.polish',polishSecret);
      await click('[data-action="reset-shortcut"]');
      await edit('key.asr',secret);await edit('clearKey.asr',true);await edit('asr.provider','siliconflow');
      assert.equal(await nodeValue('key.asr'),'');assert.equal(await execute('document.querySelector("[name=\\"clearKey.asr\\"]").checked'),false);
      assert.equal(await nodeValue('key.polish')===polishSecret,true);assert.equal(await nodeValue('polish.apiModel'),'fixture-polish-model');
      assert.equal(await execute('document.querySelector("#shortcut-display").textContent'),'右 Alt');
      const snap=await saveUI();assert.equal(snap.settings.asr.hasKey,false);assert.equal(snap.settings.general.shortcut,'RightAlt');
      assert.equal(reopened().getSecret('polish')===polishSecret,true);assert(backends.counters.acceleratorRegistrations>0);
    });
    await check('Real safeStorage encrypts ASR key and reopened store decrypts exact binding',async()=>{
      await edit('asr.provider','dashscope');await edit('key.asr',secret);
      const snap=await saveUI();assert.equal(snap.settings.asr.hasKey,true);
      assert.equal(reopened().getSecret('asr')===secret,true);
      const raw=fs.readFileSync(assertContained(paths.root,path.join(paths.data,'state.json')),'utf8');
      assert.equal(raw.includes(secret),false);assert.equal(raw.includes(polishSecret),false);
      const privateState=JSON.parse(raw);assert(privateState.secrets.asrProviders.dashscope.encrypted.length>0);
      assert.equal(JSON.stringify(snap).includes(privateState.secrets.asrProviders.dashscope.encrypted),false);
      assert.equal(JSON.stringify(snap).includes(secret),false);
      await reload();assert.equal(await keyStatus(),'已配置，尚未实际验证');assert.equal(await nodeValue('key.asr'),'');
    });
    await check('Region changes do not reuse stored or unsaved ASR keys',async()=>{
      const regions=catalog.find(provider=>provider.id==='dashscope').endpoints;
      await edit('key.asr',secret);await edit('clearKey.asr',true);await edit('asr.endpoint',regions[1].value);
      assert.equal(await nodeValue('key.asr'),'');assert.equal(await execute('document.querySelector("[name=\\"clearKey.asr\\"]").checked'),false);
      assert.equal(await keyStatus(),'待填写密钥');assert.equal((await saveUI()).settings.asr.hasKey,false);assert.equal(reopened().getSecret('asr'),'');
      await edit('asr.endpoint',regions[0].value);assert.equal((await saveUI()).settings.asr.hasKey,true);assert.equal(reopened().getSecret('asr')===secret,true);
    });
    await check('Custom endpoint casing/default-port exact binding matches UI and reopened store',async()=>{
      await edit('asr.provider','custom');await edit('asr.endpoint','https://API.example.invalid:443/v1');await edit('key.asr',secret);
      assert.equal((await saveUI()).settings.asr.hasKey,true);await reload();assert.equal(await keyStatus(),'已配置，尚未实际验证');
      await edit('asr.endpoint','https://api.example.invalid/v1');assert.equal(await keyStatus(),'待填写密钥');
      assert.equal((await saveUI()).settings.asr.hasKey,false);assert.equal(reopened().getSecret('asr'),'');
      await edit('asr.endpoint','https://API.example.invalid:443/v1/');assert.equal(await keyStatus(),'已配置，尚未实际验证');
      assert.equal((await saveUI()).settings.asr.hasKey,true);assert.equal(reopened().getSecret('asr')===secret,true);
    });
    await check('Same address under another provider cannot reuse a stored key',async()=>{
      await edit('asr.endpoint','https://api.openai.com/v1');await edit('key.asr',secret);assert.equal((await saveUI()).settings.asr.hasKey,true);
      await edit('asr.provider','openai');assert.equal(await nodeValue('asr.endpoint'),'https://api.openai.com/v1');
      assert.equal(await keyStatus(),'待填写密钥');assert.equal((await saveUI()).settings.asr.hasKey,false);assert.equal(reopened().getSecret('asr'),'');
    });
    await check('Invalid help requests reject; valid help never launches browser in fixture',async()=>{
      for(const payload of [{provider:'unknown',kind:'docs'},{provider:'openai',kind:'https://untrusted.invalid/'},{provider:'custom',kind:'key'},null]){
        const result=await call('openProviderLink',payload);assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ACTION');
      }
      const valid=await call('openProviderLink',{provider:'groq',kind:'docs'});assert.equal(valid.ok,false);assert.equal(valid.error.code,'TEST_SIDE_EFFECT_BLOCKED');
    });
    await check('Remove synthetic credentials; configuration creates no tasks or history',async()=>{
      for(const provider of catalog){const settings=defaults();Object.assign(settings.asr,{mode:'cloud',engine:'openai',provider:provider.id,endpoint:provider.defaultEndpoint,apiModel:provider.defaultModel});assert.equal((await call('saveSettings',{settings,keys:{asr:'',polish:''}})).ok,true);}
      const settings=defaults(),provider=catalog.find(item=>item.id==='dashscope');Object.assign(settings.asr,{mode:'cloud',engine:'openai',provider:provider.id,endpoint:provider.defaultEndpoint,apiModel:provider.defaultModel});
      const final=await call('saveSettings',{settings});assert.equal(final.ok,true);assert.equal(final.data.settings.asr.hasKey,false);
      const fresh=reopened();assert.equal(fresh.getSecret('asr'),'');assert.equal(fresh.getSecret('polish'),'');assert.deepEqual(fresh.getPublicSettings().asr.keyEndpoints,{});
      const monitor=(await call('getMonitoring')).data;assert.equal(monitor.health.find(item=>item.id==='asr').state,'missing');assert.equal(monitor.tasks.length,0);assert.equal(monitor.samples.length,0);assert.equal(final.data.history.length,0);
    });
    await check('Capture hidden settings screenshot with empty key fields and no shown window',async()=>{
      await reload();
      assert.equal(await execute('document.querySelector("[data-nav=settings]").getAttribute("aria-current")'),'page');
      assert.equal(await execute('document.querySelector("[data-nav=workbench]").classList.contains("active")'),false);
      // Hidden documents can retain an intermediate CSS transition frame.
      // Freeze motion only in this isolated screenshot, without showing it.
      await execute('(()=>{const style=document.createElement("style");style.textContent="*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";document.head.append(style);const main=document.querySelector("#main"),card=document.querySelectorAll(".settings-card")[1];main.scrollTop+=card.getBoundingClientRect().top-main.getBoundingClientRect().top-24;window.scrollTo(0,0);})()');await pause(100);
      assert.equal(await nodeValue('key.asr'),'');const capture=await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});assert.equal(capture.isEmpty(),false);
      fs.writeFileSync(assertContained(projectRoot,path.join(projectRoot,'artifacts','api-settings.png')),capture.toPNG());
      assert.equal(everVisible,false);assert.equal(mainWindow.isVisible(),false);assert.equal(require('electron').BrowserWindow.getAllWindows().length,1);
    });
  }finally{clearTimeout(timer);writeReport(projectRoot);}
  console.log(`API desktop smoke: ${outcomes.length} passed; report written to docs/TEST-API-DESKTOP.md`);
}
module.exports={prepareFixture,createBackends,run,writeFailure};
