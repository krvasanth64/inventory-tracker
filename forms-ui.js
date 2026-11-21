import {SCHEMAS,byId,lineSku} from './core.js';
import {CHILDREN,ENTRY_BATCH} from './operations.js';
const e=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const attrs=(table,field,index,mode)=>'data-editor-scope="'+mode+'" data-editor-index="'+index+'" data-editor-field="'+field+'"';
export function linkedSKU(db,table,row){
 if(table==='RECEIPTS')return byId(db,'SUPPLIER_LINES',row.supplierLine)?.sku||'';
 if(table==='ALLOCATIONS')return byId(db,'BUYER_LINES',row.buyerLine)?.sku||'';
 if(table==='DISPATCH')return lineSku(db,'DISPATCH',row)||'';
 return row.sku||'';
}
function uomOptions(db,table,row){
 const sku=linkedSKU(db,table,row),item=byId(db,'ITEMS',sku);
 return [...new Set([item?.baseUom,...db.UOM_MAP.filter(x=>x.sku===sku&&x.active!=='No').map(x=>x.uom)].filter(Boolean))];
}
function options(db,field,row,table){
 if(field.key==='uom'&&table!=='UOM_MAP')return uomOptions(db,table,row).map(x=>({id:x,label:x}));
 if(field.type==='ref')return db[field.ref].map(x=>({id:x[SCHEMAS[field.ref].pk],label:(x.name||x.number||x.sku||x.id)+' · '+x[SCHEMAS[field.ref].pk]}));
 if(field.type==='select')return (field.options||[]).map(x=>({id:x,label:x}));
 return null;
}
export function fieldControl(db,table,field,row,mode,index,locked=false){
 const value=row[field.key]??'',flags=attrs(table,field.key,index,mode)+(locked?' disabled':'');
 const choices=options(db,field,row,table),skip=field.key===SCHEMAS[table].pk||field.key==='po'||field.key==='shipment'||field.key==='sku'&&table==='UOM_MAP';
 if(skip)return '<span class="editor-fixed">'+e(value||'—')+'</span>';
 if(choices)return '<select '+flags+'><option value="">Select…</option>'+choices.map(x=>'<option value="'+e(x.id)+'"'+(String(x.id)===String(value)?' selected':'')+'>'+e(x.label)+'</option>').join('')+'</select>';
 if(field.type==='textarea')return '<textarea '+flags+' rows="2">'+e(value)+'</textarea>';
 return '<input '+flags+' type="'+(field.type==='number'?'number':field.type==='date'?'date':'text')+'"'+(field.type==='number'?' step="any"':'')+' value="'+e(value)+'">';
}
function recordFields(db,table,record,mode='header',locked=false){
 return '<div class="editor-fields">'+SCHEMAS[table].fields.map(f=>'<label class="editor-field"><span>'+e(f.label)+'</span>'+fieldControl(db,table,f,record,mode,0,locked)+'</label>').join('')+'</div>';
}
function inlineGrid(db,parent,child,lines,locked){
 const s=SCHEMAS[child],omit=new Set([CHILDREN[parent].link]);
 const visible=s.fields.filter(f=>!omit.has(f.key));
 const rows=lines.map((r,i)=>'<tr data-editor-row="'+i+'">'+visible.map(f=>'<td><div class="editor-cell">'+fieldControl(db,child,f,r,'line',i,locked)+'</div></td>').join('')+'<td><button class="text-btn danger" type="button" data-editor-remove="'+i+'" '+(locked?'disabled':'')+' title="Remove this line">Remove</button></td></tr>').join('');
 return '<div class="editor-section"><div class="editor-section-head"><div><h3>'+e(s.title)+'</h3><p>Enter all items here before saving the document.</p></div><button type="button" class="btn btn-ghost" data-editor-add '+(locked?'disabled':'')>+ Add Row</button></div><div class="table-wrap editor-table-wrap"><table class="data-table editor-table"><thead><tr>'+visible.map(f=>'<th>'+e(f.label)+'</th>').join('')+'<th>Action</th></tr></thead><tbody>'+(rows||'<tr><td colspan="'+(visible.length+1)+'" class="empty">Add your first item row.</td></tr>')+'</tbody></table></div></div>';
}
export function documentFormHTML(db,parent,header,lines,locked=false){
 const child=CHILDREN[parent]?.table;if(!child)throw Error('Unsupported document');
 return '<div class="editor-document">'+
 '<div class="editor-section"><div class="editor-section-head"><div><h3>Document Details</h3><p>Enter the order or document information once.</p></div></div>'+
 recordFields(db,parent,header,'header',locked)+'</div>'+
 inlineGrid(db,parent,child,lines,locked)+
 '<div class="editor-notice">The system checks linked items, UOM conversions and available stock before saving. Confirmed stock postings cannot be changed or deleted.</div>'+
 '</div>';
}
export function groupedFormHTML(db,table,rows,locked=false){
 if(!ENTRY_BATCH.has(table))throw Error('Unsupported grouped table');
 const visible=SCHEMAS[table].fields;
 const tableRows=rows.map((r,i)=>'<tr data-editor-row="'+i+'">'+visible.map(f=>'<td>'+fieldControl(db,table,f,r,'line',i,locked)+'</td>').join('')+'<td><button type="button" class="text-btn danger" data-editor-remove="'+i+'" '+(locked?'disabled':'')+'>Remove</button></td></tr>').join('');
 return '<div class="editor-document"><div class="editor-section"><div class="editor-section-head"><div><h3>'+e(SCHEMAS[table].title)+'</h3><p>Add multiple records and save together. Each row keeps its own receipt, adjustment or reservation ID.</p></div><button type="button" class="btn btn-ghost" data-editor-add '+(locked?'disabled':'')>+ Add Row</button></div><div class="table-wrap editor-table-wrap"><table class="data-table editor-table"><thead><tr>'+visible.map(f=>'<th>'+e(f.label)+'</th>').join('')+'<th>Action</th></tr></thead><tbody>'+tableRows+'</tbody></table></div></div><div class="editor-notice">Receipts and stock adjustments use Draft by default. Posted transactions are immutable.</div></div>';
}
export function bulkEditFormHTML(table,ids){
 const fields=SCHEMAS[table].fields.filter(f=>!['id','sku','po','uom','factor','baseUom','posting','status'].includes(f.key)&&f.key!==SCHEMAS[table].pk&&f.type!=='ref');
 return '<div class="bulk-editor"><div class="notice">Selected records: <strong>'+ids.length+'</strong>. Only one common field changes; all other fields remain untouched. Changes are validated before saving.</div><label class="field"><span>Field to change</span><select id="bulk-edit-field"><option value="">Choose field…</option>'+fields.map(f=>'<option value="'+e(f.key)+'">'+e(f.label)+'</option>').join('')+'</select></label><label class="field"><span>New value</span><div id="bulk-edit-value"><input id="bulk-edit-input" placeholder="Enter new value"></div></label></div>';
}
export function bulkDeleteFormHTML(table,canDelete,blocked){
 return '<div class="bulk-editor"><div class="notice warning"><strong>Delete preview:</strong> '+canDelete.length+' eligible, '+blocked.length+' protected. Deletion cannot be undone. Export a backup first.</div>'+ (blocked.length?'<div class="editor-blockers"><strong>Protected records</strong>'+blocked.slice(0,20).map(x=>'<div>'+e(x.id)+' — '+e(x.error)+'</div>').join('')+'</div>':'')+'<p>Only records that have no protected dependencies will be deleted. Posted stock, completed dispatches and linked masters remain protected.</p><label class="editor-confirm"><input id="bulk-delete-confirm" type="checkbox"> I confirm permanent deletion of '+canDelete.length+' eligible records.</label></div>';
}
