'use strict';
const {AppError}=require('../core/contracts.cjs');
const {parseShortcut}=require('../core/shortcuts.cjs');
function acceleratorIdentity(value){
  const aliases={CommandOrControl:'Control',Ctrl:'Control',Control:'Control',Alt:'Alt',Shift:'Shift',Super:'Super',Command:'Super'};
  const parts=value.split('+'),key=parts.pop();return [...parts.map(part=>aliases[part]).sort(),key].join('+');
}

// All configuration/capture changes share this queue. Candidate listeners never
// dispatch until both their startup and the durable settings write succeed.
function createShortcutController({globalShortcut,createNative,gate,trigger,onChange=()=>{}}){
  let active=null,shortcut='',suspended=false,changing=false,closed=false,tail=Promise.resolve(),testTargetPid=null;
  const state=()=>({shortcut,registered:Boolean(active?.healthy),suspended});
  const changed=()=>onChange(state());
  const serial=work=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
  function dispatch(binding){
    if(closed || changing || suspended || active!==binding || !binding.healthy)return;
    if(binding.kind==='native')trigger();else gate.press().catch(()=>{});
  }
  async function dispose(binding){
    if(!binding)return;
    binding.healthy=false;
    if(binding.native)await binding.native.stop();else globalShortcut.unregister(binding.accelerator);
  }
  async function prepare(value){
    let parsed;try{parsed=parseShortcut(value);}catch(error){throw new AppError('INVALID_SETTINGS',error.message);}
    const binding={value,kind:parsed.kind,healthy:false,failed:false,accelerator:acceleratorIdentity(parsed.value)};
    if(parsed.kind==='native'){
      binding.native=createNative({onActivate:()=>dispatch(binding),onFailure:()=>{
        binding.failed=true;binding.healthy=false;if(active===binding)changed();
      }});
      try{await binding.native.start();if(binding.failed)throw new Error('Listener exited during startup');binding.native.setTestTargetPid?.(testTargetPid);}catch(error){await binding.native.stop();throw new AppError('SHORTCUT_UNAVAILABLE','右 Alt 监听不可用，请重试保存或重新启动应用。');}
    }else{
      let registered=false;try{registered=globalShortcut.register(binding.accelerator,()=>dispatch(binding));}catch{}
      if(!registered)throw new AppError('SHORTCUT_BUSY','快捷键已被占用或不受系统支持，请更换组合。');
    }
    binding.healthy=true;return binding;
  }
  return {
    state,
    configure(value,persist=()=>{}){return serial(async()=>{
      if(closed)throw new AppError('SHORTCUT_UNAVAILABLE','应用正在退出。');
      if(suspended)throw new AppError('SHORTCUT_CAPTURE_ACTIVE','请先完成或取消快捷键录入。');
      changing=true;gate.cancel();let candidate=null;
      try{
        parseShortcut(value);
        if(active?.healthy && active.accelerator===acceleratorIdentity(value)){
          // The store commit is synchronous and atomic. No async boundary may
          // separate its success from adopting the running binding.
          persist();shortcut=value;return state();
        }
        candidate=await prepare(value);
        if(candidate.failed)throw new AppError('SHORTCUT_UNAVAILABLE','快捷键监听已停止，请重试保存。');
        persist();
        const previous=active;active=candidate;shortcut=value;candidate=null;
        await dispose(previous);return state();
      }catch(error){await dispose(candidate);throw error;}
      finally{changing=false;changed();}
    });},
    // Used only after a startup registration error; preserve attempted setting.
    setUnavailable(value){if(!active){shortcut=value;changed();}},
    suspend(){return serial(async()=>{
      if(closed)return state();
      suspended=true;gate.cancel();const previous=active;active=null;
      await dispose(previous);changed();return state();
    });},
    resume(){return serial(async()=>{
      if(closed || !suspended)return state();
      changing=true;
      try{if(shortcut)active=await prepare(shortcut);}
      finally{suspended=false;changing=false;changed();}
      return state();
    });},
    setTestTargetPid(pid){testTargetPid=pid;active?.native?.setTestTargetPid?.(pid);},
    stop(){closed=true;gate.cancel();return serial(async()=>{const previous=active;active=null;await dispose(previous);changed();});},
  };
}
module.exports={createShortcutController};
