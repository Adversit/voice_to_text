'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {exportHistory}=require('../core/export.cjs');
const records=[{id:'1',createdAt:'2026-09-27T10:00:00.000Z',source:'local',model:'whisper-base',text:'想法\n第二行',delivery:{status:'skipped',reason:'焦点已变化'},warnings:['润色失败，保留原始文字']}];
test('TXT history preserves transcript, delivery outcome and warnings including Unicode',()=>{
  const text=exportHistory(records,'txt');
  for(const value of [records[0].text,'skipped','焦点已变化','润色失败，保留原始文字'])assert.ok(text.includes(value));
  assert.equal(exportHistory([],'txt'),'');
});
test('JSON history retains its schema and full records; unknown format cannot silently fall back',()=>{
  const result=JSON.parse(exportHistory(records,'json','2026-09-27T10:30:00Z'));
  assert.deepEqual(result,{schemaVersion:1,exportedAt:'2026-09-27T10:30:00Z',records});
  assert.throws(()=>exportHistory(records,'csv'));
});
