'use strict';
const {app,BrowserWindow,Tray,Menu,ipcMain,protocol,net,session,globalShortcut,clipboard,shell,dialog,nativeImage,safeStorage,screen} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createPaths,assertContained} = require('../core/paths.cjs');
const {createStore} = require('../core/store.cjs');
const {getModels} = require('../core/catalog.cjs');
const {detectHardware} = require('../core/hardware.cjs');
const {createProviders} = require('../core/providers.cjs');
const {validateSettings,AppError} = require('../core/contracts.cjs');
const {resolveAsset,projectDirectory} = require('./security.cjs');
const {randomUUID}=require('node:crypto');
const {createWindowsInput}=require('../core/windows-input.cjs');
const {deliverText}=require('../core/delivery.cjs');
const {createHotkeyGate}=require('./hotkey.cjs');
const {exportHistory}=require('../core/export.cjs');
const {createMonitor}=require('../core/monitor.cjs');
const appRoot = path.resolve(__dirname,'..');
const marker = path.join(appRoot,'project-root.json');
const isSmoke = process.argv.includes('--smoke-test');
let projectRoot, root, paths;
try {
  projectRoot=fs.existsSync(marker) ? path.resolve(appRoot,JSON.parse(fs.readFileSync(marker,'utf8')).projectRoot) : appRoot;
  if(JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8')).name!=='murmur-desktop')throw new Error('Invalid project root');
  root=isSmoke ? path.join(projectRoot,'artifacts','smoke-workspace') : projectRoot;
  fs.mkdirSync(root,{recursive:true});
  paths=createPaths(root);
} catch {
  dialog.showErrorBox('Murmur','无法定位或写入项目目录。请将应用保留在项目 dist/Murmur 目录内，并检查 project-root.json。不会改用系统目录。');
  process.exit(1);
}
try {
  app.setName('Murmur');
  app.setPath('userData',projectDirectory(paths.root,path.join(paths.data,'electron')));
  app.setPath('sessionData',projectDirectory(paths.root,path.join(paths.cache,'electron')));
  app.setPath('logs',projectDirectory(paths.root,path.join(paths.data,'logs')));
  app.setPath('crashDumps',projectDirectory(paths.root,path.join(paths.cache,'crashes')));
  app.setPath('temp',paths.temp);
} catch {
  dialog.showErrorBox('Murmur','项目缓存路径不可用或指向项目外。请检查 data 和 cache 目录。');
  process.exit(1);
}
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-background-networking');
if(isSmoke){
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
protocol.registerSchemesAsPrivileged([{scheme:'murmur',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let mainWindow, tray, store, providers, hardware=null, scanning=null, busy=false, quitting=false, ready=false, shortcutRegistered=false;
let windowsInput, recordingSession=null, overlay, overlayReady=false, overlayTimer, sessionEpoch=0;
let testTargetPid=null;
let monitor=null;
let activeTraceId=null;
let currentShortcut='';
const hotkeyGate=createHotkeyGate({trigger:toggleRecording,waitForRelease:args=>windowsInput.waitForKeyRelease(args),available:()=>Boolean(windowsInput?.available()),getAccelerator:()=>currentShortcut});
const codec = {available:()=>safeStorage.isEncryptionAvailable(),encrypt:value=>safeStorage.encryptString(value).toString('base64'),decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))};
function emit(channel,value){if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`murmur:${channel}`,value);}
function show(){if(!mainWindow)return;if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}
function monitorCall(method,...args){try{return monitor?.[method](...args);}catch{return null;}}
function appMemoryMB(){
  const rows=app.getAppMetrics();
  if(!rows.length || rows.some(row=>typeof row.memory?.workingSetSize!=='number' || !Number.isFinite(row.memory.workingSetSize) || row.memory.workingSetSize<0))return null;
  return rows.reduce((sum,row)=>sum+row.memory.workingSetSize,0)/1024;
}
function monitorSnapshot(){
  const result=monitorCall('snapshot');if(!result || !store)return result;
  const settings=store.getPublicSettings(),models=getModels(paths,hardware);
  const installed=id=>models.some(model=>model.id===id && model.installed);
  result.health=[
    {id:'asr',state:settings.asr.mode==='cloud'?(settings.asr.hasKey?'configured':'missing'):settings.asr.engine==='whisper-cpp'?'configured':installed(settings.asr.modelId)?'configured':'missing',detail:settings.asr.mode==='cloud'?'云端配置；实际连接与识别结果以任务记录为准。':settings.asr.engine==='whisper-cpp'?'本地服务地址已配置，未执行后台探测。':installed(settings.asr.modelId)?'已发现模型文件，加载与推理能力尚需实际验证。':'未发现完整模型文件，本阶段不会下载。'},
    {id:'vad',state:settings.vad.mode==='off'?'disabled':settings.vad.mode==='energy'?'ready':installed(settings.vad.modelId)?'configured':'missing',detail:settings.vad.mode==='off'?'本步骤已关闭。':settings.vad.mode==='energy'?'内置音量阈值检测，无需模型。':'Silero ONNX 文件状态；推理需另行验证。'},
    {id:'polish',state:settings.polish.mode==='off'?'disabled':settings.polish.mode==='cloud' && !settings.polish.hasKey?'missing':'configured',detail:settings.polish.mode==='off'?'保留原始转写。':settings.polish.mode==='local'?'本地服务地址已配置，未执行后台探测。':'云端配置；实际连接以任务记录为准。'},
    {id:'shortcut',state:shortcutRegistered?'ready':'unavailable',detail:shortcutRegistered?'全局快捷键已在 Windows 注册。':'快捷键未注册，请检查冲突或更换组合。'},
    {id:'paste',state:!settings.general.autoPaste?'disabled':windowsInput?.available()?'configured':'unavailable',detail:!settings.general.autoPaste?'自动回填已关闭。':windowsInput?.available()?'Windows 助手可用；每次回填仍须验证原输入框。':'自动回填助手不可用，可使用手动粘贴。'},
  ];return result;
}
function snapshot(){return {settings:store.getPublicSettings(),history:store.getHistory(),models:getModels(paths,hardware),hardware,monitor:monitorSnapshot(),
  paths:{root:paths.root,models:paths.models,data:paths.data,cache:paths.cache},runtime:{platform:process.platform,version:app.getVersion(),shortcut:currentShortcut,shortcutRegistered,encryptionAvailable:codec.available(),downloadsEnabled:false,autoPasteAvailable:windowsInput?.available() || false}};}
function toggleRecording(){
  if(!ready){show();return;}
  // Keep the external input focused throughout capture and processing.
  emit('toggle-recording',{trigger:'shortcut'});
}
function hud(state,title,hint='',duration=0){
  clearTimeout(overlayTimer);
  if(!overlayReady || !overlay || overlay.isDestroyed())return;
  overlay.webContents.send('murmur:overlay-status',{state,title,hint});
  overlay.showInactive();
  if(duration)overlayTimer=setTimeout(()=>overlay?.hide(),duration);
}
function hideHud(){clearTimeout(overlayTimer);overlay?.hide();}
function invalidateRecording(){sessionEpoch++;if(recordingSession)monitorCall('finish',recordingSession.monitorId,'interrupted','INTERRUPTED');if(activeTraceId)monitorCall('finish',activeTraceId,'interrupted','INTERRUPTED');recordingSession=null;hideHud();hotkeyGate.cancel();windowsInput?.cancelPending?.();}
function bindShortcut(next){
  if(next===currentShortcut && shortcutRegistered)return;
  if(!globalShortcut.register(next,()=>hotkeyGate.press().catch(()=>{})))throw new AppError('SHORTCUT_BUSY','快捷键已被其他程序占用，请更换组合。');
  if(currentShortcut && currentShortcut!==next)globalShortcut.unregister(currentShortcut);
  currentShortcut=next;shortcutRegistered=true;
}
function validateSender(event){
  if(!mainWindow || event.sender!==mainWindow.webContents || event.senderFrame!==mainWindow.webContents.mainFrame || !event.senderFrame.url.startsWith('murmur://app/'))throw new AppError('FORBIDDEN','不允许的应用请求。');
}
function handle(name,action){ipcMain.handle(`murmur:${name}`,async(event,payload)=>{
  try{validateSender(event);return {ok:true,data:await action(payload)}}
  catch(error){return {ok:false,error:{code:error.code || 'APP_ERROR',message:error instanceof AppError ? error.message : '操作失败，请检查配置或重试。'}};}
});}
async function scan(){
  if(scanning)return scanning;
  scanning=(async()=>{hardware=await detectHardware(paths);emit('state-changed',snapshot());return snapshot();})();
  try{return await scanning;}finally{scanning=null;}
}
async function infer(action,{sessionId,kind='polish'}={}){
  if(busy)throw new AppError('BUSY','正在处理上一段内容，请稍候。');
  let deliverySession=null;
  if(sessionId){
    if(!recordingSession || recordingSession.id!==sessionId)throw new AppError('INVALID_SESSION','录音会话已失效，请重新录音。');
    deliverySession=recordingSession;recordingSession=null;
  }else if(recordingSession)throw new AppError('BUSY','请先结束当前录音。');
  busy=true;
  const settings=store.getSettings();
  const traceId=deliverySession?.monitorId || monitorCall('begin',{kind,trigger:deliverySession?.trigger || 'manual',route:kind==='demo'?'demo':kind==='polish'?settings.polish.mode==='cloud'?'cloud':'local':settings.asr.mode});
  activeTraceId=traceId;
  if(deliverySession){monitorCall('stageEnd',traceId,'preparing');monitorCall('stageEnd',traceId,'recording');}
  const trace=(name,work)=>monitor && traceId?monitor.trace(traceId,name,work):work();
  if(deliverySession)hud('processing','正在把声音变成文字','保留输入框焦点，完成后自动回填');
  try{
    const result=await action({trace});
    if(result.text){
      const activeDelivery=deliverySession && (deliverySession.epoch!==sessionEpoch || !ready)
        ? {...deliverySession,target:null,reason:'录音界面已重载或关闭，已取消自动回填。文字已复制，请手动粘贴。'} : deliverySession;
      monitorCall('stageStart',traceId,'delivery');
      const delivery=await deliverText({text:result.text,settings:store.getSettings(),session:kind==='transcribe'?activeDelivery:null,clipboard,input:windowsInput});
      monitorCall('stageEnd',traceId,'delivery',delivery.status==='failed'?'failed':['skipped','not-requested'].includes(delivery.status)?'skipped':'success',delivery.status==='failed'?'DELIVERY_FAILED':delivery.status==='skipped'?'DELIVERY_SKIPPED':undefined);
      result.delivery=delivery;
      result.warnings=[...(result.warnings||[])];
      if(delivery.status==='failed' || delivery.status==='skipped')result.warnings.push(delivery.reason);
      if(result.record){
        result.record.delivery=delivery;result.record.warnings=[...result.warnings];
        try{store.updateHistory(result.record.id,{delivery,warnings:result.warnings});}catch{result.warnings.push('回填状态未保存到历史，请先保留当前文字。');}
      }
      if(deliverySession)hud(delivery.status==='pasted'?'success':'warning',delivery.status==='pasted'?'已回填到原输入框':'文字已准备好',delivery.status==='pasted'?'没有发送消息，也没有按回车':delivery.reason,4500);
    }
    monitorCall('finish',traceId,result.warnings?.length?'warning':'success');
    emit('state-changed',snapshot());return result;
  }catch(error){monitorCall('finish',traceId,'failed',error.code);if(deliverySession)hud('warning','转写未完成','请打开 Murmur 查看原因；没有粘贴任何内容',4500);throw error;}
  finally{if(activeTraceId===traceId)activeTraceId=null;busy=false;}
}
function setupIPC(){
  handle('getSnapshot',()=>snapshot());
  handle('refreshHardware',scan);
  handle('getMonitoring',()=>monitorSnapshot());
  handle('refreshMonitoring',async()=>{await monitorCall('sample');return monitorSnapshot();});
  handle('setMonitoring',payload=>{if(typeof payload?.paused!=='boolean')throw new AppError('INVALID_SETTINGS','监控暂停设置必须为布尔值。');monitorCall('setPaused',payload.paused);return monitorSnapshot();});
  handle('saveSettings',async payload=>{
    if(busy || recordingSession)throw new AppError('BUSY','录音或处理期间不能更换模型配置。');
    if(!payload || !payload.settings)throw new AppError('INVALID_SETTINGS','缺少配置。');
    const checked=validateSettings(payload.settings);
    const old=currentShortcut;
    const next=(checked || payload.settings).general.shortcut;
    bindShortcut(next);
    try{await store.saveSettings(payload.settings,payload.keys || {});}catch(error){if(old && old!==next)bindShortcut(old);throw error;}
    emit('state-changed',snapshot());return snapshot();
  });
  handle('beginRecording',async payload=>{
    if(busy || recordingSession)throw new AppError('BUSY','已有录音或处理任务正在进行。');
    if(!['button','shortcut'].includes(payload?.trigger))throw new AppError('INVALID_SESSION','录音触发方式无效。');
    const active={id:randomUUID(),epoch:sessionEpoch,trigger:payload.trigger,target:null,reason:'点击录音未捕获外部输入框。结果可复制后手动粘贴。'};
    active.monitorId=monitorCall('begin',{kind:'transcribe',trigger:payload.trigger,route:store.getSettings().asr.mode});
    monitorCall('stageStart',active.monitorId,'preparing');
    recordingSession=active;
    if(payload.trigger==='shortcut' && store.getSettings().general.autoPaste){
      try{const captured=await windowsInput.capture();active.target=captured.target;active.reason=captured.reason;}
      catch{active.reason='未能定位原输入框，完成后可从剪贴板手动粘贴。';}
      // Synthetic test text may only enter the explicitly registered test fixture.
      if(isSmoke && active.target && active.target.pid!==testTargetPid){active.target=null;active.reason='测试只允许向受控测试窗口回填。';}
    }
    if(recordingSession!==active)throw new AppError('INVALID_SESSION','录音已取消。');
    hud('preparing','正在准备麦克风',active.target?'保留输入框焦点，完成后自动回填':'未锁定输入框，将使用剪贴板');
    return {sessionId:active.id,autoPasteEligible:Boolean(active.target),reason:active.reason};
  });
  handle('recordingReady',payload=>{
    if(!recordingSession || typeof payload?.sessionId!=='string' || recordingSession.id!==payload.sessionId)throw new AppError('INVALID_SESSION','录音会话已失效。');
    monitorCall('stageEnd',recordingSession.monitorId,'preparing');monitorCall('stageStart',recordingSession.monitorId,'recording');
    hud('recording','正在聆听你的想法',`${currentShortcut.replace('CommandOrControl','Ctrl')} · 再按一次结束`);return null;
  });
  handle('cancelRecording',payload=>{
    const reason=payload?.reason || 'canceled';
    if(!['canceled','microphone','short','error'].includes(reason))throw new AppError('INVALID_SESSION','录音结束原因无效。');
    if(recordingSession && recordingSession.id===payload?.sessionId){monitorCall('finish',recordingSession.monitorId,reason==='canceled'?'canceled':'failed',({canceled:'CANCELED',microphone:'MICROPHONE_UNAVAILABLE',short:'AUDIO_SHORT',error:'AUDIO_INVALID'})[reason]);recordingSession=null;hideHud();}return {canceled:true};
  });
  handle('transcribe',payload=>infer(context=>providers.transcribe(payload,context),{sessionId:payload?.sessionId,kind:'transcribe'}));
  handle('demo',()=>infer(()=>providers.demo(),{kind:'demo'}));
  handle('polishText',payload=>infer(context=>providers.polishText(payload,context),{kind:'polish'}));
  handle('deleteHistory',async payload=>{await store.deleteHistory(payload?.id);return snapshot();});
  handle('clearHistory',async()=>{await store.clearHistory();return snapshot();});
  handle('copyText',payload=>{
    if(typeof payload?.text!=='string' || !payload.text.trim() || payload.text.length>100000)throw new AppError('INVALID_TEXT','请先输入或生成文字。');
    clipboard.writeText(payload.text);return {copied:true};
  });
  handle('openFolder',async payload=>{
    if(!['models','data','root'].includes(payload?.kind))throw new AppError('INVALID_PATH','不支持的目录。');
    const error=await shell.openPath(paths[payload.kind]);if(error)throw new AppError('OPEN_FAILED','无法打开目录。');return null;
  });
  handle('exportHistory',async payload=>{
    if(!['json','txt'].includes(payload?.format))throw new AppError('INVALID_EXPORT','不支持的导出格式。');
    const {canceled,filePath}=await dialog.showSaveDialog(mainWindow,{title:'导出转写记录',defaultPath:path.join(paths.data,`murmur-history.${payload.format}`),filters:[{name:payload.format.toUpperCase(),extensions:[payload.format]}]});
    if(canceled || !filePath)return {canceled:true};
    const rows=store.getHistory();
    const content=exportHistory(rows,payload.format);
    await fs.promises.writeFile(filePath,content,'utf8');return {canceled:false,path:filePath};
  });
  handle('windowAction',payload=>{
    switch(payload?.action){case 'minimize':mainWindow.minimize();break;case 'maximize':mainWindow.isMaximized()?mainWindow.unmaximize():mainWindow.maximize();break;case 'close':mainWindow.hide();break;default:throw new AppError('INVALID_ACTION','不支持的窗口操作。');}return null;
  });
}
async function createWindow(){
  mainWindow=new BrowserWindow({width:1280,height:860,minWidth:1060,minHeight:720,frame:false,show:false,backgroundColor:'#f6f5f0',title:'Murmur · 轻声',icon:path.join(appRoot,'assets','icon.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,spellcheck:false}});
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!=='murmur://app/renderer/index.html')event.preventDefault();});
  mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  mainWindow.on('close',event=>{if(!quitting){event.preventDefault();mainWindow.hide();}});
  mainWindow.webContents.on('did-start-loading',()=>{ready=false;invalidateRecording();});
  mainWindow.webContents.on('did-finish-load',()=>{ready=true;});
  mainWindow.webContents.on('render-process-gone',()=>{ready=false;invalidateRecording();dialog.showErrorBox('Murmur','界面进程意外停止，请从托盘退出后重启。');});
  mainWindow.once('ready-to-show',()=>mainWindow.show());
  await mainWindow.loadURL('murmur://app/renderer/index.html');ready=true;
}
async function createOverlay(){
  const {x,y,width,height}=screen.getPrimaryDisplay().workArea;
  overlay=new BrowserWindow({width:420,height:88,x:Math.round(x+(width-420)/2),y:y+height-118,frame:false,transparent:true,show:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,
    webPreferences:{preload:path.join(__dirname,'overlay-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  overlay.setIgnoreMouseEvents(true);overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  overlay.webContents.on('will-navigate',event=>event.preventDefault());
  await overlay.loadURL('murmur://app/renderer/overlay.html');overlayReady=true;
}
async function start(){
  await app.whenReady();
  Menu.setApplicationMenu(null);
  store=createStore(paths,codec);await store.init();providers=createProviders({paths,store});
  try{
    monitor=createMonitor({paths,onChange:()=>emit('monitoring',monitorSnapshot()),getAppMemoryMB:appMemoryMB});
    await monitor.init();
  }catch{monitor=null;}
  const bundledHelper=path.join(appRoot,'runtime','native','Murmur.Input.exe');
  if(isSmoke && fs.existsSync(bundledHelper)){
    const helperDirectory=projectDirectory(paths.root,path.join(paths.runtime,'native'));
    fs.copyFileSync(bundledHelper,assertContained(paths.root,path.join(helperDirectory,'Murmur.Input.exe')));
  }
  windowsInput=createWindowsInput({paths,ownerPid:process.pid,...(!isSmoke && fs.existsSync(bundledHelper)?{helperPath:bundledHelper}:{})});
  protocol.handle('murmur',request=>{
    try{
      const full=resolveAsset(appRoot,request.url);
      if(!fs.existsSync(full) || !fs.statSync(full).isFile())return new Response('Not found',{status:404});
      return net.fetch(pathToFileURL(full).href);
    }catch{return new Response('Forbidden',{status:403});}
  });
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>{
    callback(contents===mainWindow?.webContents && details.requestingUrl?.startsWith('murmur://app/') && permission==='media' && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video'));
  });
  session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>contents===mainWindow?.webContents && origin?.startsWith('murmur://app') && permission==='media' && details.mediaType!=='video');
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('murmur://app/') && !details.url.startsWith('devtools://') && !details.url.startsWith('blob:murmur://app/')}));
  setupIPC();
  try{bindShortcut(store.getSettings().general.shortcut);}catch{currentShortcut=store.getSettings().general.shortcut;shortcutRegistered=false;}
  tray=new Tray(nativeImage.createFromPath(path.join(appRoot,'assets','tray.png')));
  tray.setToolTip('Murmur · 轻声 — Ctrl+Alt+Space');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Murmur',click:show},{label:'开始 / 停止录音',click:toggleRecording},{type:'separator'},{label:'退出',click:()=>{quitting=true;app.quit();}}]));
  tray.on('double-click',show);tray.on('click',show);
  await createWindow();
  await createOverlay();
  monitorCall('start');
  if(!isSmoke)scan().catch(()=>emit('notice',{message:'设备检测未完成，可在我的设备中重新检测。'}));
  if(isSmoke){await require('./smoke.cjs').run({app,mainWindow,paths,projectRoot,scan,snapshot,setTestTargetPid:pid=>{testTargetPid=pid;}});quitting=true;app.quit();}
}
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){app.quit();}else{
  app.on('second-instance',show);
  app.on('window-all-closed',()=>{});
  app.on('activate',show);
  app.on('before-quit',()=>{quitting=true;invalidateRecording();monitorCall('stop');});
  app.on('will-quit',()=>globalShortcut.unregisterAll());
  start().catch(error=>{
    const message=error instanceof AppError?error.message:'应用启动失败。请查看终端诊断并检查项目目录可写。';
    // Diagnostic type/code only; credentials and dictated content never enter logs.
    console.error('Murmur startup:',error.code || error.name, isSmoke?error.stack:'');
    if(isSmoke){process.exitCode=1;}else{dialog.showErrorBox('Murmur',message);}
    quitting=true;app.exit(1);
  });
}
