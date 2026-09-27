'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {deliverText}=require('../core/delivery.cjs');
function fixture(){
  let text='previous';const calls=[];
  return {args:{text:'测试回填\nMurmur',settings:{general:{autoCopy:true,autoPaste:true}},session:{trigger:'shortcut',target:{opaque:'private'}},
    clipboard:{writeText:v=>{text=v;calls.push('copy');},readText:()=>text},input:{paste:async input=>{calls.push(input);return {status:'pasted',reason:'done'};}}},calls};
}
test('shortcut copies then pastes exactly once with a hash, not the transcript in the native request',async()=>{
  const {args,calls}=fixture();assert.equal((await deliverText(args)).status,'pasted');assert.equal(calls.length,2);assert.equal(calls[0],'copy');
  assert.deepEqual(calls[1],{target:args.session.target,clipboardHash:createHash('sha256').update(args.text).digest('hex')});
});
test('demo, manual polish and button recording never trigger OS paste',async()=>{
  for(const session of [null,undefined,{trigger:'button',target:{}}]){const {args,calls}=fixture();args.session=session;assert.equal((await deliverText(args)).status,'copied');assert.deepEqual(calls,['copy']);}
});
test('copy opt-out preserves clipboard except when shortcut auto-paste explicitly needs it',async()=>{
  const {args,calls}=fixture();args.settings.general.autoCopy=false;args.session=null;
  assert.equal((await deliverText(args)).status,'not-requested');assert.deepEqual(calls,[]);
  args.session={trigger:'shortcut',target:{}};assert.equal((await deliverText(args)).status,'pasted');assert.equal(calls[0],'copy');
});
test('missing target, native failures and changed clipboard do not paste arbitrary content',async()=>{
  const a=fixture();a.args.session.target=null;assert.equal((await deliverText(a.args)).status,'skipped');assert.deepEqual(a.calls,['copy']);
  const b=fixture();b.args.input.paste=async()=>{throw new Error('native failure');};assert.equal((await deliverText(b.args)).status,'failed');
  const c=fixture();c.args.clipboard.readText=()=> 'other application data';assert.equal((await deliverText(c.args)).status,'skipped');assert.deepEqual(c.calls,['copy']);
  const d=fixture();d.args.clipboard.writeText=()=>{throw new Error('locked');};assert.equal((await deliverText(d.args)).status,'failed');assert.deepEqual(d.calls,[]);
});
test('Windows clipboard newline normalization preserves expected content',async()=>{
  const {args}=fixture();args.clipboard.readText=()=>args.text.replace(/\n/g,'\r\n');assert.equal((await deliverText(args)).status,'pasted');
});
