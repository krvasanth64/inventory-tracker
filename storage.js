import {SCHEMAS,TABLES,emptyDb} from './core.js';
const DBNAME='flowstock-local-v1';
const GOOGLE='https://sheets.googleapis.com/v4/spreadsheets';
let token='';
let activeSpreadsheet='';
let snapshot=emptyDb();
let liveFileHandle=null;
let liveFileFingerprint=null;
const fingerprint=f=>String(f.lastModified)+':'+String(f.size);
function openStore(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DBNAME,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function storeGet(key){const db=await openStore();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),r=tx.objectStore('state').get(key);r.onsuccess=()=>{db.close();resolve(r.result)};r.onerror=()=>{db.close();reject(r.error)}})}
async function storeSet(key,value){const db=await openStore();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,key);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
// Workspace catalog is browser-local; a Google URL is a connection pointer, not cached credentials.
let activeWorkspace='default';
const stamp=()=>new Date().toISOString();
const records=db=>TABLES.reduce((n,t)=>n+(db[t]?.length||0),0);
function safeId(){return 'db-'+crypto.randomUUID()}
export async function listWorkspaces(){
 let list=await storeGet('workspaces');
 if(!list){const now=stamp(),legacy=await storeGet('database')||emptyDb();list=[{id:'default',name:'Local Workspace',source:'Local browser',kind:'local',createdAt:now,updatedAt:now,count:records(legacy)}];await storeSet('workspaces',list);await storeSet('active-workspace','default')}
 activeWorkspace=await storeGet('active-workspace')||'default';
 return list.map(x=>({...x,active:x.id===activeWorkspace}));
}
export async function activeWorkspaceInfo(){const all=await listWorkspaces();return all.find(x=>x.active)||all[0]}
async function changeWorkspace(id,extra={}){
 const all=await listWorkspaces(),p=all.find(x=>x.id===id);if(!p)throw Error('Workspace not found');
 Object.assign(p,extra);await storeSet('workspaces',all.map(({active,...x})=>x));activeWorkspace=id;await storeSet('active-workspace',id);
 return {...p,active:true}
}
export async function createWorkspace(name,source='Local browser',data=null){
 name=String(name||'').trim();if(name.length<3)throw Error('Database name requires at least 3 characters');
 const catalog=await listWorkspaces();if(catalog.some(x=>x.name.toLowerCase()===name.toLowerCase()))throw Error('Database name already exists');
 const id=safeId(),now=stamp(),value=data||emptyDb();
 catalog.push({id,name,source,kind:'local',createdAt:now,updatedAt:now,count:records(value)});
 await storeSet('workspaces',catalog.map(({active,...x})=>x));await storeSet('database:'+id,structuredClone(value));
 return catalog.at(-1)
}
export async function activateWorkspace(id){
 const all=await listWorkspaces(),found=all.find(x=>x.id===id);if(!found)throw Error('Workspace not found');
 if(found.kind==='google')return found;
 activeWorkspace=id;await storeSet('active-workspace',id);await storeSet('last-local-workspace',id);unlinkExcel();
 snapshot=structuredClone(await storeGet(id==='default'?'database':'database:'+id)||emptyDb());
 return {...found,active:true};
}
export async function registerGoogleWorkspace({id,title}){
 const current=await activeWorkspaceInfo();if(current?.kind==='local')await storeSet('last-local-workspace',current.id);
 const all=await listWorkspaces(),existing=all.find(x=>x.kind==='google'&&x.sheetId===id),now=stamp();
 if(existing){existing.name=title;existing.updatedAt=now;existing.source='Google Sheets'}else all.push({id:safeId(),name:title,source:'Google Sheets',kind:'google',sheetId:id,createdAt:now,updatedAt:now,count:0});
 const found=existing||all.at(-1);
 await storeSet('workspaces',all.map(({active,...x})=>x));
 await changeWorkspace(found.id);return found;
}
export async function updateWorkspaceMeta(changes={}){
 const all=await listWorkspaces(),x=all.find(v=>v.id===activeWorkspace);if(!x)return;
 Object.assign(x,{updatedAt:stamp(),...changes});await storeSet('workspaces',all.map(({active,...v})=>v));
}
export async function renameWorkspace(id,name){
 name=String(name||'').trim();if(name.length<3)throw Error('Enter database name');
 const all=await listWorkspaces(),w=all.find(x=>x.id===id);if(!w)throw Error('Workspace not found');
 if(all.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()))throw Error('Duplicate name');
 w.name=name;w.updatedAt=stamp();await storeSet('workspaces',all.map(({active,...v})=>v));return w;
}
export async function deleteWorkspace(id){
 const all=await listWorkspaces(),w=all.find(x=>x.id===id);if(!w||id==='default'||id===activeWorkspace)throw Error('Default/active database cannot be removed');
 if(w.kind==='local'){await storeSet('database:'+id,null)}
 await storeSet('workspaces',all.filter(x=>x.id!==id).map(({active,...v})=>v))
}
export async function loadLocal(){const catalog=await listWorkspaces();const active=catalog.find(x=>x.active);if(active?.kind==='google'&&!activeSpreadsheet){const last=await storeGet('last-local-workspace')||'default';const local=catalog.find(x=>x.id===last&&x.kind==='local');await activateWorkspace(local?.id||'default')}const val=await storeGet(activeWorkspace==='default'?'database':'database:'+activeWorkspace);snapshot=val||emptyDb();return structuredClone(snapshot)}
export async function saveLocal(data){const clean=structuredClone(data);if(liveFileHandle){if(!window.XLSX)throw Error('Excel library unavailable for live XLSX save');const previous=await liveFileHandle.getFile();if(liveFileFingerprint&&fingerprint(previous)!==liveFileFingerprint)throw Error('The Excel file changed outside FlowStock. Reopen the file before saving to avoid overwriting another edit.');const w=sheetToWorkbook(clean);const bytes=XLSX.write(w,{bookType:'xlsx',type:'array'});const out=await liveFileHandle.createWritable();await out.write(bytes);await out.close();liveFileFingerprint=fingerprint(await liveFileHandle.getFile())}snapshot=clean;await storeSet(activeWorkspace==='default'?'database':'database:'+activeWorkspace,snapshot);await updateWorkspaceMeta({count:records(clean),source:liveFileHandle?'Linked Excel ('+liveFileHandle.name+')':'Local browser'})}
export function localSnapshot(){return structuredClone(snapshot)}
export const linkedFileName=()=>liveFileHandle?.name||'';
export function unlinkExcel(){liveFileHandle=null;liveFileFingerprint=null}
export async function openLinkedExcel(){if(!window.showOpenFilePicker)throw Error('Live Excel linking requires Chrome/Edge in a secure context (HTTPS or localhost)');const [handle]=await window.showOpenFilePicker({types:[{description:'Excel workbook',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}],multiple:false});const f=await handle.getFile();if(!window.XLSX)throw Error('Excel library unavailable');const bytes=await f.arrayBuffer();const workbook=XLSX.read(bytes,{type:'array'});const unexpected=workbook.SheetNames.filter(n=>!TABLES.includes(n));if(unexpected.length)throw Error('This is a report-rich/legacy workbook. Use Import snapshot, then Save as linked Excel to preserve the original. Extra tabs: '+unexpected.slice(0,4).join(', '));const hasFormulas=TABLES.some(t=>Object.values(workbook.Sheets[t]||{}).some(cell=>cell&&typeof cell==='object'&&cell.f));if(hasFormulas)throw Error('This workbook contains formulas. Import snapshot and save as a new linked file; original remains unchanged.');const data=await importExcel(f);liveFileHandle=handle;liveFileFingerprint=fingerprint(f);snapshot=structuredClone(data);await storeSet(activeWorkspace==='default'?'database':'database:'+activeWorkspace,snapshot);await updateWorkspaceMeta({source:'Linked Excel ('+handle.name+')',count:records(data)});return data}
export async function saveAsLinkedExcel(data){if(!window.showSaveFilePicker)throw Error('File System Access requires Chrome/Edge on HTTPS or localhost');const handle=await window.showSaveFilePicker({suggestedName:'FlowStock_Live_Database.xlsx',types:[{description:'Excel workbook',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});liveFileHandle=handle;liveFileFingerprint=null;await saveLocal(data);return handle.name}
export const connected=()=>!!activeSpreadsheet;
export const googleId=()=>activeSpreadsheet;
const authError=()=>new Error('Google session expired. Select Connect again.');
export async function authorize(clientId){if(!window.google?.accounts?.oauth2)throw Error('Google Identity Services could not load. Open on HTTPS and allow Google scripts.');if(!clientId||!clientId.endsWith('.apps.googleusercontent.com'))throw Error('Enter a valid OAuth Web Client ID');return new Promise((resolve,reject)=>{const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'https://www.googleapis.com/auth/spreadsheets',callback:result=>{if(result.error){reject(new Error(result.error_description||result.error));return}token=result.access_token;resolve(token)}});client.requestAccessToken({prompt:'consent'})})}
async function api(path,opt={}){if(!token)throw authError();const response=await fetch(path,{...opt,headers:{Authorization:'Bearer '+token,...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}});let result={};try{result=await response.json()}catch{}if(!response.ok){if(response.status===401)token='';throw Error(result.error?.message||('Google Sheets HTTP '+response.status))}return result}
const q=x=>"'"+x.replaceAll("'","''")+"'";
const col=i=>{let n=i+1,s='';while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26)}return s};
function sheetInput(row,schema){const record={};schema.fields.forEach(f=>{const v=row?.[f.col];if(f.type==='number')record[f.key]=v===''||v===undefined?'':Number(v);else if(f.type==='date'){if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);record[f.key]=d.toISOString().slice(0,10)}else{const value=String(v||'');const dt=new Date(value);record[f.key]=/^\d{4}-\d{2}-\d{2}$/.test(value)?value:Number.isNaN(dt.getTime())?'':dt.toISOString().slice(0,10)}}else record[f.key]=v===null||v===undefined?'':String(v)});return record}
export function sheetIdFromUrl(value){const m=String(value||'').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);return m?m[1]:String(value||'').trim()}
export async function connectSheet(id){id=sheetIdFromUrl(id);if(!id)throw Error('Enter a spreadsheet URL or ID');const meta=await api(GOOGLE+'/'+encodeURIComponent(id)+'?fields=spreadsheetId,properties(title),sheets(properties(title))');const tabs=new Set((meta.sheets||[]).map(s=>s.properties.title));const missing=TABLES.filter(t=>!tabs.has(t));if(missing.length)throw Error('Missing required tabs: '+missing.join(', ')+'. Create a fresh database, or use the V1 source workbook.');
const ranges=TABLES.map(t=>q(t)+'!A6:'+col(SCHEMAS[t].headers.length-1)+'2000');const data=await api(GOOGLE+'/'+encodeURIComponent(id)+'/values:batchGet?ranges='+ranges.map(encodeURIComponent).join('&ranges=')+'&valueRenderOption=UNFORMATTED_VALUE');
const db=emptyDb();(data.valueRanges||[]).forEach((section,i)=>{const name=TABLES[i],s=SCHEMAS[name];for(let j=1;j<(section.values||[]).length;j++){const row=section.values[j],v=sheetInput(row,s);if(String(v[s.pk]||'').trim())db[name].push({...v,_row:j+6})}});activeSpreadsheet=id;await registerGoogleWorkspace({id,title:meta.properties?.title||id});await updateWorkspaceMeta({count:records(db)});return {db,title:meta.properties?.title||id,id}}
export function disconnect(){activeSpreadsheet='';token=''}
export async function restoreLocalWorkspace(){disconnect();const wanted=await storeGet('last-local-workspace')||'default';const all=await listWorkspaces();const found=all.find(x=>x.id===wanted&&x.kind==='local');await activateWorkspace(found?.id||'default');return loadLocal()}
export async function lastLocalSnapshot(){const id=await storeGet('last-local-workspace')||'default';return await storeGet(id==='default'?'database':'database:'+id)||emptyDb()}
async function nextRow(t,db){let biggest=6;for(const x of db[t])biggest=Math.max(biggest,Number(x._row)||6);return biggest+1}
export async function putSheet(t,row,db,editing){if(!activeSpreadsheet)throw Error('Google Sheets not connected');const s=SCHEMAS[t];const rowIndex=editing?Number(row._row):await nextRow(t,db);if(!rowIndex||rowIndex<7)throw Error('Invalid database row');const values=s.fields.map(f=>({range:q(t)+'!'+col(f.col)+(rowIndex),values:[[row[f.key]===undefined?'':row[f.key]]]}));await api(GOOGLE+'/'+encodeURIComponent(activeSpreadsheet)+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:values})});await updateWorkspaceMeta();return {...row,_row:rowIndex}}
// Batch source-field writes (not report formulas). Validated before calling this function.
// Rows are allocated in memory in the exact import order; FINALIZE operations reuse their original row.
export async function bulkUpsertSheet(changes,initial,onProgress=()=>{}){
 if(!activeSpreadsheet)throw Error('Google spreadsheet not connected');
 const next=structuredClone(initial);const STEP=45;
 for(let start=0;start<changes.length;start+=STEP){
  const slice=changes.slice(start,start+STEP),data=[];
  for(const action of slice){
   const t=action.table,schema=SCHEMAS[t],id=action.record[schema.pk];
   const previous=next[t].find(x=>String(x[schema.pk])===String(id));
   const rowNum=previous?Number(previous._row):await nextRow(t,next);
   if(!Number.isInteger(rowNum)||rowNum<7||rowNum>2000)throw Error('Sheet row limit reached for '+t+'; extend the sheet before importing');
   const row={...(previous||{}),...action.record,_row:rowNum};
   for(const field of schema.fields){
    data.push({range:q(t)+'!'+col(field.col)+rowNum,values:[[row[field.key]??'']]});
   }
   if(previous)next[t]=next[t].map(r=>String(r[schema.pk])===String(id)?row:r);
   else next[t].push(row);
  }
  await api(GOOGLE+'/'+encodeURIComponent(activeSpreadsheet)+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data})});
  onProgress(Math.min(start+STEP,changes.length),changes.length);
 }
 await updateWorkspaceMeta({count:records(next)});
 return next;
}
// One logical operation set. Google Sheets has no transactional commit or lock; the
// preflight re-read reduces stale writes but cannot prevent concurrent changes.
export async function applySheetChangeSet(operations,baseDb){
 if(!activeSpreadsheet)throw Error('No Google Sheet connected');
 if(!operations.length)return structuredClone(baseDb);
 const fresh=await connectSheet(activeSpreadsheet);
 const current=fresh.db;
 if(JSON.stringify(current)!==JSON.stringify(baseDb))throw Error('Google Sheet changed since it was loaded. Refresh and try again.');
 const next=structuredClone(current),ranges=[],limit=150;
 if(operations.length>limit)throw Error('Maximum 150 changes per save');
 for(const op of operations){
  const schema=SCHEMAS[op.table],pk=schema?.pk;
  if(!schema)throw Error('Unknown source table '+op.table);
  const id=op.kind==='delete'?op.id:op.record?.[pk];
  const old=next[op.table].find(x=>String(x[pk])===String(id));
  if(op.kind==='delete'){
   if(!old?._row)throw Error('Missing database row to delete: '+id);
   for(const f of schema.fields)ranges.push({range:q(op.table)+'!'+col(f.col)+old._row,values:[['']]});
   next[op.table]=next[op.table].filter(x=>String(x[pk])!==String(id));continue;
  }
  const rowIndex=old?Number(old._row):await nextRow(op.table,next);
  if(!Number.isInteger(rowIndex)||rowIndex<7||rowIndex>2000)throw Error('Table row limit reached for '+op.table);
  const saved={};for(const field of schema.fields)saved[field.key]=op.record[field.key]??old?.[field.key]??'';saved._row=rowIndex;
  for(const f of schema.fields)ranges.push({range:q(op.table)+'!'+col(f.col)+rowIndex,values:[[saved[f.key]??'']]});
  if(old)next[op.table]=next[op.table].map(x=>String(x[pk])===String(id)?saved:x);
  else next[op.table].push(saved);
 }
 // Commit the entire user action in a single values:batchUpdate request.
 // Sheets does not guarantee transaction atomicity across concurrent writers.
 await api(GOOGLE+'/'+encodeURIComponent(activeSpreadsheet)+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:ranges})});
 await updateWorkspaceMeta({count:records(next)});
 return next;
}
export async function clearSheet(t,row){if(!activeSpreadsheet)throw Error('No Google connection');if(!row._row)throw Error('Missing row number');const data=SCHEMAS[t].fields.map(f=>({range:q(t)+'!'+col(f.col)+row._row,values:[['']]}));await api(GOOGLE+'/'+encodeURIComponent(activeSpreadsheet)+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data})});await updateWorkspaceMeta()}
export async function createSheet(){if(!token)throw authError();const sheets=[...TABLES,'AUDIT_LOG'].map(title=>({properties:{title,gridProperties:{rowCount:2000,columnCount:Math.max(18,(SCHEMAS[title]?.headers.length||6)+2),frozenRowCount:6,hideGridlines:true}}}));const created=await api(GOOGLE,{method:'POST',body:JSON.stringify({properties:{title:'FlowStock Trading Operations Database'},sheets})});const data=TABLES.map(t=>({range:q(t)+'!A1:'+col(SCHEMAS[t].headers.length-1)+'6',values:[[SCHEMAS[t].title+' | data records'],[],[],['INPUT TABLE - Use FlowStock web application'],[],SCHEMAS[t].headers]}));data.push({range:"'AUDIT_LOG'!A6:F6",values:[['Timestamp','Action','Table','Record ID','User','Details']]});await api(GOOGLE+'/'+created.spreadsheetId+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data})});const metas=await api(GOOGLE+'/'+created.spreadsheetId+'?fields=sheets(properties(sheetId,title))');const requests=metas.sheets.map(s=>({repeatCell:{range:{sheetId:s.properties.sheetId,startRowIndex:5,endRowIndex:6},cell:{userEnteredFormat:{backgroundColor:{red:.93,green:.95,blue:.98},textFormat:{bold:true},verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat'}}));await api(GOOGLE+'/'+created.spreadsheetId+':batchUpdate',{method:'POST',body:JSON.stringify({requests})});return connectSheet(created.spreadsheetId)}
export async function uploadLocalSnapshotToGoogle(cloudDb){
 if(!activeSpreadsheet)throw Error('Connect a Google spreadsheet first');
 if(TABLES.some(t=>cloudDb[t]?.length))throw Error('Destination contains records. Upload is permitted only to a blank database.');
 const local=await lastLocalSnapshot();
 const count=TABLES.reduce((n,t)=>n+(local[t]?.length||0),0);
 if(!count)throw Error('The local workspace contains no records to upload');
 const data=[];
 for(const t of TABLES){const schema=SCHEMAS[t],records=local[t]||[];if(!records.length)continue;for(const field of schema.fields){const vals=records.map(row=>[row[field.key]??'']);data.push({range:q(t)+'!'+col(field.col)+'7:'+col(field.col)+(6+records.length),values:vals})}}
 // Existing sheets must be blank. We never overwrite other users' records.
 await api(GOOGLE+'/'+encodeURIComponent(activeSpreadsheet)+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data})});
 await appendAudit('IMPORT','ALL','LOCAL-SNAPSHOT',count+' records imported');
 return connectSheet(activeSpreadsheet);
}
export async function appendAudit(action,table,id,details=''){if(!activeSpreadsheet)return;try{await api(GOOGLE+'/'+activeSpreadsheet+'/values/'+encodeURIComponent("'AUDIT_LOG'!A:F")+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{method:'POST',body:JSON.stringify({values:[[new Date().toISOString(),action,table,id,'Google signed-in editor',details]]})})}catch(e){console.warn('Audit append failure:',e);throw new Error('Record saved, but AUDIT_LOG could not be updated. Contact administrator. '+e.message)}}
export function sheetToWorkbook(db,template=false){if(!window.XLSX)throw Error('Excel library unavailable; check your internet connection');const book=XLSX.utils.book_new();for(const t of TABLES){const s=SCHEMAS[t],rows=[[s.title],[],['Managed by FlowStock | row 6 is the field header'],['Base UOM for inventory, manual container planning'],['< MENU'],s.headers];if(!template)for(const record of db[t]){const a=Array(s.headers.length).fill('');for(const f of s.fields)a[f.col]=record[f.key]??'';rows.push(a)}else rows.push(Array(s.headers.length).fill(''));const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=s.headers.map(h=>({wch:Math.max(12,Math.min(32,h.length+3))}));sheet['!freeze']={xSplit:0,ySplit:6};XLSX.utils.book_append_sheet(book,sheet,t)}return book}
export function downloadExcel(db,template=false){const book=sheetToWorkbook(db,template);XLSX.writeFile(book,template?'FlowStock_Blank_Database_Template.xlsx':'FlowStock_Database_Export.xlsx')}
export async function importExcel(file){if(!window.XLSX)throw Error('Excel library unavailable; connect to the internet');const buffer=await file.arrayBuffer();const wb=XLSX.read(buffer,{type:'array',cellDates:true});const db=emptyDb();for(const t of TABLES){if(!wb.Sheets[t])continue;const s=SCHEMAS[t];const rows=XLSX.utils.sheet_to_json(wb.Sheets[t],{header:1,raw:false,defval:''});let header=rows.findIndex(r=>r&&r[0]===s.headers[0]);if(header<0)header=5;for(const row of rows.slice(header+1)){const r=sheetInput(row,s);if(String(r[s.pk]).trim())db[t].push(r)}}return db}
export async function auditLocal(action,t,id){const records=await storeGet('audit')||[];records.push({timestamp:new Date().toISOString(),action,table:t,id});await storeSet('audit',records.slice(-5000))}
export async function getLocalAudit(){return await storeGet('audit')||[]}
