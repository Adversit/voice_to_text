'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createShortcutController}=require('../desktop/shortcut-controller.cjs');
function fixture(){
  const registered=new Map(),natives=[],events=[];let activations=0,presses=0;
  const globalShortcut={register(value,handler){if(value==='Control+F9')return false;registered.set(value,handler);return true;},unregister(value){registered.delete(value);}};
  const controller=createShortcutController({globalShortcut,gate:{cancel(){},async press(){presses++;}},trigger(){activations++;},
    onChange:state=>events.push(state),createNative:callbacks=>{
      const native={...callbacks,stopped:false,pid:null,async start(){if(native.fail)throw new Error('start failed');},async stop(){native.stopped=true;},setTestTargetPid(pid){native.pid=pid;}};
      natives.push(native);return native;
    }});
  return {controller,registered,natives,events,get activations(){return activations;},get presses(){return presses;}};
}
test('native startup, suspension and resume leave exactly one dispatchable listener',async()=>{
  const f=fixture();await f.controller.configure('RightAlt');assert.deepEqual(f.controller.state(),{shortcut:'RightAlt',registered:true,suspended:false});
  f.natives[0].onActivate();assert.equal(f.activations,1);
  await f.controller.suspend();f.natives[0].onActivate();assert.equal(f.activations,1);assert.equal(f.natives[0].stopped,true);
  assert.equal(f.controller.state().suspended,true);await f.controller.resume();f.natives[1].onActivate();assert.equal(f.activations,2);
  await f.controller.stop();f.natives[1].onActivate();assert.equal(f.activations,2);assert.equal(f.natives[1].stopped,true);
});
test('failed settings persistence discards candidate and retains old native listener',async()=>{
  const f=fixture();await f.controller.configure('RightAlt');
  await assert.rejects(f.controller.configure('Ctrl+F8',()=>{throw new Error('disk');}),/disk/);
  assert.equal(f.controller.state().shortcut,'RightAlt');assert.equal(f.controller.state().registered,true);assert.equal(f.registered.size,0);
  f.natives[0].onActivate();assert.equal(f.activations,1);assert.equal(f.natives[0].stopped,false);
});
test('conflicted accelerator does not mutate persisted or running configuration',async()=>{
  const f=fixture();await f.controller.configure('Ctrl+F8');let saved=false;
  await assert.rejects(f.controller.configure('Ctrl+F9',()=>{saved=true;}),{code:'SHORTCUT_BUSY'});
  assert.equal(saved,false);assert.equal(f.controller.state().shortcut,'Ctrl+F8');f.registered.get('Control+F8')();assert.equal(f.presses,1);
});
test('candidate callback is inactive until settings commit and stale previous callback stays inactive',async()=>{
  const f=fixture();await f.controller.configure('RightAlt');
  await f.controller.configure('Ctrl+F8',()=>{
    f.natives[0].onActivate();f.registered.get('Control+F8')();assert.equal(f.activations,0);assert.equal(f.presses,0);
  });
  f.natives[0].onActivate();f.registered.get('Control+F8')();assert.equal(f.activations,0);assert.equal(f.presses,1);
});
test('helper crash is visible, retry replaces listener and test target is forwarded',async()=>{
  const f=fixture();f.controller.setTestTargetPid(987);await f.controller.configure('RightAlt');assert.equal(f.natives[0].pid,987);
  f.natives[0].onFailure();assert.equal(f.controller.state().registered,false);f.natives[0].onActivate();assert.equal(f.activations,0);
  await f.controller.configure('RightAlt');assert.equal(f.natives[0].stopped,true);assert.equal(f.controller.state().registered,true);
  f.natives[1].onActivate();assert.equal(f.activations,1);
});
test('capture blocks saving and serialized release restores the prior shortcut',async()=>{
  const f=fixture();await f.controller.configure('F8');await f.controller.suspend();assert.equal(f.registered.size,0);
  await assert.rejects(f.controller.configure('F7'),{code:'SHORTCUT_CAPTURE_ACTIVE'});
  await f.controller.resume();assert.equal(f.controller.state().shortcut,'F8');assert.equal(f.registered.size,1);
});
test('queued change cannot restart listening after quit',async()=>{
  const f=fixture();await f.controller.configure('RightAlt');const closed=f.controller.stop();
  await assert.rejects(f.controller.configure('F8'),{code:'SHORTCUT_UNAVAILABLE'});await closed;assert.equal(f.controller.state().registered,false);
});
test('equivalent accelerator aliases and order reuse the existing OS registration',async()=>{
  const f=fixture();await f.controller.configure('Ctrl+Alt+Space');const callback=[...f.registered.values()][0];
  await f.controller.configure('Alt+CommandOrControl+Space');assert.equal(f.registered.size,1);assert.equal([...f.registered.values()][0],callback);
  assert.equal(f.controller.state().shortcut,'Alt+CommandOrControl+Space');callback();assert.equal(f.presses,1);
});
test('ready immediately followed by helper failure cannot replace a healthy accelerator',async()=>{
  let callbacks;const registrations=new Set();
  const controller=createShortcutController({globalShortcut:{register(value){registrations.add(value);return true;},unregister(value){registrations.delete(value);}},
    gate:{cancel(){},async press(){}},trigger(){},createNative:handlers=>{callbacks=handlers;return {async start(){callbacks.onFailure();},async stop(){}};}});
  await controller.configure('F8');let saved=false;
  await assert.rejects(controller.configure('RightAlt',()=>{saved=true;}),{code:'SHORTCUT_UNAVAILABLE'});
  assert.equal(saved,false);assert.equal(controller.state().shortcut,'F8');assert.equal(controller.state().registered,true);assert.equal(registrations.size,1);
});
