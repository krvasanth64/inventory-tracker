import {SCHEMAS,TABLES,emptyDb,byId} from './core.js';
import {ROLE_DEFINITIONS,MASTER_TABLES,initializeAccounts,currentUser,authenticate,changeOwnPassword,logout,isAdmin,may,listUsers,upsertUser,removeUser,roleLabels} from './admin.js';
import {listWorkspaces,activeWorkspaceInfo,createWorkspace,activateWorkspace,renameWorkspace,deleteWorkspace,connected,googleId,connectSheet,disconnect,restoreLocalWorkspace,loadLocal,saveLocal,importExcel,updateWorkspaceMeta,putSheet,bulkUpsertSheet,appendAudit,unlinkExcel} from './storage.js';
import {downloadTableTemplate,parseBulkFile,previewBulk,importGroups,groupTitle,importOrder} from './bulk.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const date=v=>v?new Date(v).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const btn=(text,action,style='btn-ghost')=>'<button class="btn '+style+'" data-admin-action="'+action+'">'+text+'</button>';
const groupOptions=()=>[...Object.keys(importGroups),...TABLES].map(t=>'<option value="'+t+'">'+esc(groupTitle[t]||SCHEMAS[t]?.title)+'</option>').join('');
let bridge=null;
let lastBulk=null;
let preview=null;
let previewContext=null;
let group='masters';
let mode='skip';
let userEditing='';
function msg(x,error=false){bridge?.notify(x,error)}
function canWrite(t,bulk=false){if(connected()&&!isAdmin())return false;return may(bulk?'bulk':'write',t)}
export {canWrite};
export function chooseBulkTable(t){if(!SCHEMAS[t])throw Error('Unknown module');group=t;preview=null;lastBulk=null;previewContext=null}
export function accessible(p){if(!currentUser())return false;if(p==='users'||p==='databases')return isAdmin();if(p==='bulk')return TABLES.some(t=>canWrite(t,true));return may('read')}
export function initializeAdminBridge(impl){bridge=impl;setupEvents();return initializeAccounts().then(()=>{paintAuth();refreshIdentity()})}
function refreshIdentity(){
 const u=currentUser(),top=document.getElementById('user-identity');
 if(top)top.innerHTML=u?'<strong>'+esc(u.displayName)+'</strong> <small>'+esc(roleLabels(u.roles))+'</small>':'Not signed in';
 document.querySelectorAll('[data-admin-only]').forEach(n=>n.hidden=!isAdmin());
 document.querySelectorAll('[data-page]').forEach(n=>{if(n.dataset.page==='users'||n.dataset.page==='databases')n.hidden=!isAdmin();if(n.dataset.page==='bulk')n.hidden=!accessible('bulk')});
}
function authMarkup(){
 const u=currentUser();
 if(!u)return '<div class="login-card"><div class="login-brand"><span class="brand-mark">F</span><h1>FlowStock</h1></div><div class="eyebrow">WORKSPACE SIGN IN</div><h2>Sign in to continue</h2><p>Use your administrator-provided username and password.</p><form id="login-form" class="login-form"><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-primary" type="submit">Sign in</button></form><div class="notice warning">First installation: admin / admin. The first sign-in requires an immediate password change. These browser-local accounts are demonstration controls, not secure shared-database authentication.</div></div>';
 if(u.mustChangePassword)return '<div class="login-card"><div class="eyebrow">REQUIRED SECURITY SETUP</div><h2>Change initial password</h2><p>Choose a unique administrator password before opening any database.</p><form id="password-form" class="login-form"><label>Current password<input name="current" type="password" autocomplete="current-password" required></label><label>New password (10+ characters)<input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></label><label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" minlength="10" required></label><button type="submit" class="btn btn-primary">Change password & continue</button></form><button class="btn btn-ghost" data-admin-action="logout">Sign out</button></div>';
 return '';
}
export function paintAuth(){
 const mount=document.getElementById('auth-wall');if(!mount)return;
 const required=!currentUser()||currentUser().mustChangePassword;
 mount.hidden=!required;mount.innerHTML=required?authMarkup():'';
 document.getElementById('main-shell')?.classList.toggle('app-locked',required);
}
function userPanel(){
 const me=currentUser();
 return '<div class="settings-grid"><section class="settings-card"><h3>My account</h3><p>Signed in as '+esc(me?.displayName)+' · '+esc(me?.username)+'<br>Roles: '+esc(roleLabels(me?.roles||[]))+'</p><form id="password-form" class="login-form"><label>Current password<input name="current" type="password" required></label><label>New password (10+ characters)<input name="newPassword" type="password" minlength="10" required></label><label>Confirm<input name="confirm" type="password" minlength="10" required></label><button class="btn btn-primary" type="submit">Change my password</button></form><div class="settings-actions">'+btn('Sign out','logout')+'</div></section><section class="settings-card"><h3>Permission summary</h3><div class="roles-summary">'+Object.entries(ROLE_DEFINITIONS).map(([id,meta])=>'<p><strong>'+esc(meta.label)+'</strong> — '+esc(meta.permissions.join(', '))+'</p>').join('')+'</div><div class="notice warning">Local passwords use salted PBKDF2 hashes, but the browser itself is not a secure access boundary. User accounts do not synchronize across computers.</div></section></div>';
}
export function renderAdminPage(page){
 if(page==='account')return userPanel();
 if(page==='bulk')return '<div class="notice">Use the matching template for each operation. The preview validates references, quantities and current records before upload. Import only files from a trusted source.</div><div class="settings-grid"><section class="settings-card"><h3>Bulk upload template</h3><p>Choose a module or a full group. Templates include column names and an example row to replace.</p><div class="field"><label>Import group / table</label><select id="bulk-group">'+groupOptions()+'</select></div><div class="settings-actions">'+btn('Download Excel template','bulk-template','btn-primary')+'</div><hr><div class="field"><label>Duplicate ID handling</label><select id="bulk-mode"><option value="skip">Skip existing (recommended)</option><option value="update">Update existing drafts/masters</option></select></div><div class="settings-actions">'+btn('Select Excel/CSV file','bulk-file','btn-primary')+'</div><input hidden id="bulk-upload-input" type="file" accept=".xlsx,.xls,.csv"></section><section class="settings-card"><h3>Upload controls</h3><p>Order of imports: Masters → Buyer/Supplier PO headers → PO lines → Inward → Reservations → Container → Dispatch lines.</p><div class="notice warning">Posted stock and confirmed dispatch records cannot be overwritten. Google Sheets bulk uploads are non-atomic: a connectivity failure may leave a partial upload. Export a backup and reconcile before continuing.</div><p>Current selection: <strong id="bulk-selected">'+esc(groupTitle[group]||SCHEMAS[group]?.title)+'</strong></p><p>Mode: <strong id="bulk-selected-mode">'+esc(mode)+'</strong></p></section></div><div id="bulk-preview">'+(preview?previewHtml(preview):'<div class="panel"><div class="panel-body">No file selected. Download a matching template and upload the completed workbook to preview.</div></div>')+'</div>';
 if(page==='databases')return '<div id="workspace-admin"><div class="panel"><div class="panel-body">Loading registered workspaces...</div></div></div>';
 if(page==='users')return '<div id="user-admin"><div class="panel"><div class="panel-body">Loading user accounts...</div></div></div>';
 return '';
}
function previewHtml(p){
 const {counts,results,source}=p;
 return '<section class="panel"><div class="panel-header"><div><h3>Bulk upload preview</h3><div class="panel-desc">'+esc(source)+'</div></div><div>'+btn('Clear preview','bulk-clear')+' '+btn('Confirm upload','bulk-commit','btn-primary')+'</div></div><div class="kpis compact">'+[['New',counts.create],['Update',counts.update],['Skipped',counts.skip],['Finalized',counts.finalize],['Errors',counts.error]].map(([n,x])=>'<div class="kpi"><div class="kpi-top">'+n+'</div><div class="kpi-number">'+x+'</div></div>').join('')+'</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Excel row</th><th>Module</th><th>Record ID</th><th>Action</th><th>Details</th></tr></thead><tbody>'+results.slice(0,250).map(x=>'<tr><td>'+esc(x.excelRow)+'</td><td>'+esc(x.table)+'</td><td>'+esc(x.record?.[SCHEMAS[x.table]?.pk]||'')+'</td><td><span class="tag '+(x.status==='ERROR'?'bad':x.status==='SKIP'?'warn':'good')+'">'+esc(x.status)+'</span></td><td>'+esc(x.error||'Validated')+'</td></tr>').join('')+'</tbody></table></div><div class="panel-body footnote">'+results.length+' rows checked; first 250 shown. '+(p.canApply?'Ready for review and upload.':'Fix errors before committing.')+'</div></section>';
}
async function drawUsers(){
 const users=await listUsers(),container=document.getElementById('user-admin');if(!container)return;
 const edit=users.find(x=>x.username===userEditing)||null;
 const roles=edit?.roles||['VIEWER'];
 container.innerHTML='<div class="grid2"><section class="panel"><div class="panel-header"><h3>Admin-managed users</h3><span class="tag blue">'+users.length+' users</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Username</th><th>Name / Roles</th><th>Status</th><th>Action</th></tr></thead><tbody>'+users.map(u=>'<tr><td><strong>'+esc(u.username)+'</strong></td><td>'+esc(u.displayName)+'<div class="footnote">'+esc(roleLabels(u.roles))+'</div></td><td>'+ (u.active?'<span class="tag good">Active</span>':'<span class="tag bad">Disabled</span>')+'</td><td>'+btn('Edit','user-edit:'+u.username)+' '+(u.username==='admin'?'':btn('Remove','user-remove:'+u.username,'btn-danger'))+'</td></tr>').join('')+'</tbody></table></div></section><section class="settings-card"><h3>'+(edit?'Edit user: '+esc(edit.username):'Create new user')+'</h3><p>Select one or more roles. Admin grants every permission.</p><form id="user-form" class="login-form"><label>Username<input name="username" value="'+esc(edit?.username||'')+'" '+(edit?'readonly':'')+' required></label><label>Display name<input name="displayName" value="'+esc(edit?.displayName||'')+'" required></label><label>New / reset password<input name="password" type="password" minlength="10" placeholder="'+(edit?'Leave blank to keep existing':'Minimum 10 characters')+'"></label><div class="role-checks">'+Object.entries(ROLE_DEFINITIONS).map(([id,r])=>'<label><input type="checkbox" name="roles" value="'+id+'" '+(roles.includes(id)?'checked':'')+'> '+esc(r.label)+'</label>').join('')+'</div><label class="check-inline"><input type="checkbox" name="active" '+(edit?.active===false?'':'checked')+'> Active</label><div class="settings-actions"><button class="btn btn-primary" type="submit">'+(edit?'Save user':'Create user')+'</button>'+btn('New / reset form','user-new')+'</div></form></section></div>';
}
async function drawWorkspaces(){
 const all=await listWorkspaces(),mount=document.getElementById('workspace-admin');if(!mount)return;
 const active=await activeWorkspaceInfo();
 mount.innerHTML='<div class="notice warning">Workspace list and timestamps are saved in this browser. Google Sheets original creation/modified times are not available using the current Sheets-only OAuth scope. A Google connection requires re-authentication after reload.</div><div class="settings-grid"><section class="settings-card"><h3>Create database</h3><form id="workspace-form" class="login-form"><label>Database name<input name="name" maxlength="90" placeholder="e.g. Live Inventory 2027" required></label><label>Start with<select name="seed"><option value="blank">Blank database</option><option value="clone">Copy currently loaded data</option><option value="sample">Fresh demonstration dataset</option></select></label><button class="btn btn-primary" type="submit">Create database</button></form><hr><h3>Load a previous Excel file</h3><p>Import a workbook as a new, separate database. Your current workspace remains unchanged.</p><div class="settings-actions">'+btn('Choose Excel → New database','workspace-import','btn-primary')+'</div><input id="workspace-import-input" hidden type="file" accept=".xlsx,.xls,.ods"></section><section class="settings-card"><h3>Current database</h3><p><strong>'+esc(active?.name||'Unselected')+'</strong></p><p>Source: '+esc(active?.source||'Unknown')+'<br>Created: '+esc(date(active?.createdAt))+'<br>Last app update: '+esc(date(active?.updatedAt))+'<br>Records: '+esc(active?.count??0)+'</p></section></div><section class="panel"><div class="panel-header"><div><h3>Database connections</h3><div class="panel-desc">Select a local database or reconnect to a registered Google spreadsheet</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Source / Connection</th><th>Created (local)</th><th>Last updated (app)</th><th>Rows</th><th>Action</th></tr></thead><tbody>'+all.map(w=>'<tr><td><strong>'+esc(w.name)+'</strong><div class="footnote">'+(w.active?'ACTIVE DATABASE':esc(w.id))+'</div></td><td>'+esc(w.source)+(w.kind==='google'?'<div class="footnote">Sheet ID: '+esc(w.sheetId)+'</div>':'')+'</td><td>'+esc(date(w.createdAt))+'</td><td>'+esc(date(w.updatedAt))+'</td><td>'+esc(w.count)+'</td><td>'+btn(w.active?'Active':'Select', 'workspace-select:'+w.id)+(w.kind==='google'&&w.sheetId?' '+btn('Open Sheet','workspace-open:'+w.id):'')+(w.id!=='default'&&!w.active?' '+btn('Remove','workspace-delete:'+w.id,'btn-danger'):'')+'</td></tr>').join('')+'</tbody></table></div></section>';
 const live=bridge.db();
 mount.insertAdjacentHTML('beforeend','<section class="panel"><div class="panel-header"><div><h3>Database tables</h3><div class="panel-desc">Browse any table, download its import template or upload records</div></div><span class="tag blue">'+TABLES.length+' modules</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Module</th><th>Table name</th><th>Record count</th><th>Controls</th></tr></thead><tbody>'+TABLES.map(t=>'<tr><td><strong>'+esc(SCHEMAS[t].title)+'</strong></td><td>'+esc(t)+'</td><td>'+esc(live[t]?.length||0)+'</td><td>'+btn('View','table-view:'+t)+' '+btn('Template','table-template:'+t)+(canWrite(t,true)?' '+btn('Upload','table-import:'+t):'')+'</td></tr>').join('')+'</tbody></table></div></section>');
}
export async function refreshAdminPage(page){
 refreshIdentity();
 if(page==='users'&&isAdmin())await drawUsers();
 if(page==='databases'&&isAdmin())await drawWorkspaces();
 if(page==='bulk'){const select=document.getElementById('bulk-group'),m=document.getElementById('bulk-mode');if(select)select.value=group;if(m)m.value=mode}
 const quick=document.getElementById('active-db-quick');if(quick&&isAdmin()){const all=await listWorkspaces();quick.innerHTML=all.map(w=>'<option value="'+esc(w.id)+'" '+(w.active?'selected':'')+'>'+esc(w.name)+(w.kind==='google'?' · Sheets':' · Local')+'</option>').join('')}
}
async function handleAdminAction(action){
 if(action.startsWith('table-view:'))return bridge.setPage(action.slice('table-view:'.length));
 if(action.startsWith('table-template:'))return downloadTableTemplate(action.slice('table-template:'.length));
 if(action.startsWith('table-import:')){chooseBulkTable(action.slice('table-import:'.length));return bridge.setPage('bulk')}
 if(action==='logout'){const local=await restoreLocalWorkspace();bridge.setDb(local);logout();paintAuth();refreshIdentity();bridge.render();return}
 if(action==='workspace-import'){if(!isAdmin())return msg('Administrator only',true);document.getElementById('workspace-import-input')?.click();return}
 if(action==='bulk-template'){downloadTableTemplate(group);return}
 if(action==='bulk-file'){document.getElementById('bulk-upload-input')?.click();return}
 if(action==='bulk-clear'){preview=null;lastBulk=null;previewContext=null;bridge.render();return}
 if(action==='bulk-commit'){
  if(!preview?.canApply)return msg('Resolve preview errors before upload.',true);
  if(!lastBulk)return msg('No upload source is loaded.',true);
  const workspace=await activeWorkspaceInfo();
  if(!previewContext||previewContext.id!==workspace?.id||previewContext.data!==JSON.stringify(bridge.db()))return msg('Database changed since preview. Select your file and preview again.',true);
  const changes=preview.results.filter(x=>['CREATE','UPDATE','FINALIZE'].includes(x.status));
  if(!changes.length)return msg('Nothing to upload.',true);
  if(!confirm('Write '+changes.length+' validated actions to '+(connected()?'the Google Sheet':'the local database')+'?'))return;
  try{
   bridge.setPending(true);
   if(connected()){if(!isAdmin())throw Error('Google Sheets posting is restricted to admin until a trusted multi-user backend is installed');
    const fresh=await connectSheet(googleId());if(JSON.stringify(fresh.db)!==JSON.stringify(bridge.db()))throw Error('Google Sheet changed since preview. Refresh and validate again.');
    const temp=await bulkUpsertSheet(changes,fresh.db);
    try{await appendAudit('BULK IMPORT','ALL',lastBulk?.source||'BULK',changes.length+' validated operations')}catch(auditError){msg('Records saved, but audit logging was unavailable: '+auditError.message,true)}
    bridge.setDb(temp);await updateWorkspaceMeta({count:Object.values(temp).reduce((a,x)=>a+x.length,0)});
   }else{await saveLocal(preview.draft);bridge.setDb(preview.draft)}
   msg('Bulk upload completed: '+(preview.counts.create+preview.counts.update)+' source records');preview=null;lastBulk=null;previewContext=null;bridge.render();
  }catch(e){msg('Bulk upload interrupted: '+e.message+' Refresh before retrying. Cloud uploads may be partial.',true);await bridge.refresh().catch(()=>{});}
  finally{bridge.setPending(false)}
  return;
 }
 if(action==='user-new'){userEditing='';await drawUsers();return}
 if(action.startsWith('user-edit:')){userEditing=action.slice('user-edit:'.length);await drawUsers();return}
 if(action.startsWith('user-remove:')){const username=action.slice('user-remove:'.length);if(!confirm('Remove user '+username+'?'))return;try{await removeUser(username);userEditing='';await drawUsers();msg('User removed')}catch(e){msg(e.message,true)}return}
 if(action.startsWith('workspace-select:')){
  if(!isAdmin())return msg('Administrator only',true);
  const id=action.slice('workspace-select:'.length),list=await listWorkspaces(),w=list.find(x=>x.id===id);if(!w)return;
  if(w.kind==='google'){if(connected()&&googleId()===w.sheetId)return msg('This Google Sheet is already connected');localStorage.setItem('flowstock-last-sheet',w.sheetId);bridge.setPage('settings');return msg('Authorize Google and select Sign in & connect to load this database.')}
  if(!confirm('Switch active database to '+w.name+'? Unsaved forms will be lost.'))return;
  disconnect();unlinkExcel();await activateWorkspace(id);const next=await loadLocal();bridge.setDb(next);bridge.setPage('dashboard');msg('Active database: '+w.name);return
 }
 if(action.startsWith('workspace-open:')){const id=action.slice('workspace-open:'.length),list=await listWorkspaces(),w=list.find(x=>x.id===id);if(w?.sheetId)window.open('https://docs.google.com/spreadsheets/d/'+encodeURIComponent(w.sheetId)+'/edit','_blank','noopener');return}
 if(action.startsWith('workspace-delete:')){const id=action.slice('workspace-delete:'.length);if(!confirm('Remove this database registration and its local data? Export backups first.'))return;try{await deleteWorkspace(id);await drawWorkspaces();msg('Workspace removed')}catch(e){msg(e.message,true)}return}
}
function setupEvents(){
 document.addEventListener('click',e=>{
  const control=e.target.closest('[data-admin-action]');if(!control)return;
  e.preventDefault();e.stopImmediatePropagation();
  handleAdminAction(control.dataset.adminAction).catch(err=>msg(err.message,true));
 },true);
 document.addEventListener('change',async e=>{
  if(e.target.id==='active-db-quick'){await handleAdminAction('workspace-select:'+e.target.value).catch(err=>msg(err.message,true));return}
  if(e.target.id==='bulk-group'){group=e.target.value;preview=null;lastBulk=null;previewContext=null;document.getElementById('bulk-selected').textContent=groupTitle[group]||SCHEMAS[group]?.title||group;document.getElementById('bulk-preview').innerHTML='<div class="panel-body">Select a new file to preview.</div>';return}
  if(e.target.id==='bulk-mode'){mode=e.target.value;preview=null;lastBulk=null;previewContext=null;document.getElementById('bulk-selected-mode').textContent=mode;document.getElementById('bulk-preview').innerHTML='<div class="panel-body">Select a new file to preview.</div>';return}
  if(e.target.id==='workspace-import-input'){
   const file=e.target.files?.[0];if(!file)return;
   try{const data=await importExcel(file);const n=Object.values(data).reduce((sum,arr)=>sum+arr.length,0);if(!n)throw Error('No known source table records found in the file');
    const base=file.name.replace(/\.[^.]+$/,'').slice(0,75);const name=prompt('Name for imported database',base);if(!name)return;
    const workspace=await createWorkspace(name,'Imported Excel: '+file.name+' (file last modified '+new Date(file.lastModified).toLocaleString()+')',data);
    msg('Created '+workspace.name+' with '+n+' records');await drawWorkspaces();
   }catch(err){msg(err.message,true)}finally{e.target.value=''}
   return;
  }
  if(e.target.id==='bulk-upload-input'){
   const file=e.target.files?.[0];if(!file)return;
   try{lastBulk=await parseBulkFile(file,group);
    const workspace=await activeWorkspaceInfo();previewContext={id:workspace?.id,data:JSON.stringify(bridge.db())};
    preview=previewBulk(lastBulk,bridge.db(),{mode,allowedTable:t=>canWrite(t,true),allowedRecord:(t,r)=>{const post=(['RECEIPTS','ADJUSTMENTS'].includes(t)&&r.posting==='Posted')||(t==='CONTAINERS'&&['Dispatched','Arrived'].includes(r.status));return !post||may('post',t)}});
    document.getElementById('bulk-preview').innerHTML=previewHtml(preview);
    msg('Preview ready: '+preview.results.length+' rows');
   }catch(err){msg(err.message,true)}finally{e.target.value=''}
  }
 },true);
 document.addEventListener('submit',async e=>{
  if(!['login-form','password-form','user-form','workspace-form'].includes(e.target.id))return;
  e.preventDefault();e.stopImmediatePropagation();
  const form=e.target,fd=new FormData(form);
  try{
   if(form.id==='login-form'){
    await authenticate(fd.get('username'),fd.get('password'));paintAuth();refreshIdentity();bridge.render();msg('Signed in');
   }else if(form.id==='password-form'){
    if(fd.get('newPassword')!==fd.get('confirm'))throw Error('Passwords do not match');
    await changeOwnPassword(String(fd.get('current')),String(fd.get('newPassword')));
    paintAuth();refreshIdentity();bridge.render();msg('Password changed');
   }else if(form.id==='user-form'){
    const roles=fd.getAll('roles').map(String);
    await upsertUser({username:fd.get('username'),displayName:fd.get('displayName'),password:String(fd.get('password')||''),roles,active:fd.has('active')});
    userEditing='';await drawUsers();msg('User saved');
   }else if(form.id==='workspace-form'){
    if(!isAdmin())throw Error('Admin required');
    const seed=fd.get('seed')==='clone'?structuredClone(bridge.db()):fd.get('seed')==='sample'?bridge.demoData():emptyDb();
    const w=await createWorkspace(String(fd.get('name')),'Local browser',seed);
    msg('Database created: '+w.name);await drawWorkspaces();
   }
  }catch(err){msg(err.message,true)}
 },true);
}
