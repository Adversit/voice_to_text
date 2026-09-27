'use strict';
function exportHistory(records,format,at=new Date().toISOString()){
  if(format==='json')return JSON.stringify({schemaVersion:1,exportedAt:at,records},null,2);
  if(format!=='txt')throw new TypeError('Unsupported export format');
  return records.map(record=>{
    const lines=[`[${record.createdAt}] ${record.source} / ${record.model}`,record.text];
    if(record.delivery)lines.push(`回填状态：${record.delivery.status}${record.delivery.reason?' · '+record.delivery.reason:''}`);
    if(record.warnings?.length)lines.push(`提示：${record.warnings.join('；')}`);
    return lines.join('\n');
  }).join('\n\n');
}
module.exports={exportHistory};
