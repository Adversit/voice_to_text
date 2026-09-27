'use strict';
const {createHash}=require('node:crypto');
async function deliverText({text,settings,session,clipboard,input}){
  const wantsPaste=Boolean(settings.general.autoPaste && session?.trigger==='shortcut');
  if(!settings.general.autoCopy && !wantsPaste)return {status:'not-requested',reason:'未启用自动复制；可以在工作台手动复制。'};
  try{clipboard.writeText(text);}catch{return {status:'failed',reason:'无法写入剪贴板，请在工作台手动复制。'};}
  if(!wantsPaste)return {status:'copied',reason:'已复制，按 Ctrl+V 粘贴。在目标输入框使用全局快捷键可自动回填。'};
  if(!session.target)return {status:'skipped',reason:session.reason || '未捕获可安全回填的输入框，文字已复制，请手动粘贴。'};
  try{
    const current=clipboard.readText();
    if(current.replace(/\r\n/g,'\n')!==text.replace(/\r\n/g,'\n'))return {status:'skipped',reason:'剪贴板内容已变化，已停止自动粘贴。请从工作台重新复制。'};
    const clipboardHash=createHash('sha256').update(current,'utf8').digest('hex');
    const result=await input.paste({target:session.target,clipboardHash});
    if(!['pasted','skipped','failed'].includes(result?.status))throw new Error('Invalid delivery response');
    return {status:result.status,reason:typeof result.reason==='string'?result.reason:'文字已复制，请手动粘贴。'};
  }catch{return {status:'failed',reason:'自动回填未完成，文字已复制，请返回原输入框按 Ctrl+V。'};}
}
module.exports={deliverText};
