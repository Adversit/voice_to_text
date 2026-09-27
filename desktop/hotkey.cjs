'use strict';
const {parseShortcut}=require('../core/shortcuts.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function keyCode(accelerator){
  return parseShortcut(accelerator).keyCode;
}
function createHotkeyGate({trigger,waitForRelease,available,getAccelerator}){
  let active=null,lastSeen=0;
  async function press(){
    lastSeen=Date.now();if(active)return;
    const token={};active=token;
    try{
      trigger();
      if(available()){
        while(active===token){
          const started=Date.now();
          if(await waitForRelease({keyCode:keyCode(getAccelerator())}))return;
          // Fast false responses indicate an unavailable helper; avoid a spin.
          if(Date.now()-started<500 || !available())break;
        }
      }
      // Clipboard-only fallback: suppress repeated WM_HOTKEY messages while held.
      while(active===token && Date.now()-lastSeen<1200)await pause(100);
    }finally{if(active===token)active=null;}
  }
  return {press,cancel(){active=null;}};
}
module.exports={keyCode,createHotkeyGate};
