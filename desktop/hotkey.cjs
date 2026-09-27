'use strict';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function keyCode(accelerator){
  const key=accelerator.split('+').at(-1);
  if(key==='Space')return 32;
  if(/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key))return 111+Number(key.slice(1));
  if(/^[A-Z0-9]$/.test(key))return key.charCodeAt(0);
  throw new Error('Unsupported shortcut key');
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
