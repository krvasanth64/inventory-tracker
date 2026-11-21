import {isLan,lanLease,refreshLease,leaseAction,lanCommit,lanPoll} from './lan.js';
import {SCHEMAS,TABLES,emptyDb,N,byId,lineSku,baseQty,factor,summarize,validate,diagnostics} from './core.js';
import {currentUser,isAdmin,may} from './admin.js';
import {downloadTableTemplate} from './bulk.js';
import {CHILDREN,ENTRY_BATCH,deleteBlocker,prepareDocument,prepareEntries,prepareBulkEdit,prepareBulkDelete} from './operations.js';
import {documentFormHTML,groupedFormHTML,bulkEditFormHTML,bulkDeleteFormHTML} from './forms-ui.js';
import {renderFlowHome,renderOrderDesk,renderOrderDetail,renderRequirements,renderInward,renderOutward,renderLoading,renderManagement,buildRequirements,FLOW_LABELS} from './workflow-ui.js';
import {initializeAdminBridge,canWrite,accessible,chooseBulkTable,renderAdminPage,refreshAdminPage} from './admin-ui.js';
import {loadLocal,saveLocal,connected,googleId,authorize,connectSheet,disconnect,putSheet,clearSheet,createSheet,appendAudit,downloadExcel,importExcel,auditLocal,getLocalAudit,linkedFileName,openLinkedExcel,saveAsLinkedExcel,unlinkExcel,uploadLocalSnapshotToGoogle,activeWorkspaceInfo,updateWorkspaceMeta,restoreLocalWorkspace,applySheetChangeSet} from './storage.js';
let db=emptyDb(),page='dashboard',search='',pageNumber=1,editId=null,editingTable=null,pending=false;
let workflowState={buyer:'',search:'',orderId:'',containerId:'',purchaseSku:''};
let editorMode='',editorHeader=null,editorLines=[],editorRemoved=[],editorLocked=false,bulkState=null,checkedRows=new Map();
const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=0)=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:d,minimumFractionDigits:d});
const isNum=n=>n!==null&&n!==''&&Number.isFinite(Number(n));
const niceDate=v=>{if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};
const notify=(message,error=false)=>{const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=message;$('toasts').append(el);setTimeout(()=>el.remove(),4500)};
const btn=(label,action,css='btn-ghost')=>'<button class="btn '+css+'" data-action="'+action+'">'+label+'</button>';
const tableTitles={dashboard:'Overview',outstanding:'Buyer PO Outstanding',stock:'Stock Balance',orders:'Buyer Orders',requirements:'Requirements & Pending',inward:'Stock In',outward:'Stock Out',manage:'More Tools',dbdetails:'Database Details',orderdetail:'Buyer Order Detail',loadingdetail:'Container Loading',settings:'Database Connection',checks:'Data Checks'};
const descriptions={dashboard:'Your Buyer orders, stock and shipment priorities.',orders:'Buyer-wise purchase orders and ordered items.',requirements:'Buyer-wise outstanding, stock available, reservations and purchase needs.',inward:'Record received goods and check pending Supplier purchases.',outward:'Plan manual loading, reserve stock and confirm goods sent.',manage:'Masters, detailed records, bulk upload and administration.',orderdetail:'Every item in this Buyer purchase order.',loadingdetail:'Container loading records and shipment status.',outstanding:'Outstanding Buyer PO items.',stock:'Godown stock and procurement shortage in each item’s base UOM.',settings:'Connect or export the selected database.',checks:'Check inventory and order data consistency.'};
function setPage(p){if(!accessible(p))return notify('Access denied for this page',true);page=p;search='';pageNumber=1;if(!['orders','requirements'].includes(p)){workflowState.buyer='';workflowState.search=''}document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('sidebar').classList.remove('open');$('shade').classList.remove('open');render()}
function kpi(title,value,sub,icon='▣'){return '<div class="kpi"><div class="kpi-top"><span>'+title+'</span><span class="kpi-icon">'+icon+'</span></div><div class="kpi-number">'+value+'</div><div class="kpi-caption">'+sub+'</div></div>'}
const pill=status=>{const s=String(status||'—'),c=/^completed$|^posted$|^arrived$|^accepted$|^ok$/i.test(s)?'good':/cancelled|rejected|shortage|overdue|low stock/i.test(s)?'bad':/hold|planning|draft|part|loaded|open/i.test(s)?'warn':'blue';return '<span class="tag '+c+'">'+escapeHtml(s)+'</span>'};
function labelOf(t,r){if(!r)return '';return r.name||r.number||r.sku||r.id||''}
function displayRef(t,id){return escapeHtml(labelOf(t,byId(db,t,id))||id||'—')}
function contentPanel(title,subtitle,body,action=''){return '<section class="panel"><div class="panel-header"><div><h3>'+title+'</h3><div class="panel-desc">'+subtitle+'</div></div>'+action+'</div>'+body+'</section>'}
function primaryEntry(){
 if(SCHEMAS[page])return Object.values(CHILDREN).some(x=>x.table===page)?null:page;
 return {dashboard:'BUYER_PO',orders:'BUYER_PO',orderdetail:'BUYER_LINES',requirements:'ALLOCATIONS',inward:'RECEIPTS',outward:'CONTAINERS',loadingdetail:'DISPATCH'}[page]||null;
}
function quickDefaults(t){
 if(t==='BUYER_LINES'&&page==='orderdetail')return {po:workflowState.orderId};
 if(t==='DISPATCH'&&page==='loadingdetail')return {shipment:workflowState.containerId};
 return {};
}
function render(){
 if(!currentUser()||currentUser().mustChangePassword)return;
 if(isLan()){const u=currentUser(),lease=lanLease(),box=$('lan-editor');if(box){box.hidden=false;const canEdit=u.roles.some(x=>['ADMIN','ENTRY','MANAGER'].includes(x));box.innerHTML='<span class="lan-status">'+(lease.mine?'Editing: You':lease.active?'Viewing · Editor: '+escapeHtml(lease.holder):'Shared database · View mode')+'</span>'+(lease.mine?'<button class="btn btn-ghost" data-action="lan-release">Release Edit Access</button>':canEdit&&!lease.active?'<button class="btn btn-primary" data-action="lan-acquire">Take Edit Access</button>':'')}}else if($('lan-editor'))$('lan-editor').hidden=true;
 const title=tableTitles[page]||SCHEMAS[page]?.title||{bulk:'Bulk Upload Center',users:'User Management',databases:'Database Manager',account:'My Account'}[page]||page;
 $('crumb').textContent=title;$('page-title').textContent=title;$('page-description').textContent=descriptions[page]||'Manage, review and update operational records.';$('eyebrow').textContent=SCHEMAS[page]?'DATA MANAGEMENT':page==='settings'?'PREFERENCES':'CONTROL CENTER';
 $('sidebar-mode').textContent=isLan()?'LAN shared database':connected()?'Google Sheets workspace':linkedFileName()?'Linked Excel: '+linkedFileName():'Local workspace';
 $('connection').className='connection'+(connected()?' cloud':'');$('connection').innerHTML='<span class="status-dot"></span>'+(isLan()?'Shared LAN database':connected()?'Google Sheets connected':linkedFileName()?'Live Excel linked':'Local database');
 $('page-actions').innerHTML=SCHEMAS[page]?(canWrite(page)&&!Object.values(CHILDREN).some(x=>x.table===page)?btn('+ New '+(SCHEMAS[page].title),'add','btn-primary'):'')+btn('Template','template-table:'+page)+(canWrite(page,true)?btn('Bulk upload','bulk-page:'+page):'')+btn('Export CSV','csv'):page==='stock'||page==='outstanding'||page==='requirements'?btn('Export CSV','csv'):'';
 const quick=primaryEntry(),quickAllowed=!!quick&&canWrite(quick);$('quick-add').hidden=!quickAllowed;
 $('quick-add').disabled=pending||!quickAllowed;
 const quickLabels={BUYER_PO:'New Buyer Order',BUYER_LINES:'Add Order Item',ALLOCATIONS:'Reserve Stock',RECEIPTS:'Record Stock In',CONTAINERS:'Plan Container',DISPATCH:'Add Loading Item'};
 $('quick-add').textContent='+ '+(quickLabels[quick]||SCHEMAS[quick]?.title||'New Entry');
 activeWorkspaceInfo().then(w=>{const a=$('active-database-label');if(a&&w){const localDate=v=>v?new Date(v).toLocaleString('en-GB'):'—';a.innerHTML='<strong>'+escapeHtml(w.name)+'</strong> · '+escapeHtml(w.source)+'<br><small>Created '+escapeHtml(localDate(w.createdAt))+' · Updated '+escapeHtml(localDate(w.updatedAt))+'</small>';a.title='Database: '+w.name+' | Source: '+w.source+' | Created: '+localDate(w.createdAt)+' | Last updated: '+localDate(w.updatedAt)}}).catch(()=>{});
 let html='';if(page==='dashboard')html=renderFlowHome(db);else if(page==='orders')html=renderOrderDesk(db,workflowState);else if(page==='orderdetail')html=renderOrderDetail(db,workflowState.orderId);else if(page==='requirements')html=renderRequirements(db,workflowState);else if(page==='inward')html=renderInward(db,workflowState);else if(page==='outward')html=renderOutward(db,workflowState);else if(page==='loadingdetail')html=renderLoading(db,workflowState.containerId);else if(page==='manage')html=renderManagement(db,{admin:isAdmin(),bulk:accessible('bulk'),lan:isLan()});else if(page==='outstanding')html=outstanding();else if(page==='stock')html=stockPage();else if(page==='settings')html=settingsPage();else if(page==='checks')html=checksPage();else if(SCHEMAS[page])html=directory(page);else if(['bulk','users','databases','dbdetails','account'].includes(page))html=renderAdminPage(page);$('app-content').innerHTML=html;
 refreshAdminPage(page).catch(err=>notify(err.message,true));
}
function dashboard(){const s=summarize(db),open=s.buyerLines.filter(l=>l.outstanding>0&&l.status!=='Cancelled'),overdue=open.filter(l=>l.due&&new Date(l.due)<new Date()),low=s.stockRows.filter(x=>x.alert!=='OK'),active=db.CONTAINERS.filter(c=>['Dispatched','Loaded','Planning'].includes(c.status)),processed=s.buyerLines.filter(x=>x.shipped>0).length,top=[...s.stockRows].sort((a,b)=>b.demand-a.demand).slice(0,7);
const max=Math.max(1,...top.map(x=>x.demand));const bars=top.length?'<div class="mini-bars">'+top.map(x=>'<div class="bar-item"><div class="bar-value">'+fmt(x.demand)+'</div><div class="bar-rail"><div class="bar-fill" style="height:'+Math.max(4,x.demand/max*100)+'%"></div></div><div class="bar-label" title="'+escapeHtml(x.sku)+'">'+escapeHtml(x.sku)+'</div></div>').join('')+'</div>':'<div class="footnote">Add Buyer POs to see the demand chart.</div>';
const recent=[...s.buyerLines].filter(x=>x.outstanding>0).slice(-7).reverse();const rows=recent.map(x=>'<tr><td><strong>'+escapeHtml(x.id)+'</strong><div class="muted">'+displayRef('BUYERS',x.buyer)+'</div></td><td>'+escapeHtml(x.sku)+'</td><td class="num">'+fmt(x.ordered,2)+'</td><td class="num">'+fmt(x.shipped,2)+'</td><td class="num"><strong>'+fmt(x.outstanding,2)+'</strong></td><td>'+pill(x.status)+'</td></tr>').join('');
return '<div class="notice">Inventory figures are shown in each SKU’s base UOM. Mixed items are never combined into one misleading quantity total. Demo data is fictional.</div><div class="kpis">'+kpi('Open Buyer PO lines',fmt(open.length),overdue.length+' overdue lines','▤')+kpi('Partially fulfilled',fmt(processed),'Lines with confirmed dispatch','↗')+kpi('Low stock SKUs',fmt(low.length),'Below item minimum','▥')+kpi('Active shipments',fmt(active.length),'Planning, loaded or in transit','▣')+'</div><div class="grid2">'+contentPanel('Outstanding demand by SKU','Base units per SKU · not a mixed-UOM total','<div class="panel-body">'+bars+'</div>',btn('View outstanding','go:outstanding'))+contentPanel('Operational focus','Priority actions across the order lifecycle','<div class="panel-body"><div class="quick-links">'+[['New Buyer PO','BUYER_PO'],['Supplier PO','SUPPLIER_PO'],['Goods Receipt','RECEIPTS'],['Reserve Stock','ALLOCATIONS'],['Plan Container','CONTAINERS'],['Check Stock','stock']].map(x=>'<button class="quick-link" data-action="go:'+x[1]+'">'+x[0]+' <span>↗</span></button>').join('')+'</div><p class="footnote">Confirm dispatch only after loading lines and allocation balances have been checked.</p></div>')+'</div>'+contentPanel('Buyer PO outstanding','Latest open lines · base UOM quantities','<div class="table-wrap"><table class="data-table"><thead><tr><th>Buyer order line</th><th>SKU</th><th class="num">Ordered</th><th class="num">Shipped</th><th class="num">Pending</th><th>Status</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" class="empty">No outstanding orders yet</td></tr>')+'</tbody></table></div>',btn('Open all','go:outstanding'))}
function filterRows(rows){return rows.filter(row=>Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase()))}
function tableView(headers,rows,emptyMessage='No records found'){return '<div class="table-wrap"><table class="data-table"><thead><tr>'+headers.map(h=>'<th>'+escapeHtml(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+headers.length+'" class="empty">'+emptyMessage+'</td></tr>')+'</tbody></table></div>'}
function toolbar(hint='',other=''){return '<div class="table-toolbar"><input class="search" id="table-search" value="'+escapeHtml(search)+'" placeholder="Search records..." autocomplete="off">'+(other||'')+'<div class="spacer"></div><span class="footnote">'+hint+'</span></div>'}
function pagination(total){return '<div class="pagination"><span>Showing '+(total?((pageNumber-1)*50+1):0)+'–'+Math.min(total,pageNumber*50)+' of '+total+' records</span><div><button class="btn btn-sm" data-action="previous" '+(pageNumber<=1?'disabled':'')+'>Previous</button> <button class="btn btn-sm" data-action="next" '+(pageNumber*50>=total?'disabled':'')+'>Next</button></div></div>'}
function paginate(rows){return rows.slice((pageNumber-1)*50,pageNumber*50)}
function outstanding(){const s=summarize(db),all=filterRows(s.buyerLines),active=all.filter(x=>x.outstanding>0&&x.status!=='Cancelled'),rows=paginate(active).map(r=>'<tr><td><strong>'+escapeHtml(r.id)+'</strong></td><td>'+displayRef('BUYERS',r.buyer)+'</td><td>'+escapeHtml(r.po)+'</td><td>'+escapeHtml(r.sku)+'</td><td>'+escapeHtml(byId(db,'ITEMS',r.sku)?.baseUom||'')+'</td><td class="num">'+fmt(r.ordered,2)+'</td><td class="num">'+fmt(r.shipped,2)+'</td><td class="num">'+fmt(r.reserved,2)+'</td><td class="num"><strong>'+fmt(r.outstanding,2)+'</strong></td><td>'+niceDate(r.due)+'</td><td>'+pill(r.status)+'</td></tr>');
return '<div class="kpis">'+kpi('Outstanding lines',fmt(active.length),'Active demand','▤')+kpi('Open Buyer POs',fmt(new Set(active.map(x=>x.po)).size),'Distinct purchase orders','▣')+kpi('Unreserved lines',fmt(active.filter(x=>x.unreserved>0).length),'Require stock allocation','◉')+kpi('Overdue lines',fmt(active.filter(x=>x.due&&new Date(x.due)<new Date()).length),'Due before today','!')+'</div>'+contentPanel('Outstanding purchase order lines','Remaining quantities are shown in SKU base UOM',toolbar('Click Buyer Orders to edit PO or its lines')+tableView(['PO line ID','Buyer','PO ID','SKU','Base UOM','Ordered','Shipped','Reserved','Outstanding','Required by','Status'],rows)+pagination(active.length),btn('Buyer PO lines','go:BUYER_LINES'))}
function stockPage(){const s=summarize(db),filtered=filterRows(s.stockRows),rows=paginate(filtered).map(x=>'<tr><td><strong>'+escapeHtml(x.sku)+'</strong><div class="muted">'+escapeHtml(x.name)+'</div></td><td>'+escapeHtml(x.uom)+'</td><td class="num">'+fmt(x.physical,2)+'</td><td class="num">'+fmt(x.reserved,2)+'</td><td class="num"><strong>'+fmt(x.available,2)+'</strong></td><td class="num">'+fmt(x.incoming,2)+'</td><td class="num">'+fmt(x.demand,2)+'</td><td class="num">'+fmt(x.min,2)+'</td><td class="num">'+fmt(x.shortage,2)+'</td><td>'+pill(x.alert)+'</td></tr>');
return '<div class="notice">Purchase shortage = max(0, outstanding demand + minimum stock − physical stock − confirmed supplier pending). Reservations are displayed separately to avoid subtracting demand twice.</div>'+contentPanel('Stock by SKU','Real-time derived from posted receipts, adjustments, reservations and confirmed dispatches',toolbar('All quantities in the SKU base UOM')+tableView(['SKU / Description','UOM','Physical','Reserved','Available','Incoming','Demand','Min stock','To source','Alert'],rows)+pagination(filtered.length),btn('Create reservation','go:ALLOCATIONS'))}
function directory(t){const s=SCHEMAS[t],summary=summarize(db);let rows=[...db[t]],selectedIds=checkedRows.get(t)||new Set();
if(t==='BUYER_PO')rows=rows.map(r=>({...r,_status:(()=>{const l=summary.buyerLines.filter(x=>x.po===r.id);if(r.control==='Cancelled')return'Cancelled';if(l.length&&l.every(x=>x.outstanding<=0))return'Completed';if(l.some(x=>x.shipped>0))return'Part shipped';return r.control||'Active'})()}));
if(t==='SUPPLIER_PO')rows=rows.map(r=>({...r,_status:(()=>{const l=summary.supplierLines.filter(x=>x.po===r.id);return l.length&&l.every(x=>x.pending<=0)?'Completed':r.control||'Active'})()}));
const selected=filterRows(rows),p=paginate(selected),displayFields=s.fields.filter(f=>!['notes','contact','length','width','height','grossKg','cbm','minStock','targetStock','booking','bl','port','destination','eta','actual'].includes(f.key)).slice(0,7);
const head=[(canWrite(t)?'<input type="checkbox" data-bulk-all="'+t+'" title="Select visible rows">':''),...displayFields.map(f=>f.label),...(t==='BUYER_LINES'?['Shipped base','Outstanding base']:t==='SUPPLIER_LINES'?['Received base','Pending base']:[]),'Status','Actions'];
const tableRows=p.map(r=>{const more=t==='BUYER_LINES'?summary.buyerLines.find(x=>x.id===r.id):t==='SUPPLIER_LINES'?summary.supplierLines.find(x=>x.id===r.id):null;const vals=displayFields.map(f=>{let value=r[f.key];if(f.type==='ref')value=displayRef(f.ref,value);else if(f.type==='number')value=isNum(value)?fmt(value,2):'—';else if(f.type==='date')value=niceDate(value);else value=escapeHtml(value||'—');return '<td>'+value+'</td>'}).join('');
let status=r._status||r.status||r.control||r.posting||r.active||'—';const extra=t==='BUYER_LINES'?'<td class="num">'+fmt(more?.shipped,2)+'</td><td class="num"><strong>'+fmt(more?.outstanding,2)+'</strong></td>':t==='SUPPLIER_LINES'?'<td class="num">'+fmt(more?.received,2)+'</td><td class="num"><strong>'+fmt(more?.pending,2)+'</strong></td>':'';
return '<tr>'+(canWrite(t)?'<td><input type="checkbox" data-bulk-row="'+t+'" value="'+escapeHtml(r[s.pk])+'" '+(selectedIds.has(String(r[s.pk]))?'checked':'')+'></td>':'<td></td>')+vals+extra+'<td>'+pill(status)+'</td><td><div class="row-actions">'+(canWrite(t)?'<button class="text-btn" data-action="edit:'+t+':'+escapeHtml(r[s.pk])+'">Edit</button><button class="text-btn danger" data-action="delete:'+t+':'+escapeHtml(r[s.pk])+'">Delete</button>':'<span class="muted">Read only</span>')+'</div></td></tr>'});
const quick={BUYER_PO:'BUYER_LINES',SUPPLIER_PO:'SUPPLIER_LINES'};
return contentPanel(s.title,db[t].length+' records · select rows to apply changes',toolbar('50 records per page', '<div class="bulk-toolbar" id="bulk-toolbar">'+(canWrite(t)?'<span class="tag blue">'+selectedIds.size+' selected</span>'+btn('Bulk Edit','bulk-edit:'+t)+btn('Bulk Delete','bulk-delete:'+t,'btn-danger')+btn('Clear Selection','bulk-clear:'+t):'')+'</div>')+tableView(head,tableRows)+pagination(selected.length))}
function checksPage(){const checks=diagnostics(db),bad=checks.filter(x=>!x.ok);return '<div class="kpis">'+kpi('Checks run',fmt(checks.length),'Transaction validations','✓')+kpi('Passed',fmt(checks.length-bad.length),'Expected invariants','✓')+kpi('Exceptions',fmt(bad.length),'Review before go-live','!')+kpi('Tables',fmt(TABLES.length),'Registered source tables','▦')+'</div><div class="notice '+(bad.length?'warning':'')+'">Checks are calculated in the browser. They do not replace transactional database constraints or a complete multi-user audit.</div>'+contentPanel('Integrity check results','Relationships and quantity cross-checks','<div class="check-grid panel-body">'+checks.slice(0,180).map(x=>'<div class="check"><span class="state '+(x.ok?'pass':'fail')+'">'+(x.ok?'PASS':'FAIL')+'</span><strong>'+escapeHtml(x.title)+'</strong><div class="footnote">'+escapeHtml(x.detail)+'</div></div>').join('')+'</div>')}
function settingsPage(){if(isLan())return '<div class="notice">This PC connects to the shared LAN server. Database files and accounts are managed centrally. The administrator can see the location under Database Details.</div>';const last=localStorage.getItem('flowstock-client-id')||'',id=googleId()||localStorage.getItem('flowstock-last-sheet')||'';return '<div class="notice warning">Google Sheets mode uses the signed-in Google user’s Editor permissions. Static browser code cannot provide server-enforced role permissions, record locks or strong concurrent transaction guarantees. Test with a copy first.</div><div class="settings-grid"><div class="settings-card"><h3>Local Excel workspace</h3><p>Saved in this browser using IndexedDB. Import your existing demonstration workbook or start from a clean database.</p><div class="settings-actions">'+btn('Open live Excel file','open-linked','btn-primary')+btn('Save as linked Excel','save-as-linked')+btn('Unlink file','unlink-excel')+'</div><div class="settings-actions">'+btn('Import snapshot','import')+btn('Download blank template','template')+btn('Export my data','export')+'</div><div class="settings-actions">'+btn('Load sample data','demo')+btn('Clear local data','clear-local','btn-danger')+'</div><p class="footnote">'+(linkedFileName()?'Linked file: '+escapeHtml(linkedFileName())+' · changes auto-save to this file.':'No live file linked. Local data is stored in IndexedDB.')+' Live file linking requires Chrome/Edge on HTTPS or localhost. Browser permission must be granted again after reload.</p></div><div class="settings-card"><h3>Google Sheets database</h3><p>Connect a shared native Google Sheet as the data store. Works from an authorized HTTPS web origin.</p><div class="field"><label for="oauth-client">Google OAuth Web Client ID</label><input id="oauth-client" value="'+escapeHtml(last)+'" placeholder="123456....apps.googleusercontent.com"></div><div class="field" style="margin-top:12px"><label for="spreadsheet-id">Existing spreadsheet URL or ID</label><input id="spreadsheet-id" value="'+escapeHtml(id)+'" placeholder="https://docs.google.com/spreadsheets/d/..."></div><div class="settings-actions">'+btn('Sign in & connect','connect','btn-primary')+btn('Create new sheet','create-sheet')+btn('Disconnect','disconnect')+btn('Upload local data to blank Sheet','publish-local')+'</div>'+(connected()?'<p class="footnote"><a target="_blank" rel="noopener noreferrer" href="https://docs.google.com/spreadsheets/d/'+escapeHtml(googleId())+'/edit">Open connected database in Google Sheets ↗</a></p>':'')+'<p class="footnote">The app requests Google Sheets access to read and write. Do not paste secrets, API keys or service-account credentials.</p></div></div>'}
function choices(f,current){if(f.type==='select')return f.options;if(f.type==='ref')return db[f.ref].map(r=>({value:r[SCHEMAS[f.ref].pk],label:labelOf(f.ref,r)+' · '+r[SCHEMAS[f.ref].pk]}));return[]}
function formInput(f,record){const val=record[f.key]??(f.key==='active'?'Yes':f.key==='control'?'Active':f.key==='posting'?'Draft':f.key==='quality'?'Accepted':f.key==='status'?'Planning':'');const title='<label for="fld-'+f.key+'">'+escapeHtml(f.label)+'</label>';let field='';
if(f.type==='select'||f.type==='ref'){const opts=choices(f).map(x=>typeof x==='string'?{value:x,label:x}:x);field='<select id="fld-'+f.key+'" name="'+f.key+'" '+(f.type==='ref'&&!f.optional?'required':'')+'><option value="">Select...</option>'+opts.map(x=>'<option value="'+escapeHtml(x.value)+'" '+(String(val)===String(x.value)?'selected':'')+'>'+escapeHtml(x.label)+'</option>').join('')+'</select>'}
else if(f.type==='textarea')field='<textarea id="fld-'+f.key+'" name="'+f.key+'">'+escapeHtml(val)+'</textarea>';
else {const sku=record.sku||lineSku(db,editingTable,record);const list=f.key==='uom'&&sku?[...new Set([byId(db,'ITEMS',sku)?.baseUom,...db.UOM_MAP.filter(x=>x.sku===sku).map(x=>x.uom)].filter(Boolean))]:[];const listName=f.key==='uom'?'uom-options-'+f.key:'';field='<input id="fld-'+f.key+'" name="'+f.key+'" type="'+(f.type==='number'?'number':f.type==='date'?'date':'text')+'" '+(f.type==='number'?'step="any"':'')+' value="'+escapeHtml(f.type==='date'?isoDate(val):val)+'" '+((f.key===SCHEMAS[editingTable].pk&&(editId||editingTable==='UOM_MAP'))?'readonly':'')+(listName?' list="'+listName+'"':'')+'>'+(listName?'<datalist id="'+listName+'">'+list.map(v=>'<option value="'+escapeHtml(v)+'"></option>').join('')+'</datalist>':'')}
return '<div class="field '+(f.type==='textarea'?'wide':'')+'">'+title+field+'</div>'}
function isoDate(v){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10)}
function genId(t){const prefix={BUYERS:'BUY',SUPPLIERS:'SUP',WAREHOUSES:'WH',ITEMS:'SKU',BUYER_PO:'BPO',BUYER_LINES:'BL',SUPPLIER_PO:'SPO',SUPPLIER_LINES:'SL',RECEIPTS:'GRN',ADJUSTMENTS:'ADJ',ALLOCATIONS:'ALC',CONTAINERS:'SHP',DISPATCH:'DSP'}[t]||'ROW';let n=1;while(byId(db,t,prefix+'-'+String(n).padStart(4,'0')))n++;return prefix+'-'+String(n).padStart(4,'0')}
function editorUnique(t){
 const pk=SCHEMAS[t].pk,used=new Set(db[t].map(x=>String(x[pk])));
 for(const x of editorLines)used.add(String(x[pk]||''));
 const prefix={BUYER_LINES:'BL',SUPPLIER_LINES:'SL',DISPATCH:'DSP',RECEIPTS:'GRN',ADJUSTMENTS:'ADJ',ALLOCATIONS:'ALC'}[t]||'ROW';
 let n=1,id='';do{id=prefix+'-'+String(n++).padStart(5,'0')}while(used.has(id));return id;
}
function addEditorLine(defaults={}){
 const parent=editingTable,child=editorMode==='document'?CHILDREN[parent].table:parent,pk=SCHEMAS[child].pk;
 const base=editorMode==='document'?{[CHILDREN[parent].link]:editorHeader[SCHEMAS[parent].pk]}:{};
 let next={...base,[pk]:child==='UOM_MAP'?'':editorUnique(child),...defaults};
 if(child==='UOM_MAP'){next.sku=editorHeader.sku;next.id=next.sku+'|'+(next.uom||'');next.factor=next.factor||1;next.active='Yes'}
 if(['BUYER_LINES','SUPPLIER_LINES'].includes(child)&&next.sku)next.uom=byId(db,'ITEMS',next.sku)?.baseUom||next.uom||'';
 if(['RECEIPTS','ALLOCATIONS','DISPATCH'].includes(child)&&!next.uom){
  const sku=lineSku(db,child,next);
  next.uom=byId(db,'ITEMS',sku)?.baseUom||'';
 }
 if(child==='RECEIPTS'){next.posting='Draft';next.quality='Accepted'}
 if(child==='ADJUSTMENTS')next.posting='Draft';
 if(child==='ALLOCATIONS')next.control='Active';
 if(child==='BUYER_LINES')next.cancelled=0;
 if(child==='SUPPLIER_LINES')next.rate=next.rate||0;
 if(SCHEMAS[child].fields.some(f=>f.key==='date')&&!next.date)next.date=new Date().toLocaleDateString('sv-SE');
 editorLines.push(next);
}
function renderEditor(){
 $('modal-backdrop').classList.remove('hidden');
 $('modal-backdrop').classList.add('editor-modal-backdrop');
 $('form-fields').className='form-grid editor-host';
 $('modal-title').textContent=(editId?'Edit ':'New ')+SCHEMAS[editingTable].title;
 $('modal-subtitle').textContent=editorMode==='document'?'DOCUMENT + ALL ITEMS':'MULTIPLE LINES · ONE SAVE';
 $('save-record').textContent=editorMode==='document'?'Save Document & Items':'Save All Rows';
 $('save-record').hidden=editorLocked;
 $('form-fields').innerHTML=editorMode==='document'?documentFormHTML(db,editingTable,editorHeader,editorLines,editorLocked):groupedFormHTML(db,editingTable,editorLines,editorLocked);
 $('record-form').onsubmit=saveEditor;
}
function openDocument(t,id=null,defaults={}){
 if(!may('read'))return notify('Read access required',true);
 const pk=SCHEMAS[t].pk,original=id?byId(db,t,id):null;
 if(id&&!original)return notify('Document not found',true);
 if(!id&&!canWrite(t))return notify('Create permission required',true);
 editingTable=t;editId=id;editorMode='document';editorRemoved=[];
 editorHeader=structuredClone(original||{[pk]:genId(t),...defaults});
 if(!id){const today=new Date().toLocaleDateString('sv-SE');if(SCHEMAS[t].fields.some(x=>x.key==='date')&&!editorHeader.date)editorHeader.date=today;if(['BUYER_PO','SUPPLIER_PO'].includes(t)&&!editorHeader.control)editorHeader.control='Active';if(t==='CONTAINERS'&&!editorHeader.status)editorHeader.status='Planning';if(t==='ITEMS'&&!editorHeader.active)editorHeader.active='Yes'}
 const child=CHILDREN[t],parentId=editorHeader[pk];
 editorLines=db[child.table].filter(x=>x[child.link]===parentId).map(x=>structuredClone(x));
 editorLocked=!canWrite(t)||t==='CONTAINERS'&&['Dispatched','Arrived'].includes(original?.status);
 if(!id&&t==='SUPPLIER_PO'&&workflowState.purchaseSku){
  addEditorLine({sku:workflowState.purchaseSku,uom:byId(db,'ITEMS',workflowState.purchaseSku)?.baseUom||''});
  workflowState.purchaseSku='';
 }
 if(!id&&!editorLines.length&&t!=='ITEMS')addEditorLine();
 renderEditor();
}
function openGrouped(t,id=null,defaults={}){
 if(!id&&!canWrite(t))return notify('Create permission required',true);
 const old=id?byId(db,t,id):null;if(id&&!old)return notify('Record not found',true);
 editingTable=t;editId=id;editorMode='entries';editorHeader=null;editorRemoved=[];editorLines=[];
 editorLocked=!canWrite(t)||!!(old?.posting==='Posted');
 if(old)editorLines.push(structuredClone(old));else addEditorLine(defaults);
 renderEditor();
}
function onEditorField(el){
 const mode=el.dataset.editorScope,field=el.dataset.editorField,index=Number(el.dataset.editorIndex);
 const target=mode==='header'?editorHeader:editorLines[index];if(!target)return;
 const table=mode==='header'?editingTable:editorMode==='document'?CHILDREN[editingTable].table:editingTable;
 const f=SCHEMAS[table].fields.find(x=>x.key===field);if(!f)return;
 target[field]=f.type==='number'?(el.value===''?'':Number(el.value)):el.value;
 if(table==='UOM_MAP'&&['uom','sku'].includes(field))target.id=target.sku+'|'+(target.uom||'');
 if(['sku','supplierLine','buyerLine','allocation'].includes(field)){
  const sku=lineSku(db,table,target);
  const preferred=byId(db,'ITEMS',sku)?.baseUom||'';
  if(preferred&&(!target.uom||field==='sku'))target.uom=preferred;
  renderEditor();
 }
}
function removeEditorLine(index){
 const child=editorMode==='document'?CHILDREN[editingTable].table:editingTable,pk=SCHEMAS[child].pk;
 const row=editorLines[index];if(!row)return;
 if(byId(db,child,row[pk]))editorRemoved.push(row[pk]);
 editorLines.splice(index,1);
 renderEditor();
}
function editorReadOnly(op){
 return (['RECEIPTS','ADJUSTMENTS'].includes(op.table)&&op.record?.posting==='Posted'
  ||op.table==='CONTAINERS'&&['Dispatched','Arrived'].includes(op.record?.status))
  &&op.kind!=='delete'&&!may('post',op.table);
}
async function commitPlan(plan,label){
 if(!plan.operations.length)return notify('Nothing to save',true);
 if(plan.operations.some(editorReadOnly))throw Error('Stock Posting role or Admin required for confirmed transactions');
 if(isLan()){
  db=await lanCommit(plan.operations,label);
 }else if(connected()){
  db=await applySheetChangeSet(plan.operations,db);
  try{await appendAudit('SAVE','MULTI',label,plan.operations.length+' record actions')}catch(e){notify(e.message,true)}
 }else{
  await saveLocal(plan.next);db=plan.next;
  try{await auditLocal('SAVE','MULTI',label)}catch(e){notify(e.message,true)}
 }
}
async function saveEditor(e){
 e.preventDefault();
 if(pending||editorLocked)return;
 try{
  let plan;
  if(editorMode==='document'){
   const child=CHILDREN[editingTable].table;
   if(['BUYER_PO','SUPPLIER_PO'].includes(editingTable)&&!editorLines.length)throw Error('Add at least one order item before saving');
   for(const line of editorLines){if(child==='UOM_MAP')line.id=editorHeader.sku+'|'+line.uom}
   plan=prepareDocument(db,editingTable,editorHeader,editorLines,editorRemoved);
  }else plan=prepareEntries(db,editingTable,editorLines,editorRemoved);
  pending=true;const name=editingTable,id=editorHeader?.[SCHEMAS[name].pk]||'Multiple rows';
  await commitPlan(plan,name+' '+id);
  closeModal();notify('Saved document and all item rows');render();
 }catch(err){notify(err.message,true);if(connected()&&/partial|changed|HTTP|timeout/i.test(err.message))await refresh().catch(()=>{})}
 finally{pending=false}
}
function selectedFor(t){return [...(checkedRows.get(t)||new Set())].filter(id=>!!byId(db,t,id))}
function beginBulk(t,kind){
 if(!canWrite(t))return notify('Write permission denied',true);
 const ids=selectedFor(t);
 if(!ids.length)return notify('Select one or more rows first',true);
 if(ids.length>150)return notify('Maximum 150 records per bulk operation',true);
 editorMode='bulk';editingTable=t;editId=null;editorLocked=false;
 bulkState={table:t,kind,ids,preview:null};
 $('modal-backdrop').classList.remove('hidden');$('modal-backdrop').classList.add('editor-modal-backdrop');
 $('form-fields').className='form-grid editor-host';
 $('modal-title').textContent=kind==='delete'?'Bulk Delete · '+SCHEMAS[t].title:'Bulk Edit · '+SCHEMAS[t].title;
 $('modal-subtitle').textContent=ids.length+' SELECTED RECORDS';
 if(kind==='edit'){
  $('form-fields').innerHTML=bulkEditFormHTML(t,ids);
  $('save-record').textContent='Preview Changes';$('save-record').hidden=false;
 }else{
  const plan=prepareBulkDelete(db,t,ids);bulkState.preview=plan;
  $('form-fields').innerHTML=bulkDeleteFormHTML(t,plan.operations,plan.errors.map(error=>({id:error.split(':')[0],error})));
  $('save-record').textContent='Delete Eligible Records';$('save-record').hidden=!plan.operations.length;
 }
 $('record-form').onsubmit=saveBulk;
}
function bulkFieldControl(){
 const f=SCHEMAS[editingTable].fields.find(x=>x.key===$('bulk-edit-field').value);
 if(!f)return;
 const el=$('bulk-edit-value');
 if(f.type==='select')el.innerHTML='<select id="bulk-edit-input">'+f.options.map(v=>'<option value="'+escapeHtml(v)+'">'+escapeHtml(v)+'</option>').join('')+'</select>';
 else el.innerHTML='<input id="bulk-edit-input" type="'+(f.type==='number'?'number':f.type==='date'?'date':'text')+'" '+(f.type==='number'?'step="any"':'')+' placeholder="New '+escapeHtml(f.label)+'">';
}
async function saveBulk(e){
 e.preventDefault();if(pending||!bulkState)return;
 try{
  if(bulkState.kind==='edit'&&!bulkState.preview){
   const field=$('bulk-edit-field')?.value;
   if(!field)throw Error('Choose a field');
   const val=$('bulk-edit-input')?.value??'';
   const f=SCHEMAS[bulkState.table].fields.find(x=>x.key===field);
   const value=f?.type==='number'?(val===''?'':Number(val)):val;
   bulkState.preview=prepareBulkEdit(db,bulkState.table,bulkState.ids,field,value);
   const plan=bulkState.preview;
   $('form-fields').innerHTML='<div class="notice">'+plan.operations.length+' valid changes; '+plan.errors.length+' blocked.</div>'+
    (plan.errors.length?'<div class="editor-blockers">'+plan.errors.slice(0,30).map(x=>'<p>'+escapeHtml(x)+'</p>').join('')+'</div>':'')+
    '<label class="editor-confirm"><input id="bulk-edit-confirm" type="checkbox"> Apply '+plan.operations.length+' valid changes</label>';
   $('save-record').textContent='Apply Bulk Edit';$('save-record').hidden=!plan.operations.length;
   return;
  }
  const confirmId=bulkState.kind==='delete'?'bulk-delete-confirm':'bulk-edit-confirm';
  if(!$(confirmId)?.checked)throw Error('Confirm the selected bulk action');
  const plan=bulkState.preview;if(!plan.operations.length)throw Error('No eligible changes');
  pending=true;await commitPlan(plan,bulkState.kind+' '+bulkState.table);
  checkedRows.delete(bulkState.table);closeModal();notify(plan.operations.length+' records processed');render();
 }catch(err){notify(err.message,true);if(connected()&&/changed|HTTP|timeout/i.test(err.message))await refresh().catch(()=>{})}
 finally{pending=false}
}
function openForm(t,id=null,defaults={}){
 if(CHILDREN[t])return openDocument(t,id,defaults);
 if(ENTRY_BATCH.has(t))return openGrouped(t,id,defaults);
 const owner=Object.keys(CHILDREN).find(k=>CHILDREN[k].table===t);
 if(owner){
  const config=CHILDREN[owner],record=id?byId(db,t,id):null,ref=record?.[config.link]||defaults[config.link];
  if(ref)return openDocument(owner,ref);
  return notify('Open the parent document to manage its items together',true);
 }
 if(!canWrite(t))return notify('This role cannot create or edit '+t,true);editingTable=t;editId=id;const s=SCHEMAS[t],r=id?byId(db,t,id):{[s.pk]:genId(t),...defaults};if(!r)return notify('Record not found',true);
 if(!id){const today=new Date().toLocaleDateString('sv-SE');if(s.fields.some(x=>x.key==='date')&&!r.date)r.date=today;if(t==='BUYER_LINES'&&r.po&&!r.uom)r.uom='';if(t==='ALLOCATIONS'&&r.buyerLine&&!r.uom){const l=byId(db,'BUYER_LINES',r.buyerLine);r.uom=byId(db,'ITEMS',l?.sku)?.baseUom||''}if(t==='RECEIPTS'&&r.supplierLine&&!r.uom){const l=byId(db,'SUPPLIER_LINES',r.supplierLine);r.uom=l?.uom||''}if(t==='DISPATCH'&&r.allocation&&!r.uom){const a=byId(db,'ALLOCATIONS',r.allocation);r.uom=byId(db,'ITEMS',byId(db,'BUYER_LINES',a?.buyerLine)?.sku)?.baseUom||''}}
if(id&&(['RECEIPTS','ADJUSTMENTS'].includes(t)&&r.posting==='Posted'||t==='CONTAINERS'&&['Dispatched','Arrived'].includes(r.status)))return notify('Posted records cannot be edited. Use a correcting transaction.',true);
$('modal-title').textContent=(id?'Edit ':'New ')+s.title;$('modal-subtitle').textContent=id?'UPDATE RECORD':'CREATE RECORD';$('form-fields').innerHTML=s.fields.map(f=>formInput(f,r)).join('');$('modal-backdrop').classList.remove('hidden');
$('record-form').onsubmit=saveForm;
}
function closeModal(){$('modal-backdrop').classList.add('hidden');$('modal-backdrop').classList.remove('editor-modal-backdrop');$('form-fields').className='form-grid';$('save-record').hidden=false;$('save-record').textContent='Save Record';editId=null;editingTable=null;editorMode='';editorHeader=null;editorLines=[];editorRemoved=[];bulkState=null}
async function saveForm(e){e.preventDefault();if(pending)return;if(!canWrite(editingTable))return notify('Write permission denied',true);const t=editingTable,s=SCHEMAS[t],old=editId?byId(db,t,editId):null,r={...(old||{})};for(const f of s.fields){const v=$('fld-'+f.key)?.value??'';r[f.key]=f.type==='number'?(v===''?'':Number(v)):v.trim()}
if(t==='UOM_MAP')r.id=r.sku+'|'+r.uom;
try{if((['RECEIPTS','ADJUSTMENTS'].includes(t)&&r.posting==='Posted'||t==='CONTAINERS'&&['Dispatched','Arrived'].includes(r.status))&&!may('post',t))throw Error('Stock posting / dispatch confirmation requires the Stock Posting role or Admin');validate(db,t,r,!!editId);if(t==='BUYER_LINES'&&N(r.cancelled)>(baseQty(db,r.sku,r.uom,r.qty)||0))throw Error('Cancelled quantity exceeds order');pending=true;
let saved=r;if(connected())saved=await putSheet(t,r,db,!!editId);const next=structuredClone(db);if(editId)next[t]=next[t].map(x=>x[s.pk]===editId?saved:x);else next[t].push(saved);
db=next;if(connected()){await updateWorkspaceMeta({count:TABLES.reduce((n,k)=>n+db[k].length,0)});try{await appendAudit(editId?'UPDATE':'CREATE',t,r[s.pk])}catch(err){notify(err.message,true)}}else{const fresh=await saveLocal(db);if(isLan())db=fresh;else await auditLocal(editId?'UPDATE':'CREATE',t,r[s.pk])}
const wasEdit=!!editId;closeModal();notify((wasEdit?'Updated':'Created')+' successfully');
 if(!wasEdit&&t==='BUYER_PO'){workflowState.orderId=r.id;setPage('orderdetail');if(canWrite('BUYER_LINES'))openForm('BUYER_LINES',null,{po:r.id});return}
 if(!wasEdit&&t==='SUPPLIER_PO'){const sku=workflowState.purchaseSku;workflowState.purchaseSku='';setPage('SUPPLIER_PO');if(canWrite('SUPPLIER_LINES')){const defaults={po:r.id};if(sku){defaults.sku=sku;defaults.uom=byId(db,'ITEMS',sku)?.baseUom||''}openForm('SUPPLIER_LINES',null,defaults)}return}
 if(!wasEdit&&t==='CONTAINERS'){workflowState.containerId=r.id;setPage('loadingdetail');return}
 if(t==='BUYER_LINES'){workflowState.orderId=r.po;setPage('orderdetail');return}
 if(t==='DISPATCH'){workflowState.containerId=r.shipment;setPage('loadingdetail');return}
 if(t==='RECEIPTS')return setPage('inward');
 if(t==='ALLOCATIONS')return setPage('requirements');
 render()}catch(err){notify(err.message,true);if(isLan())await refresh().catch(()=>{})}finally{pending=false}}
