import {SCHEMAS,byId,validate,diagnostics,baseQty} from './core.js';

// A change set is staged and validated before writing. All edits preserve stable IDs.
export const CHILDREN={BUYER_PO:{table:'BUYER_LINES',link:'po'},SUPPLIER_PO:{table:'SUPPLIER_LINES',link:'po'},CONTAINERS:{table:'DISPATCH',link:'shipment'},ITEMS:{table:'UOM_MAP',link:'sku'}};
export const ENTRY_BATCH=new Set(['RECEIPTS','ADJUSTMENTS','ALLOCATIONS']);
export const RELATIONS={
 BUYERS:[['BUYER_PO','buyer'],['CONTAINERS','buyer']],
 SUPPLIERS:[['SUPPLIER_PO','supplier'],['ITEMS','supplier']],
 WAREHOUSES:[['RECEIPTS','warehouse'],['ADJUSTMENTS','warehouse'],['ALLOCATIONS','warehouse']],
 ITEMS:[['BUYER_LINES','sku'],['SUPPLIER_LINES','sku'],['ADJUSTMENTS','sku'],['UOM_MAP','sku']],
 BUYER_PO:[['BUYER_LINES','po']],
 SUPPLIER_PO:[['SUPPLIER_LINES','po']],
 BUYER_LINES:[['ALLOCATIONS','buyerLine'],['SUPPLIER_LINES','buyerLine']],
 SUPPLIER_LINES:[['RECEIPTS','supplierLine']],
 CONTAINERS:[['DISPATCH','shipment']],
 ALLOCATIONS:[['DISPATCH','allocation']]
};
const keyOf=(table,row)=>String(row?.[SCHEMAS[table].pk]??'');
const copy=db=>structuredClone(db);
export function deleteBlocker(db,table,id){
 const record=byId(db,table,id);
 if(!record)return 'Record not found';
 if(['RECEIPTS','ADJUSTMENTS'].includes(table)&&record.posting==='Posted')return 'Posted stock entry cannot be deleted';
 if(table==='CONTAINERS'&&['Dispatched','Arrived'].includes(record.status))return 'Confirmed shipment cannot be deleted';
 if(table==='DISPATCH'&&['Dispatched','Arrived'].includes(byId(db,'CONTAINERS',record.shipment)?.status))return 'Confirmed dispatch line cannot be deleted';
 if(table==='ALLOCATIONS'&&db.DISPATCH.some(d=>d.allocation===id))return 'Loading records exist for this reservation';
 if(table==='UOM_MAP'){
  const item=byId(db,'ITEMS',record.sku),base=item?.baseUom===record.uom;
  const used=['BUYER_LINES','SUPPLIER_LINES','ADJUSTMENTS'].some(t=>db[t].some(x=>x.sku===record.sku&&x.uom===record.uom))
   ||db.RECEIPTS.some(x=>byId(db,'SUPPLIER_LINES',x.supplierLine)?.sku===record.sku&&x.uom===record.uom)
   ||db.ALLOCATIONS.some(x=>byId(db,'BUYER_LINES',x.buyerLine)?.sku===record.sku&&x.uom===record.uom)
   ||db.DISPATCH.some(x=>byId(db,'ALLOCATIONS',x.allocation)&&byId(db,'BUYER_LINES',byId(db,'ALLOCATIONS',x.allocation)?.buyerLine)?.sku===record.sku&&x.uom===record.uom);
  if(used||base)return 'Conversion is in use or is the base UOM';
 }
 for(const [target,field] of RELATIONS[table]||[]){
  if(db[target]?.some(x=>String(x[field]||'')===String(id)))return target+' has linked records';
 }
 return '';
}
function stageDelete(next,table,id,operations){
 const reason=deleteBlocker(next,table,id);if(reason)throw Error(table+' '+id+': '+reason);
 next[table]=next[table].filter(r=>keyOf(table,r)!==String(id));
 operations.push({kind:'delete',table,id});
}
function stageUpsert(next,table,record,operations){
 const pk=SCHEMAS[table].pk,id=String(record[pk]||''),old=byId(next,table,id),editing=!!old;
 if(!id)throw Error(table+' requires ID');
 validate(next,table,record,editing);
 if(old)next[table]=next[table].map(x=>keyOf(table,x)===id?{...old,...record}:x);
 else next[table].push({...record});
 operations.push({kind:editing?'update':'create',table,record:{...old,...record}});
}
function normalizedLine(parentTable,parentId,line){
 const config=CHILDREN[parentTable],r={...line,[config.link]:parentId};
 if(config.table==='UOM_MAP')r.id=r.sku+'|'+r.uom;
 return r;
}
function stageParent(next,table,record,operations){
 if(table==='CONTAINERS'&&['Dispatched','Arrived'].includes(record.status)){
  const old=byId(next,table,record.id);
  if(!old)stageUpsert(next,table,{...record,status:'Loaded'},operations);
  else stageUpsert(next,table,{...record,status:'Loaded'},operations);
 }else stageUpsert(next,table,record,operations);
}
export function prepareDocument(db,table,header,lines=[],removed=[]){
 const next=copy(db),operations=[],config=CHILDREN[table];
 if(!config)throw Error('No child table registered for '+table);
 const pk=SCHEMAS[table].pk,parentId=String(header[pk]||'');
 if(!parentId)throw Error('Document ID required');
 const existing=byId(db,table,parentId);
 if(existing&&table==='CONTAINERS'&&['Dispatched','Arrived'].includes(existing.status)){
  if(lines.length||removed.length)throw Error('Confirmed container cannot change loading items');
 }
 // Delete child lines before changing parent references.
 for(const id of removed)stageDelete(next,config.table,id,operations);
 if(existing&&table==='CONTAINERS'&&header.status==='Arrived'&&existing.status==='Dispatched'){
  stageUpsert(next,table,header,operations);
 }else{
  const draftHeader=table==='CONTAINERS'&&['Dispatched','Arrived'].includes(header.status)
    ?{...header,status:'Loaded'}:header;
  stageUpsert(next,table,draftHeader,operations);
 }
 for(const line of lines){
  if(line.__removed)continue;
  const r=normalizedLine(table,parentId,line);
  if(!String(r[SCHEMAS[config.table].pk]||'').trim())continue;
  stageUpsert(next,config.table,r,operations);
 }
 if(table==='CONTAINERS'&&['Dispatched','Arrived'].includes(header.status)){
  const current=byId(next,table,parentId);
  if(current.status==='Loaded'){
   const dispatch={...current,status:'Dispatched'};
   stageUpsert(next,table,dispatch,operations);
  }
  if(header.status==='Arrived'&&byId(next,table,parentId).status==='Dispatched'){
   stageUpsert(next,table,{...header,status:'Arrived'},operations);
  }
 }
 const before=new Set(diagnostics(db).filter(x=>!x.ok).map(x=>x.title));
 const violations=diagnostics(next).filter(x=>!x.ok&&!before.has(x.title));
 if(violations.length)throw Error('Document check failed: '+violations.slice(0,3).map(x=>x.title).join(', '));
 return {next,operations};
}
export function prepareEntries(db,table,entries=[],removed=[]){
 if(!ENTRY_BATCH.has(table))throw Error('Not a grouped entry table');
 const next=copy(db),operations=[];
 for(const id of removed)stageDelete(next,table,id,operations);
 for(const r of entries){
  if(!String(r[SCHEMAS[table].pk]||'').trim())continue;
  stageUpsert(next,table,r,operations);
 }
 if(!operations.length)throw Error('Enter at least one row');
 const before=new Set(diagnostics(db).filter(x=>!x.ok).map(x=>x.title));
 const violations=diagnostics(next).filter(x=>!x.ok&&!before.has(x.title));
 if(violations.length)throw Error('Stock check failed: '+violations.slice(0,3).map(x=>x.title).join(', '));
 return {next,operations};
}
export function prepareBulkEdit(db,table,ids,field,value){
 const schema=SCHEMAS[table],f=schema?.fields.find(x=>x.key===field);
 if(!f||f.key===schema.pk||f.type==='ref'||field==='uom'||field==='sku'||field==='baseUom')throw Error('This field cannot be bulk changed');
 if(['posting','status'].includes(field))throw Error('Posting or shipment status requires individual approval');
 if(!ids.length)throw Error('No records selected');
 if(ids.length>150)throw Error('Select 150 or fewer records per operation');
 const next=copy(db),operations=[],errors=[];
 for(const id of ids){
  const old=byId(next,table,id);if(!old){errors.push(id+': Missing');continue}
  const row={...old,[field]:value};
  try{stageUpsert(next,table,row,operations)}catch(e){errors.push(id+': '+e.message)}
 }
 return {next,operations,errors};
}
export function prepareBulkDelete(db,table,ids){
 if(!ids.length)throw Error('No records selected');
 if(ids.length>150)throw Error('Select 150 or fewer records per operation');
 const next=copy(db),operations=[],errors=[];
 for(const id of ids){try{stageDelete(next,table,id,operations)}catch(e){errors.push(id+': '+e.message)}}
 return {next,operations,errors};
}
