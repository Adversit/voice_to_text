'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
async function run({app,mainWindow,projectRoot,paths,scan,snapshot,setTestTargetPid}){
  const out=path.join(projectRoot,'artifacts');fs.mkdirSync(out,{recursive:true});
  const results=[];
  const check=async(name,action)=>{try{await action();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.message});console.error('Smoke check failed:',name,error.message);}finally{fs.writeFileSync(path.join(out,'smoke-progress.json'),JSON.stringify(results,null,2),'utf8');}};
  const call=(method,payload)=>mainWindow.webContents.executeJavaScript(`window.murmur[${JSON.stringify(method)}](${JSON.stringify(payload)})`);
  await check('isolated preload and initial snapshot',async()=>{
    const result=await call('getSnapshot');assert.equal(result.ok,true);assert.equal(result.data.runtime.downloadsEnabled,false);
    assert.equal(await mainWindow.webContents.executeJavaScript('typeof require'),'undefined');
    assert.equal(result.data.paths.models,path.join(projectRoot,'artifacts','smoke-workspace','models'));
    // Restore only this isolated fixture after an interrupted prior run.
    assert.equal((await call('saveSettings',{settings:require('../core/contracts.cjs').defaults(),keys:{asr:'',polish:''}})).ok,true);
    assert.equal((await call('clearHistory')).ok,true);
  });
  await check('real hardware detection',async()=>{await scan();assert.ok(snapshot().hardware.cpu.name);assert.ok(snapshot().hardware.memory.totalGB>0);});
  await check('explicit demo routes through IPC, persists and copies',async()=>{
    const result=await call('demo');assert.equal(result.ok,true);assert.equal(result.data.record.source,'demo');assert.ok(result.data.text.length>0);
    const state=await call('getSnapshot');assert.ok(state.data.history.some(row=>row.id===result.data.record.id));
  });
  await check('JSON/TXT export and cancellation through IPC with simulated save selection',async()=>{
    const {dialog}=require('electron');const original=dialog.showSaveDialog;
    try{
      for(const format of ['json','txt']){
        const file=path.join(out,`export-test.${format}`);
        dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
        const result=await call('exportHistory',{format});assert.equal(result.ok,true);assert.equal(result.data.path,file);
        const text=fs.readFileSync(file,'utf8');const rows=(await call('getSnapshot')).data.history;
        if(format==='json')assert.deepEqual(JSON.parse(text).records,rows);
        else {assert.ok(text.includes(rows[0].text));assert.ok(text.includes(rows[0].delivery.status));}
      }
      dialog.showSaveDialog=async()=>({canceled:true});assert.equal((await call('exportHistory',{format:'txt'})).data.canceled,true);
    }finally{dialog.showSaveDialog=original;}
  });
  await check('settings round trip independent stages',async()=>{
    const settings=(await call('getSnapshot')).data.settings;settings.asr.language='en';settings.vad.mode='off';
    const changed=await call('saveSettings',{settings});assert.equal(changed.ok,true);assert.equal(changed.data.settings.asr.language,'en');assert.equal(changed.data.settings.vad.mode,'off');
  });
  await check('empty audio rejected, not replaced with demo',async()=>{
    const result=await mainWindow.webContents.executeJavaScript('window.murmur.transcribe({audio:new ArrayBuffer(0),durationMs:0})');assert.equal(result.ok,false);
  });
  await check('Windows encrypted credential round trip without exposing key',async()=>{
    const settings=(await call('getSnapshot')).data.settings;
    const saved=await call('saveSettings',{settings,keys:{asr:'smoke-test-key-not-a-real-secret'}});
    assert.equal(saved.ok,true);assert.equal(saved.data.settings.asr.hasKey,true);
    assert.equal(JSON.stringify(saved).includes('smoke-test-key'),false);
    const disk=fs.readFileSync(path.join(projectRoot,'artifacts','smoke-workspace','data','state.json'),'utf8');
    assert.equal(disk.includes('smoke-test-key'),false);
    assert.equal((await call('saveSettings',{settings,keys:{asr:''}})).ok,true);
  });
  await check('synthetic microphone records PCM16 16k WAV and releases every track',async()=>{
    const result=await mainWindow.webContents.executeJavaScript(`(async()=>{
      const {MicrophoneRecorder}=await import('murmur://app/renderer/audio.js');
      const recorder=new MicrophoneRecorder();await recorder.start();
      const tracks=recorder.stream.getTracks();await new Promise(resolve=>setTimeout(resolve,750));
      const recording=recorder.stop();const view=new DataView(recording.audio);
      return {duration:recording.durationMs,rate:view.getUint32(24,true),channels:view.getUint16(22,true),bits:view.getUint16(34,true),ended:tracks.every(track=>track.readyState==='ended')};
    })()`);
    assert.ok(result.duration>=300);assert.equal(result.rate,16000);assert.equal(result.channels,1);assert.equal(result.bits,16);assert.equal(result.ended,true);
  });
  await check('renderer contains navigation and populated content',async()=>{
    const body=await mainWindow.webContents.executeJavaScript('document.body.innerText');assert.ok(body.includes('Murmur'));assert.ok(body.length>100);
  });
  await check('recording session rejects stale/empty readiness and cancels cleanly',async()=>{
    assert.equal((await call('recordingReady',{})).ok,false);
    const first=await call('beginRecording',{trigger:'button'});assert.equal(first.ok,true);
    assert.equal((await call('beginRecording',{trigger:'button'})).ok,false);
    assert.equal((await call('cancelRecording',{sessionId:first.data.sessionId})).ok,true);
    assert.equal((await call('recordingReady',{sessionId:first.data.sessionId})).ok,false);
  });
  await check('monitoring IPC samples real resources, pauses and records content-free tasks',async()=>{
    const result=await call('refreshMonitoring');assert.equal(result.ok,true);assert.ok(result.data.samples.length>0);
    const sample=result.data.samples.at(-1);assert.ok(sample.memoryTotalGB>0);assert.ok(sample.appMemoryMB>0);
    assert.ok(result.data.tasks.some(task=>task.kind==='demo'));
    assert.ok(result.data.tasks.some(task=>task.status==='failed'));
    assert.ok(result.data.tasks.some(task=>task.status==='canceled'));
    assert.equal((await call('setMonitoring',{paused:true})).data.paused,true);
    assert.equal((await call('setMonitoring',{paused:false})).data.paused,false);
    assert.equal((await call('setMonitoring',{paused:'yes'})).ok,false);
    const begin=await call('beginRecording',{trigger:'button'});assert.equal(begin.ok,true);
    assert.equal((await call('cancelRecording',{sessionId:begin.data.sessionId,reason:'microphone'})).ok,true);
    const task=(await call('getMonitoring')).data.tasks[0];assert.equal(task.errorCode,'MICROPHONE_UNAVAILABLE');assert.equal(task.status,'failed');
    const disk=fs.readFileSync(path.join(paths.data,'monitor.json'),'utf8');
    for(const forbidden of ['smoke-test-key','rawText','processStartTicks','audioBase64','Synthetic dictation only.'])assert.equal(disk.includes(forbidden),false,forbidden);
    assert.equal(result.data.health.find(item=>item.id==='asr').state,'missing');
  });
  await check('all six desktop pages render and expose functional controls',async()=>{
    for(const page of ['models','device','history','settings','monitor','workbench']){
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-nav="${page}"]').click()`);
      await new Promise(resolve=>setTimeout(resolve,280));
      const content=await mainWindow.webContents.executeJavaScript('document.querySelector("#main").innerText');assert.ok(content.length>100,page);
      fs.writeFileSync(path.join(out,`screen-${page}.png`),(await mainWindow.webContents.capturePage()).toPNG());
      if(page==='monitor'){
        await mainWindow.webContents.executeJavaScript('document.querySelector("[data-action=toggle-monitor-task]").click();document.querySelector(".monitor-task-section").scrollIntoView({block:"start",behavior:"instant"})');
        await new Promise(resolve=>setTimeout(resolve,150));
        assert.ok(await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".stage-timeline"))'));
        fs.writeFileSync(path.join(out,'screen-monitor-tasks.png'),(await mainWindow.webContents.capturePage()).toPNG());
        await mainWindow.webContents.executeJavaScript('document.querySelector("#main").scrollTop=0');
      }
    }
  });
  await require('./shortcut-smoke.cjs').runShortcutSmoke({mainWindow,check,projectRoot});
  try{await require('./native-smoke.cjs').runNativeSmoke({mainWindow,projectRoot,paths,check,setTestTargetPid});}
  catch(error){results.push({name:'native fixture setup or cleanup',status:'FAIL',error:error.message});}
  const captured=await mainWindow.webContents.capturePage();fs.writeFileSync(path.join(out,'desktop-smoke.png'),captured.toPNG());
  const report={at:new Date().toISOString(),electron:process.versions.electron,packaged:app.isPackaged,results,hardware:snapshot().hardware};
  fs.writeFileSync(path.join(out,app.isPackaged?'desktop-smoke-packaged.json':'desktop-smoke.json'),JSON.stringify(report,null,2),'utf8');
  fs.writeFileSync(path.join(projectRoot,'docs',app.isPackaged?'TEST-PACKAGED.md':'TEST-DESKTOP-AUTO.md'),`# Windows desktop integration smoke\n\nRun: ${report.at}\nElectron: ${report.electron}\nPackaged executable: ${report.packaged}\n\n${results.map(r=>`- ${r.status}: ${r.name}${r.error?' — '+r.error:''}`).join('\n')}\n\nRuns actual Electron with isolated project-contained test storage. Microphone test uses Chromium synthetic audio, not the physical microphone. ASR response comes from a loopback test server. Real speech/model inference is not verified by this test. Save-dialog selection is simulated; export uses actual IPC and filesystem writes. The optional OS global shortcut check requires two real key chords from the Computer Use driver, with its observed input focused in the controlled test fixture.\n`,'utf8');
  console.log(JSON.stringify(report));
  if(results.some(r=>r.status==='FAIL'))throw new Error('Desktop smoke failed; see artifacts/desktop-smoke.json');
}
module.exports={run};