function hasReferences(t,id){const refs={BUYERS:[['BUYER_PO','buyer'],['CONTAINERS','buyer']],SUPPLIERS:[['ITEMS','supplier'],['SUPPLIER_PO','supplier']],WAREHOUSES:[['RECEIPTS','warehouse'],['ADJUSTMENTS','warehouse'],['ALLOCATIONS','warehouse']],ITEMS:[['UOM_MAP','sku'],['BUYER_LINES','sku'],['SUPPLIER_LINES','sku'],['ADJUSTMENTS','sku']],BUYER_PO:[['BUYER_LINES','po']],SUPPLIER_PO:[['SUPPLIER_LINES','po']],BUYER_LINES:[['ALLOCATIONS','buyerLine'],['SUPPLIER_LINES','buyerLine']],SUPPLIER_LINES:[['RECEIPTS','supplierLine']],ALLOCATIONS:[['DISPATCH','allocation']],CONTAINERS:[['DISPATCH','shipment']]}[t]||[];return refs.some(([target,key])=>db[target].some(x=>x[key]===id))}
async function removeRecord(t,id){
 if(!canWrite(t))return notify('Write permission denied',true);
 const plan=prepareBulkDelete(db,t,[id]);
 if(plan.errors.length)return notify('Cannot delete: '+plan.errors.join('; '),true);
 if(!confirm('Delete '+t+' / '+id+' permanently? This cannot be undone.'))return;
 try{pending=true;await commitPlan(plan,'DELETE '+t+' '+id);checkedRows.get(t)?.delete(id);notify('Record deleted');render()}
 catch(e){notify(e.message,true);if(connected())await refresh().catch(()=>{})}
 finally{pending=false}
}
async function refresh(){try{pending=true;if(isLan())await refreshLease();if(connected()){const data=await connectSheet(googleId());db=data.db}else db=await loadLocal();checkedRows.clear();render();notify('Database refreshed')}catch(e){notify(e.message,true)}finally{pending=false}}
function csvText(rows){const safe=x=>{let v=String(x??'');if(/^[=+\-@]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"'};return rows.map(r=>r.map(safe).join(',')).join('\r\n')}
function downloadFile(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function exportCsv(){const s=summarize(db);if(page==='dashboard'){downloadFile('operations_dashboard.csv',csvText([['Metric','Value'],['Open Buyer PO lines',s.buyerLines.filter(x=>x.outstanding>0&&x.status!=='Cancelled').length],['Partial shipped lines',s.buyerLines.filter(x=>x.shipped>0&&x.outstanding>0).length],['Low stock SKUs',s.stockRows.filter(x=>x.alert!=='OK').length],['Containers in transit',db.CONTAINERS.filter(x=>x.status==='Dispatched').length]]));return}if(page==='requirements'){const cols=['Buyer','PO','PO Line','SKU','UOM','Ordered','Dispatched','Outstanding','Reserved','Not Reserved','Required Date','Status'];const rows=buildRequirements(db).filter(x=>x.outstanding>0&&x.status!=='Cancelled').map(x=>[x.buyer,x.po,x.id,x.sku,x.baseUom,x.ordered,x.shipped,x.outstanding,x.reserved,x.unreserved,x.due,x.status]);downloadFile('buyer_requirements.csv',csvText([cols,...rows]));return}if(page==='outstanding'){const cols=['PO Line','Buyer','PO','SKU','Base UOM','Ordered','Shipped','Reserved','Outstanding','Required','Status'];const rows=s.buyerLines.map(x=>[x.id,x.buyer,x.po,x.sku,byId(db,'ITEMS',x.sku)?.baseUom,x.ordered,x.shipped,x.reserved,x.outstanding,x.due,x.status]);downloadFile('buyer_po_outstanding.csv',csvText([cols,...rows]));return}if(page==='stock'){const cols=['SKU','Description','UOM','Physical','Reserved','Available','Incoming','Demand','Min','Shortage','Alert'];downloadFile('stock_availability.csv',csvText([cols,...s.stockRows.map(x=>[x.sku,x.name,x.uom,x.physical,x.reserved,x.available,x.incoming,x.demand,x.min,x.shortage,x.alert])]));return}if(SCHEMAS[page]){const spec=SCHEMAS[page];downloadFile(page.toLowerCase()+'.csv',csvText([spec.fields.map(f=>f.label),...db[page].map(r=>spec.fields.map(f=>r[f.key]))]));return}notify('Open a table or report to export CSV')}
function demoData(){const d=emptyDb();const add=(t,r)=>d[t].push(r);['Atlas Retail','Summit Manufacturing','Northstar Imports','Blue River Components'].forEach((name,i)=>add('BUYERS',{id:'BUY-'+(i+1),name,country:'India',currency:'USD',active:'Yes'}));['Pearl Sourcing','Shenzhen Trading','Eastern Industrial','Delta Supply'].forEach((name,i)=>add('SUPPLIERS',{id:'SUP-'+(i+1),name,currency:'CNY',active:'Yes'}));add('WAREHOUSES',{id:'WH-1',name:'Main Godown',active:'Yes'});add('WAREHOUSES',{id:'WH-2',name:'Overflow Godown',active:'Yes'});
const products=[['SKU-001','Plastic fittings','PCS','CTN',24],['SKU-002','Industrial adhesive','KG','BAG',25],['SKU-003','Packaging fabric','MTR','ROLL',50],['SKU-004','Assembly kits','SET','BOX',12],['SKU-005','Copper wire','MTR','ROLL',100],['SKU-006','LED modules','PCS','CTN',40]];
products.forEach((p,i)=>{add('ITEMS',{sku:p[0],name:p[1],category:'Trading',baseUom:p[2],minStock:150,targetStock:900,supplier:'SUP-'+(i%4+1),active:'Yes'});add('UOM_MAP',{id:p[0]+'|'+p[2],sku:p[0],uom:p[2],factor:1,active:'Yes'});add('UOM_MAP',{id:p[0]+'|'+p[3],sku:p[0],uom:p[3],factor:p[4],active:'Yes'});for(let w=1;w<=2;w++)add('ADJUSTMENTS',{id:'OP-'+p[0]+'-'+w,date:'2026-09-01',sku:p[0],warehouse:'WH-'+w,qty:w===1?1500:700,uom:p[2],reason:'Opening',posting:'Posted',notes:'Fictional demonstration opening'})});
for(let i=1;i<=30;i++){const id='BPO-'+String(i).padStart(3,'0'),buyer='BUY-'+((i-1)%4+1),month=String(9+Math.floor((i-1)/15)).padStart(2,'0');add('BUYER_PO',{id,buyer,number:'DEMO-'+id,date:'2026-'+month+'-'+String((i-1)%25+1).padStart(2,'0'),due:'2026-12-'+String((i-1)%25+1).padStart(2,'0'),currency:'USD',control:i%13===0?'On Hold':'Active'});for(let j=1;j<=2;j++){const p=products[(i*2+j)%6],uom=i%4===0?p[3]:p[2],qty=uom===p[3]?4:100+(i%5)*25;add('BUYER_LINES',{id:'BL-'+String(i).padStart(3,'0')+'-'+j,po:id,sku:p[0],qty,uom,cancelled:i%17===0?10:0})}}
for(let i=1;i<=24;i++){const id='SPO-'+String(i).padStart(3,'0'),supplier='SUP-'+((i-1)%4+1);add('SUPPLIER_PO',{id,supplier,number:'CN-'+id,date:'2026-09-'+String((i-1)%25+1).padStart(2,'0'),eta:'2026-12-12',currency:'CNY',control:'Active'});for(let j=1;j<=2;j++){const p=products[(i*2+j)%6];add('SUPPLIER_LINES',{id:'SL-'+String(i).padStart(3,'0')+'-'+j,po:id,sku:p[0],qty:300,uom:p[2],rate:5+(i%8)})}}
let n=0;for(const line of d.SUPPLIER_LINES.slice(0,35)){n++;add('RECEIPTS',{id:'GRN-'+String(n).padStart(3,'0'),date:'2026-10-15',supplierLine:line.id,warehouse:n%2?'WH-1':'WH-2',qty:100,uom:line.uom,quality:n%9===0?'Hold':'Accepted',posting:n%9===0?'Draft':'Posted'})}
for(const line of d.BUYER_LINES.filter(line=>d.BUYER_PO.find(po=>po.id===line.po)?.control==='Active').slice(0,31)){const k=d.ALLOCATIONS.length+1;add('ALLOCATIONS',{id:'ALC-'+String(k).padStart(3,'0'),date:'2026-11-01',buyerLine:line.id,warehouse:'WH-1',qty:Math.min(50,Number(line.qty)),uom:products.find(p=>p[0]===line.sku)[2],control:'Active'})}
for(let i=0;i<19;i++){const a=d.ALLOCATIONS[i],l=d.BUYER_LINES.find(x=>x.id===a.buyerLine),po=d.BUYER_PO.find(x=>x.id===l.po),id='SHP-'+String(i+1).padStart(3,'0');add('CONTAINERS',{id,buyer:po.buyer,number:'DEMO-CNT-'+String(i+1).padStart(6,'0'),type:i%3===0?'20FT':i%3===1?'40FT':'40HC',status:i<12?'Dispatched':i<15?'Loaded':'Planning',etd:'2026-11-10',eta:'2026-12-05',destination:'Chennai'});add('DISPATCH',{id:'DSP-'+String(i+1).padStart(3,'0'),shipment:id,allocation:a.id,qty:Math.min(25,Math.max(1,Number(a.qty)/2)),uom:products.find(p=>p[0]===l.sku)[2]})}return d}
async function processAction(action){if(!currentUser())return notify('Sign in first',true);if(action==='lan-acquire'||action==='lan-release'){
  try{await leaseAction(action==='lan-acquire'?'acquire':'release');render();notify(action==='lan-acquire'?'Exclusive Edit Access granted':'Edit Access released')}catch(e){notify(e.message,true)}return;
 }
 if(action.startsWith('mark-arrived:')){
  const id=decodeURIComponent(action.slice('mark-arrived:'.length)),shipment=byId(db,'CONTAINERS',id);
  if(!shipment||shipment.status!=='Dispatched')return notify('Only dispatched containers can be marked Arrived',true);
  if(!canWrite('CONTAINERS')||!may('post','CONTAINERS'))return notify('Stock Posting permission required',true);
  if(!confirm('Mark shipment '+id+' as Arrived? This does not dispatch the goods a second time.'))return;
  try{pending=true;const plan=prepareDocument(db,'CONTAINERS',{...shipment,status:'Arrived'},[],[]);await commitPlan(plan,'ARRIVED '+id);notify('Container marked Arrived');render()}catch(e){notify(e.message,true)}
  finally{pending=false}return;
 }
 if(action.startsWith('bulk-edit:'))return beginBulk(action.slice('bulk-edit:'.length),'edit');
 if(action.startsWith('bulk-delete:'))return beginBulk(action.slice('bulk-delete:'.length),'delete');
 if(action.startsWith('bulk-clear:')){checkedRows.delete(action.slice('bulk-clear:'.length));render();return}
 if(action.startsWith('template-table:')){try{downloadTableTemplate(action.slice('template-table:'.length))}catch(e){notify(e.message,true)}return}if(action.startsWith('bulk-page:')){chooseBulkTable(action.slice('bulk-page:'.length));return setPage('bulk')}if(isLan()&&['import','demo','clear-local','connect','create-sheet','publish-local','open-linked','save-as-linked','unlink-excel','disconnect'].includes(action))return notify('LAN database is controlled on the server. Use admin Database Details.',true);
 if(['import','demo','clear-local','connect','create-sheet','publish-local','open-linked','save-as-linked','unlink-excel','disconnect'].includes(action)&&!isAdmin())return notify('Only the administrator can change databases or load full snapshots',true);if(action.startsWith('flow-order:')){workflowState.orderId=decodeURIComponent(action.slice('flow-order:'.length));return setPage('orderdetail')}
 if(action.startsWith('view-loading:')){workflowState.containerId=decodeURIComponent(action.slice('view-loading:'.length));return setPage('loadingdetail')}
 if(action.startsWith('open-buyer:')){workflowState.buyer=decodeURIComponent(action.slice('open-buyer:'.length));workflowState.search='';return setPage('orders')}
 if(action.startsWith('new-po-line:'))return openForm('BUYER_LINES',null,{po:decodeURIComponent(action.slice('new-po-line:'.length))});
 if(action.startsWith('new-reservation:'))return openForm('ALLOCATIONS',null,{buyerLine:decodeURIComponent(action.slice('new-reservation:'.length))});
 if(action.startsWith('new-supplier-for:')){const sku=decodeURIComponent(action.slice('new-supplier-for:'.length));const item=byId(db,'ITEMS',sku);if(!item)return notify('Item does not exist',true);workflowState.purchaseSku=sku;return openForm('SUPPLIER_PO',null,{supplier:item.supplier||''})}
 if(action.startsWith('new-loading-reservation:'))return openForm('DISPATCH',null,{allocation:decodeURIComponent(action.slice('new-loading-reservation:'.length))});
 if(action.startsWith('new-receipt:'))return openForm('RECEIPTS',null,{supplierLine:decodeURIComponent(action.slice('new-receipt:'.length))});
 if(action.startsWith('new-container-line:'))return openForm('DISPATCH',null,{shipment:decodeURIComponent(action.slice('new-container-line:'.length))});
 if(action.startsWith('new:'))return openForm(action.slice(4));
 if(action==='add'){const t=primaryEntry();if(!t)return;return openForm(t,null,quickDefaults(t))}if(action.startsWith('go:'))return setPage(action.slice(3));if(action.startsWith('edit:')){const a=action.split(':');return openForm(a[1],decodeURIComponent(a.slice(2).join(':')))}if(action.startsWith('delete:')){const a=action.split(':');return removeRecord(a[1],a.slice(2).join(':'))}if(action==='csv'||action==='dashboard-csv')return exportCsv();if(action==='next'){pageNumber++;return render()}if(action==='previous'){pageNumber=Math.max(1,pageNumber-1);return render()}
if(action==='import')return $('import-file').click();
if(action==='open-linked'){if(connected())return notify('Disconnect Google Sheets before opening a local workbook.',true);if(!confirm('Open a live Excel file and replace the active local workspace?'))return;try{db=await openLinkedExcel();checkedRows.clear();notify('Live Excel linked: '+linkedFileName());render()}catch(e){notify(e.message,true)}return}
if(action==='save-as-linked'){if(connected())return notify('Disconnect Google Sheets before linking a local file.',true);try{const name=await saveAsLinkedExcel(db);notify('Auto-save enabled: '+name);render()}catch(e){notify(e.message,true)}return}
if(action==='unlink-excel'){unlinkExcel();notify('Live Excel file unlinked; local browser storage retained');render();return}if(action==='template'||action==='export'){try{downloadExcel(db,action==='template')}catch(e){notify(e.message,true)}return}
if(action==='demo'){if(connected())return notify('Disconnect Google Sheets before loading local demo data.',true);if(!confirm('Replace LOCAL records with fictional demo data? This overwrites a linked Excel file, if attached!'))return;checkedRows.clear();db=demoData();await saveLocal(db);notify('Demonstration dataset loaded');return render()}
if(action==='clear-local'){if(connected())return notify('Disconnect Google Sheets first.',true);if(!confirm('Delete ALL local data? This also clears a linked Excel file, if attached!'))return;checkedRows.clear();db=emptyDb();await saveLocal(db);return render()}
if(action==='disconnect'){db=await restoreLocalWorkspace();checkedRows.clear();return render()}
if(action==='publish-local'){if(!connected())return notify('Connect a blank Google Sheet first.',true);if(!confirm('Copy all saved LOCAL browser records into the CONNECTED EMPTY Google Sheet? This is a one-way import.'))return;try{pending=true;const result=await uploadLocalSnapshotToGoogle(db);db=result.db;checkedRows.clear();notify('Local records uploaded to Google Sheets');render()}catch(e){notify(e.message,true)}finally{pending=false}return}
if(action==='connect'||action==='create-sheet'){try{pending=true;const clientId=$('oauth-client')?.value.trim(),existing=$('spreadsheet-id')?.value.trim();localStorage.setItem('flowstock-client-id',clientId);await authorize(clientId);const result=action==='create-sheet'?await createSheet():await connectSheet(existing);db=result.db;checkedRows.clear();localStorage.setItem('flowstock-last-sheet',result.id);notify('Connected: '+result.title);render()}catch(e){notify(e.message,true)}finally{pending=false}}
}
function start(){
 document.addEventListener('click',e=>{
  if(!currentUser()||currentUser().mustChangePassword)return;
  if(e.target.closest('[data-editor-add]')){
   if(editorLocked||!['document','entries'].includes(editorMode))return;
   addEditorLine();renderEditor();return;
  }
  const remove=e.target.closest('[data-editor-remove]');
  if(remove){if(!editorLocked)removeEditorLine(Number(remove.dataset.editorRemove));return}
  const nav=e.target.closest('[data-page]');if(nav)return setPage(nav.dataset.page);const action=e.target.closest('[data-action]');if(action)return processAction(action.dataset.action).catch(err=>notify(err.message,true))});$('record-form').addEventListener('change',e=>{
 const field=e.target.closest('[data-editor-field]');if(field&&['document','entries'].includes(editorMode)){onEditorField(field);return}
 if(e.target.id==='bulk-edit-field'){bulkFieldControl();return}
 if(editingTable==='UOM_MAP'&&['sku','uom'].includes(e.target.name))$('fld-id').value=($('fld-sku').value||'')+'|'+($('fld-uom').value||'');if(['sku','supplierLine','buyerLine','allocation'].includes(e.target.name)){let sku=$('fld-sku')?.value||'';if(!sku&&editingTable==='RECEIPTS')sku=lineSku(db,'RECEIPTS',{supplierLine:$('fld-supplierLine')?.value});if(!sku&&editingTable==='ALLOCATIONS')sku=lineSku(db,'ALLOCATIONS',{buyerLine:$('fld-buyerLine')?.value});if(!sku&&editingTable==='DISPATCH')sku=lineSku(db,'DISPATCH',{allocation:$('fld-allocation')?.value});const suggestions=[...new Set([byId(db,'ITEMS',sku)?.baseUom,...db.UOM_MAP.filter(x=>x.sku===sku&&x.active!=='No').map(x=>x.uom)].filter(Boolean))];const list=$('uom-options-uom');if(list)list.innerHTML=suggestions.map(v=>'<option value="'+escapeHtml(v)+'"></option>').join('');const uom=$('fld-uom');if(uom&&!uom.value)uom.value=suggestions[0]||'';}});
$('mobile-menu').onclick=()=>$('sidebar').classList.toggle('open');$('shade').onclick=()=>{$('sidebar').classList.remove('open');$('shade').classList.remove('open')};$('mobile-menu').addEventListener('click',()=>$('shade').classList.add('open'));$('close-modal').onclick=closeModal;$('cancel-modal').onclick=closeModal;$('modal-backdrop').onclick=e=>{if(e.target===$('modal-backdrop'))closeModal()};$('refresh').onclick=refresh;$('quick-add').onclick=()=>processAction('add');document.addEventListener('change',e=>{
  const row=e.target.closest('[data-bulk-row]');
  if(row){const t=row.dataset.bulkRow,id=row.value,set=checkedRows.get(t)||new Set();if(row.checked)set.add(id);else set.delete(id);checkedRows.set(t,set);render();return}
  const all=e.target.closest('[data-bulk-all]');
  if(all){const t=all.dataset.bulkAll,set=checkedRows.get(t)||new Set();document.querySelectorAll('[data-bulk-row]').forEach(box=>{if(box.dataset.bulkRow===t){if(all.checked)set.add(box.value);else set.delete(box.value)}});checkedRows.set(t,set);render();return}
  if(e.target.id==='workflow-buyer'){workflowState.buyer=e.target.value;render()}
 });
 document.addEventListener('input',e=>{if(e.target.id==='workflow-search'){const pos=e.target.selectionStart;workflowState.search=e.target.value;render();const input=$('workflow-search');input?.focus();input?.setSelectionRange(pos,pos);return}if(e.target.id==='table-search'){const start=e.target.selectionStart;search=e.target.value;pageNumber=1;render();const field=$('table-search');field?.focus();field?.setSelectionRange(start,start)}});$('import-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;if(connected())return notify('Disconnect Google Sheets before importing local Excel.',true);if(!confirm('Import and replace local records from '+f.name+'? This also overwrites a linked Excel file, if attached!'))return;try{db=await importExcel(f);checkedRows.clear();await saveLocal(db);notify('Imported '+TABLES.reduce((s,t)=>s+db[t].length,0)+' records');setPage('dashboard')}catch(err){notify(err.message,true)}finally{e.target.value=''}};initializeAdminBridge({db:()=>db,setDb:x=>{db=x;checkedRows.clear()},render,setPage,notify,refresh,setPending:v=>{pending=v},demoData}).then(()=>loadLocal()).then(x=>{db=x;render();if(isLan())setInterval(async()=>{if(!currentUser()||currentUser().mustChangePassword)return;try{const before=JSON.stringify(lanLease());const status=await lanPoll();if(status.changed&&!pending&&$('modal-backdrop').classList.contains('hidden')){db=await loadLocal();checkedRows.clear();render()}else if(before!==JSON.stringify(lanLease()))render()}catch{}},12000)}).catch(e=>notify('Startup failed: '+e.message,true));}
start();
if('serviceWorker' in navigator&&window.isSecureContext){navigator.serviceWorker.register('./service-worker.js').catch(()=>{})}
