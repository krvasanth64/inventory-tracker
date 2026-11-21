import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDb} from '../core.js';
import {previewBulk} from '../bulk.js';
function sample(){
 const d=emptyDb();d.BUYERS=[{id:'B1',name:'Buyer One',active:'Yes'}];d.SUPPLIERS=[{id:'S1',name:'Supplier One',active:'Yes'}];d.WAREHOUSES=[{id:'W1',name:'Main warehouse',active:'Yes'}];
 d.ITEMS=[{sku:'SKU1',name:'Part A',baseUom:'PCS',active:'Yes'}];d.UOM_MAP=[{id:'SKU1|CTN',sku:'SKU1',uom:'CTN',factor:20,active:'Yes'}];
 d.BUYER_PO=[{id:'BP1',buyer:'B1',control:'Active'}];d.BUYER_LINES=[{id:'BL1',po:'BP1',sku:'SKU1',qty:10,uom:'CTN',cancelled:0}];
 d.SUPPLIER_PO=[{id:'SP1',supplier:'S1',control:'Active'}];d.SUPPLIER_LINES=[{id:'SL1',po:'SP1',sku:'SKU1',qty:20,uom:'CTN'}];
 d.RECEIPTS=[{id:'GR1',date:'2026-11-21',supplierLine:'SL1',warehouse:'W1',qty:15,uom:'CTN',quality:'Accepted',posting:'Posted'}];
 d.ALLOCATIONS=[{id:'A1',buyerLine:'BL1',warehouse:'W1',qty:5,uom:'CTN',control:'Active'}];
 d.CONTAINERS=[{id:'C1',buyer:'B1',type:'20FT',status:'Dispatched'}];
 d.DISPATCH=[{id:'D1',shipment:'C1',allocation:'A1',qty:2,uom:'CTN'}];
 return d;
}
function source(d){return {source:'test.xlsx',rows:Object.entries(d).flatMap(([table,rows])=>rows.map((record,index)=>({table,record,excelRow:index+7}))) }}
test('full import stages confirmed containers and posts dispatch after loading',()=>{
 const x=previewBulk(source(sample()),emptyDb(),{allowedTable:()=>true});
 assert.equal(x.counts.error,0);assert.equal(x.canApply,true);
 assert.equal(x.counts.finalize,1);assert.equal(x.draft.CONTAINERS[0].status,'Dispatched');
});
test('duplicate file IDs are preflight errors',()=>{
 const d=sample(),s=source(d);s.rows.push({...s.rows[0]});
 const x=previewBulk(s,emptyDb(),{allowedTable:()=>true});assert.ok(x.counts.error>0);assert.equal(x.canApply,false);
});
test('data-entry role cannot import masters',()=>{
 const x=previewBulk(source(sample()),emptyDb(),{allowedTable:table=>!['BUYERS','SUPPLIERS','WAREHOUSES','ITEMS','UOM_MAP'].includes(table)});
 assert.ok(x.counts.error>0);assert.equal(x.canApply,false);
});
test('skip existing records does not overwrite them',()=>{
 const d=sample(),s={source:'test.xlsx',rows:[{table:'BUYERS',record:{id:'B1',name:'Overwritten?'}}]};
 const x=previewBulk(s,d,{mode:'skip',allowedTable:()=>true});
 assert.equal(x.counts.skip,1);assert.equal(x.draft.BUYERS[0].name,'Buyer One');
});
test('posted receipt mutation is rejected at preflight',()=>{
 const d=sample(),s={source:'test.xlsx',rows:[{table:'RECEIPTS',record:{...d.RECEIPTS[0],qty:20}}]};
 const x=previewBulk(s,d,{mode:'update',allowedTable:()=>true});
 assert.ok(x.counts.error>0);
});
