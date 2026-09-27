'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {keyCode,createHotkeyGate}=require('../desktop/hotkey.cjs');
test('shortcut key mapping covers allowed primary keys',()=>{
  assert.equal(keyCode('Ctrl+Alt+Space'),32);assert.equal(keyCode('Control+F24'),135);assert.equal(keyCode('Alt+Q'),81);assert.equal(keyCode('Ctrl+1'),49);assert.throws(()=>keyCode('Ctrl+Fn'));
});
test('held shortcut toggles only once until release then allows a new press',async()=>{
  let count=0,release;
  const gate=createHotkeyGate({trigger:()=>count++,available:()=>true,getAccelerator:()=> 'Ctrl+Alt+Space',waitForRelease:()=>new Promise(resolve=>{release=resolve;})});
  const first=gate.press();await gate.press();await gate.press();assert.equal(count,1);release(true);await first;
  const second=gate.press();assert.equal(count,2);release(true);await second;
});
test('invalidating the gate makes stale release completion harmless',async()=>{
  const pending=[];let count=0;
  const gate=createHotkeyGate({trigger:()=>count++,available:()=>true,getAccelerator:()=> 'Ctrl+F1',waitForRelease:()=>new Promise(resolve=>pending.push(resolve))});
  const first=gate.press();gate.cancel();const second=gate.press();assert.equal(count,2);pending[0](true);await first;
  await gate.press();assert.equal(count,2);pending[1](true);await second;
});
