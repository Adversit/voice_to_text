'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createWindowsInput}=require('../core/windows-input.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(await predicate())return;await pause(30);}throw new Error('Native test target did not reach expected state');}
function syntheticTranscription(call,sessionId){
  return call(`(async()=>{const audio=new ArrayBuffer(16044);const view=new DataView(audio);const ascii=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i))};ascii(0,'RIFF');view.setUint32(4,16036,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,16000,true);for(let i=0;i<8000;i++)view.setInt16(44+2*i,Math.sin(i*.17)*4000,true);return window.murmur.transcribe({audio,durationMs:500,sessionId:${JSON.stringify(sessionId)}})})()`);
}
async function runNativeSmoke({mainWindow,projectRoot,paths,check,setTestTargetPid}){
  const call=source=>mainWindow.webContents.executeJavaScript(source);
  let activeSessionId=null;
  const invoke=async(name,payload)=>{
    const result=await call(`window.murmur[${JSON.stringify(name)}](${JSON.stringify(payload)})`);
    if(name==='beginRecording' && result.ok)activeSessionId=result.data.sessionId;
    return result;
  };
  const recordCheck=check;
  check=(name,action)=>recordCheck(name,async()=>{try{await action();}finally{if(activeSessionId){await invoke('cancelRecording',{sessionId:activeSessionId});activeSessionId=null;}}});
  const original=(await invoke('getSnapshot')).data.settings;
  const file=path.join(projectRoot,'artifacts',`native-paste-${Date.now()}.txt`);
  const fixture=path.join(projectRoot,'runtime','native','Murmur.PasteTarget.exe');
  const finalText='Murmur 自动回填验证\nSynthetic dictation only.';
  let child,readyResolve,buffer='';const awaiting=[];
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  let delayNext=false,releaseResponse=null;
  const server=http.createServer((request,response)=>{request.resume();request.on('end',()=>{const reply=()=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({text:finalText}));};if(delayNext){delayNext=false;releaseResponse=reply;}else reply();});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const input=createWindowsInput({paths,ownerPid:process.pid});
  const command=payload=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Native fixture command timed out')),3500);
    awaiting.push(value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify(payload)+'\n');
  });
  try{
    const settings=structuredClone(original);settings.asr.mode='local';settings.asr.engine='whisper-cpp';settings.asr.endpoint=`http://127.0.0.1:${server.address().port}`;settings.vad.mode='off';settings.polish.mode='off';settings.general.autoPaste=true;settings.general.shortcut='RightAlt';
    assert.equal((await invoke('saveSettings',{settings})).ok,true);
    mainWindow.show();mainWindow.focus();await pause(300);
    child=spawn(fixture,['--output',file],{windowsHide:false,stdio:['pipe','pipe','pipe']});
    setTestTargetPid(child.pid);
    child.stderr.resume();child.stdout.on('data',chunk=>{
      buffer+=chunk.toString('utf8');let end;
      while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const data=JSON.parse(line);if(data.ready)readyResolve(data.ready);else awaiting.shift()?.(data);}catch{}}
    });
    child.on('error',()=>readyResolve(null));child.on('exit',()=>readyResolve(null));
    assert.ok(await Promise.race([ready,pause(5000).then(()=>null)]),'Native fixture startup failed');
    if(process.argv.includes('--focus-native-test')){
      fs.writeFileSync(path.join(projectRoot,'artifacts','focus-check.json'),JSON.stringify({phase:'activate-fixture',pid:child.pid}));
      let focused=false;
      for(let attempt=0;attempt<150;attempt++){
        const capture=await input.capture();if(capture.target?.pid===child.pid){focused=true;break;}await pause(300);
      }
      assert.ok(focused,'Controlled fixture needs foreground focus; native tests cannot run safely');
    }
    if(process.argv.includes('--manual-hotkey-test'))await check('OS global shortcut starts and stops synthetic microphone with external input focused',async()=>{
      const marker=path.join(projectRoot,'artifacts','hotkey-check.json');
      const waitFor=async predicate=>{for(let i=0;i<900;i++){if(await predicate())return;await pause(100);}throw new Error('Global shortcut manual test timed out');};
      await command({command:'focus',field:'primary'});
      fs.writeFileSync(marker,JSON.stringify({phase:'press-start',pid:child.pid}));
      await waitFor(()=>call('Boolean(document.querySelector("#record-button.recording"))'));
      await pause(800);
      fs.writeFileSync(marker,JSON.stringify({phase:'press-stop',pid:child.pid}));
      await waitFor(()=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===finalText);
      await waitFor(()=>call('Boolean(document.querySelector("#record-button:not(:disabled):not(.recording)"))'));
      assert.equal((await invoke('getSnapshot')).data.history[0].delivery.status,'pasted');
      await command({command:'clear'});
      fs.writeFileSync(marker,JSON.stringify({phase:'passed'}));
    });
    await check('Right Alt native hook ignores left Alt, AltGr, chords and untrusted synthetic input',async()=>{
      const before=(await invoke('getMonitoring')).data.tasks.length;
      for(const scenario of ['left-alt','altgr','right-alt-chord','injected-right-alt']){
        await command({command:'focus',field:'primary'});
        assert.equal((await command({command:'shortcut',scenario})).ok,true,scenario);
        await pause(150);
        assert.equal(await call('Boolean(document.querySelector("#record-button.recording"))'),false,scenario);
        await command({command:'shortcut',scenario:'escape'});
      }
      assert.equal((await invoke('getMonitoring')).data.tasks.length,before);
      await command({command:'clear'});
    });
    await check('Right Alt release and repeat suppression preserve menu focus through actual hook -> recording -> paste',async()=>{
      try{
        await command({command:'focus',field:'primary'});
        const first=await command({command:'shortcut',scenario:'right-alt'});
        assert.equal(first.ok,true);assert.equal(first.menuActivations,0);assert.equal(first.primaryFocused,true);
        await until(()=>call('Boolean(document.querySelector("#record-button.recording"))'));
        await pause(800);
        const second=await command({command:'shortcut',scenario:'right-alt-repeat'});
        assert.equal(second.ok,true);assert.equal(second.menuActivations,0);assert.equal(second.primaryFocused,true);
        await until(()=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===finalText);
        await until(()=>call('Boolean(document.querySelector("#record-button:not(:disabled):not(.recording)"))'));
        assert.equal((await invoke('getSnapshot')).data.history[0].delivery.status,'pasted');
        await pause(250);assert.equal(await call('Boolean(document.querySelector("#record-button.recording"))'),false);
        await command({command:'clear'});
      }finally{
        await call('document.querySelector("[data-action=cancel-recording]")?.click()');await pause(150);
      }
    });
    await check('custom F8 accelerator saves, toggles and returns to native Right Alt',async()=>{
      const configured=(await invoke('getSnapshot')).data.settings;
      try{
        const custom=structuredClone(configured);custom.general.shortcut='F8';
        assert.equal((await invoke('saveSettings',{settings:custom})).ok,true);
        await command({command:'focus',field:'primary'});
        assert.equal((await command({command:'shortcut',scenario:'f8'})).ok,true);
        await until(()=>call('Boolean(document.querySelector("#record-button.recording"))'));await pause(800);
        assert.equal((await command({command:'shortcut',scenario:'f8'})).ok,true);
        await until(()=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===finalText);
        await until(()=>call('Boolean(document.querySelector("#record-button:not(:disabled):not(.recording)"))'));
        assert.equal((await invoke('getSnapshot')).data.history[0].delivery.status,'pasted');
        await command({command:'clear'});
      }finally{
        await call('document.querySelector("[data-action=cancel-recording]")?.click()');await pause(150);
        const restored=await invoke('saveSettings',{settings:configured});assert.equal(restored.ok,true);assert.equal(restored.data.runtime.shortcutRegistered,true);
      }
    });
    await check('real Windows paste into controlled input via session -> loopback ASR -> clipboard -> SendInput',async()=>{
      await command({command:'focus',field:'primary'});
      const begin=await invoke('beginRecording',{trigger:'shortcut'});assert.equal(begin.ok,true);assert.equal(begin.data.autoPasteEligible,true,begin.data.reason);
      assert.equal((await invoke('recordingReady',{sessionId:begin.data.sessionId})).ok,true);
      const result=await syntheticTranscription(call,begin.data.sessionId);assert.equal(result.ok,true,result.error?.message);assert.equal(result.data.record.delivery.status,'pasted',result.data.record.delivery.reason);
      await until(()=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===finalText);
      const state=(await invoke('getSnapshot')).data;assert.equal(state.history[0].delivery.status,'pasted');assert.equal(JSON.stringify(state).includes('processStartTicks'),false);
    });
    await check('changed focused input skips paste and retains transcript',async()=>{
      await command({command:'focus',field:'primary'});
      const begin=await invoke('beginRecording',{trigger:'shortcut'});assert.equal(begin.ok,true);
      await command({command:'focus',field:'secondary'});
      const result=await syntheticTranscription(call,begin.data.sessionId);assert.equal(result.ok,true);assert.equal(result.data.record.delivery.status,'skipped');
      const contents=await command({command:'read'});assert.equal(contents.secondary,'');assert.equal(contents.text.replace(/\r\n/g,'\n'),finalText);
    });
    await check('native capture rejects password and read-only test controls',async()=>{
      await command({command:'focus',field:'password'});assert.equal((await input.capture()).target,null);
      await command({command:'focus',field:'readonly'});assert.equal((await input.capture()).target,null);
    });
    await check('native clipboard hash mismatch sends no input',async()=>{
      await command({command:'focus',field:'primary'});const captured=await input.capture();assert.ok(captured.target,captured.reason);
      const result=await input.paste({target:captured.target,clipboardHash:'0'.repeat(64)});assert.equal(result.status,'skipped');
      assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),finalText);
    });
    await check('renderer reload interrupts monitoring and prevents late ASR auto-paste',async()=>{
      await command({command:'focus',field:'primary'});
      const begin=await invoke('beginRecording',{trigger:'shortcut'});assert.equal(begin.ok,true);assert.equal(begin.data.autoPasteEligible,true);
      const taskId=(await invoke('getMonitoring')).data.tasks[0].id;
      const historyId=(await invoke('getSnapshot')).data.history[0]?.id;
      // Destroying the renderer can abandon executeJavaScript's promise. Check
      // completion from the new renderer and durable records instead.
      delayNext=true;void syntheticTranscription(call,begin.data.sessionId).catch(()=>null);
      try{
        await until(()=>Boolean(releaseResponse));
        const loaded=new Promise(resolve=>mainWindow.webContents.once('did-finish-load',resolve));mainWindow.webContents.reload();await Promise.race([loaded,pause(8000).then(()=>{throw new Error('Renderer reload timed out');})]);
        releaseResponse();releaseResponse=null;
        await until(async()=>{const latest=(await invoke('getSnapshot')).data.history[0];return latest?.id!==historyId && latest?.delivery?.status==='skipped';});
        const task=(await invoke('getMonitoring')).data.tasks.find(row=>row.id===taskId);assert.equal(task.status,'interrupted');assert.equal(task.errorCode,'INTERRUPTED');
        assert.equal(task.stages.find(stage=>stage.name==='asr').status,'interrupted');
        assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),finalText);
      }finally{releaseResponse?.();releaseResponse=null;delayNext=false;}
    });
  }finally{
    setTestTargetPid(null);
    if(child && child.exitCode===null){child.stdin.end('exit\n');await Promise.race([new Promise(resolve=>child.once('close',resolve)),pause(1500)]);if(child.exitCode===null)child.kill();}
    await new Promise(resolve=>server.close(resolve));
    await invoke('saveSettings',{settings:original});
  }
}
module.exports={runNativeSmoke};
