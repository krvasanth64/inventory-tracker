import {SCHEMAS,TABLES,emptyDb,byId,validate,diagnostics} from './core.js';
import {MASTER_TABLES} from './admin.js';
const LIMIT=1500;
const order=[...TABLES]; // masters -> PO headers -> PO lines -> stock -> reservations -> dispatch
const first=s=>s?.fields[0].key;
const str=v=>v===undefined||v===null?'':String(v).trim();
export const importGroups={
  masters:[...MASTER_TABLES],
  orders:['BUYER_PO','BUYER_LINES','SUPPLIER_PO','SUPPLIER_LINES'],
  inward:['RECEIPTS','ADJUSTMENTS'],
  outward:['ALLOCATIONS','CONTAINERS','DISPATCH'],
  all:order
};
export const groupTitle={masters:'Masters',orders:'Buyer and Supplier Orders',inward:'Inward and Adjustments',outward:'Reservations and Outward',all:'All database tables'};
export function downloadTableTemplate(group='all'){
 if(!window.XLSX)throw Error('Excel library unavailable');
 const target=importGroups[group]||[group];const wb=XLSX.utils.book_new();
 for(const table of target){const s=SCHEMAS[table];if(!s)throw Error('Unknown module '+table);
  const matrix=[
   [s.title+' • BULK DATA ENTRY TEMPLATE'],
   ['Use one row per record; do not change the field names in row 6.'],
   ['Enter stable unique identifiers and the exact linked IDs from master/PO tables.'],
   ['Quantity fields use the transaction UOM; all item-specific conversions must exist first.'],
   ['For stock, specify Draft or Posted. Posted records cannot be edited later.'],
   s.headers,
   s.fields.map(f=>f.key===s.pk?'EXAMPLE-'+table:f.type==='date'?'2026-11-21':f.type==='number'?1:f.type==='select'?(f.options?.[0]||''):f.type==='ref'?'REFERENCE-ID':'')
  ];
  const ws=XLSX.utils.aoa_to_sheet(matrix);
  ws['!cols']=s.headers.map(h=>({wch:Math.max(16,Math.min(34,h.length+5))}));
  // Example row is advisory; importer deliberately skips EXAMPLE-* records.
  XLSX.utils.book_append_sheet(wb,ws,table);
 }
 XLSX.writeFile(wb,'FlowStock_'+(importGroups[group]?group:group.toLowerCase())+'_Bulk_Template.xlsx');
}
function headerIndex(rows,schema){return rows.findIndex(r=>Array.isArray(r)&&r.some(x=>str(x).toLowerCase()===schema.headers[0].toLowerCase()))}
function excelDate(v){if(v instanceof Date)return Number.isNaN(v.getTime())?'':v.toISOString().slice(0,10);if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);return d.toISOString().slice(0,10)}const t=str(v);if(!t)return '';const d=new Date(t);return Number.isNaN(d.getTime())?t:d.toISOString().slice(0,10)}
function decode(ws,table){const schema=SCHEMAS[table];if(!ws) return [];
 const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,cellDates:true});const header=headerIndex(rows,schema);
 if(header<0)throw Error('Missing header "'+schema.headers[0]+'" in '+table);
 const headings=rows[header].map(str);
 // Allow reordering but not silently omit crucial identifier columns.
 const idx=schema.fields.map(f=>({f,index:headings.findIndex(h=>h.toLowerCase()===schema.headers[f.col].toLowerCase())}));
 const missing=idx.filter(x=>x.index<0);if(missing.length)throw Error('Missing '+table+' columns: '+missing.map(x=>schema.headers[x.f.col]).join(', '));
 const output=[];for(let i=header+1;i<rows.length;i++){
  const cells=rows[i]||[],record={};for(const {f,index} of idx){const value=cells[index];record[f.key]=f.type==='number'?(str(value)===''?'':Number(value)):f.type==='date'?excelDate(value):str(value)}
  const id=str(record[schema.pk]);if(!id||id.startsWith('EXAMPLE-'))continue;
  output.push({table,record,excelRow:i+1});
 }
 return output;
}
export async function parseBulkFile(file,group='all'){
 if(!window.XLSX)throw Error('Excel library unavailable. Connect to the internet and reload.');
 if(file.size>16*1024*1024)throw Error('Maximum import file size is 16 MB');
 const input=await file.arrayBuffer(),wb=XLSX.read(input,{type:'array',cellDates:true});
 const tables=importGroups[group]||[group],found=tables.filter(t=>wb.Sheets[t]);
 if(!found.length){if(tables.length===1&&wb.SheetNames.length===1){const rows=decode(wb.Sheets[wb.SheetNames[0]],tables[0]);return {rows,source:file.name,tables:[tables[0]]}}throw Error('No matching table tabs found. Expected: '+tables.join(', '))}
 const output=[];for(const table of tables){if(!wb.Sheets[table])continue;output.push(...decode(wb.Sheets[table],table))}
 if(output.length>LIMIT)throw Error('Import limit '+LIMIT+' rows per upload; split your file');
 return {rows:output,source:file.name,tables:found}
}
export function previewBulk(source,current,{mode='skip',allowedTable=()=>true,allowedRecord=()=>true}={}){
 const temp=structuredClone(current),results=[],seen=new Set(),postShipments=[];
 const sorted=[...source.rows].sort((a,b)=>order.indexOf(a.table)-order.indexOf(b.table));
 for(const entry of sorted){
  const {table,record,excelRow}=entry,s=SCHEMAS[table],id=record[s.pk],signature=table+'|'+id;
  if(!allowedTable(table)){results.push({...entry,status:'ERROR',error:'Role does not permit importing '+table});continue}
  if(!allowedRecord(table,record)){results.push({...entry,status:'ERROR',error:'Stock posting / dispatch role required for confirmed rows'});continue}
  if(seen.has(signature)){results.push({...entry,status:'ERROR',error:'Duplicate ID within import'});continue}seen.add(signature);
  const old=byId(temp,table,id),updated=!!old;
  if(updated&&mode==='skip'){results.push({...entry,status:'SKIP',error:'Already exists'});continue}
  if(updated&&mode!=='update'){results.push({...entry,status:'ERROR',error:'Existing record; choose skip or update'});continue}
  if(updated&&['RECEIPTS','ADJUSTMENTS'].includes(table)&&old.posting==='Posted'){results.push({...entry,status:'ERROR',error:'Cannot update a posted stock movement'});continue}
  const proposed=updated?{...old,...record}:record;
  const finalStatus=table==='CONTAINERS'&&['Dispatched','Arrived'].includes(proposed.status)?proposed.status:null;
  if(finalStatus&&!['Dispatched','Arrived'].includes(old?.status)){postShipments.push({table,record:{...proposed},excelRow});proposed.status='Loaded'}
  try{
   validate(temp,table,proposed,updated);
   if(updated)temp[table]=temp[table].map(x=>x[s.pk]===id?proposed:x);
   else temp[table].push(proposed);
   results.push({...entry,record:proposed,status:updated?'UPDATE':'CREATE',error:''});
  }catch(e){results.push({...entry,status:'ERROR',error:e.message})}
 }
 for(const shipment of postShipments){
  const row=byId(temp,'CONTAINERS',shipment.record.id);if(!row)continue;
  const statuses=shipment.record.status==='Arrived'?['Dispatched','Arrived']:['Dispatched'];
  for(const status of statuses){const updated={...row,...shipment.record,status};try{validate(temp,'CONTAINERS',updated,true);temp.CONTAINERS=temp.CONTAINERS.map(x=>x.id===updated.id?updated:x);Object.assign(row,updated);results.push({...shipment,record:updated,status:'FINALIZE',error:''})}catch(e){results.push({...shipment,status:'ERROR',error:'Cannot confirm '+status+': '+e.message});break}}
 }
 const counts={create:results.filter(x=>x.status==='CREATE').length,update:results.filter(x=>x.status==='UPDATE').length,finalize:results.filter(x=>x.status==='FINALIZE').length,skip:results.filter(x=>x.status==='SKIP').length,error:results.filter(x=>x.status==='ERROR').length};
 const flags=diagnostics(temp).filter(x=>!x.ok);
 // Existing corrupted data need not block an unrelated master import, but new failures do.
 const before=new Set(diagnostics(current).filter(x=>!x.ok).map(x=>x.title));
 const newFailures=flags.filter(x=>!before.has(x.title));
 if(newFailures.length){results.push({table:'SYSTEM',excelRow:'—',status:'ERROR',error:'After import: '+newFailures.slice(0,5).map(x=>x.title).join(', ')});counts.error++}
 return {results,counts,draft:temp,source:source.source,mode,canApply:counts.error===0&&(counts.create+counts.update)>0}
}
export const importOrder=order;
