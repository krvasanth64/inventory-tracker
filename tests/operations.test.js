import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDb,summarize} from '../core.js';
import {prepareDocument,prepareEntries,prepareBulkEdit,prepareBulkDelete,deleteBlocker} from '../operations.js';
function setup(){
 const db=emptyDb();
 db.BUYERS=[{id:'B1',name:'Buyer One'}];db.SUPPLIERS=[{id:'S1',name:'Supplier One'}];
 db.WAREHOUSES=[{id:'W1',name:'Main'}];
 db.ITEMS=[{sku:'SKU1',name:'Widget',baseUom:'PCS',minStock:5,supplier:'S1'}];
 return db;
}
test('single popup creates Buyer PO and multiple items in one validated change set',()=>{
 const db=setup();
 const {next,operations}=prepareDocument(db,'BUYER_PO',{id:'PO1',buyer:'B1',control:'Active'},[
  {id:'L1',sku:'SKU1',qty:20,uom:'PCS',cancelled:0},
  {id:'L2',sku:'SKU1',qty:10,uom:'PCS',cancelled:0}
 ],[]);
 assert.equal(next.BUYER_PO.length,1);
 assert.equal(next.BUYER_LINES.length,2);
 assert.equal(operations.length,3);
 assert.equal(summarize(next).buyerLines.reduce((a,b)=>a+b.outstanding,0),30);
 assert.equal(db.BUYER_PO.length,0);
});
test('single Item popup creates new UOM conversion alongside Item',()=>{
 const db=setup();
 const {next}=prepareDocument(db,'ITEMS',{sku:'SKU2',name:'Packaging',baseUom:'PCS',minStock:5},[
  {id:'SKU2|CTN',uom:'CTN',factor:24,active:'Yes'}
 ],[]);
 assert.equal(next.UOM_MAP[0].sku,'SKU2');assert.equal(next.UOM_MAP[0].factor,24);
});
test('Supplier PO and received lines support combined entry',()=>{
 let db=setup();
 db=prepareDocument(db,'SUPPLIER_PO',{id:'SP1',supplier:'S1',control:'Active'},[
  {id:'SPL1',sku:'SKU1',qty:100,uom:'PCS'},
  {id:'SPL2',sku:'SKU1',qty:20,uom:'PCS'}
 ],[]).next;
 const p=prepareEntries(db,'RECEIPTS',[
  {id:'GR1',supplierLine:'SPL1',warehouse:'W1',qty:30,uom:'PCS',posting:'Posted',quality:'Accepted'},
  {id:'GR2',supplierLine:'SPL2',warehouse:'W1',qty:10,uom:'PCS',posting:'Posted',quality:'Accepted'}
 ]);
 assert.equal(summarize(p.next).stockRows[0].physical,40);
 assert.equal(p.operations.length,2);
});
test('grouped posted receipts cannot exceed Supplier PO pending',()=>{
 let db=setup();
 db=prepareDocument(db,'SUPPLIER_PO',{id:'SP1',supplier:'S1',control:'Active'},[
  {id:'SPL1',sku:'SKU1',qty:10,uom:'PCS'}
 ],[]).next;
 assert.throws(()=>prepareEntries(db,'RECEIPTS',[
  {id:'GR1',supplierLine:'SPL1',warehouse:'W1',qty:8,uom:'PCS',posting:'Posted',quality:'Accepted'},
  {id:'GR2',supplierLine:'SPL1',warehouse:'W1',qty:8,uom:'PCS',posting:'Posted',quality:'Accepted'}
 ]),/exceeds supplier line pending/);
});
test('one Container popup stages lines then dispatch, and outstanding updates once',()=>{
 let db=setup();
 db.ADJUSTMENTS=[{id:'OPEN',sku:'SKU1',warehouse:'W1',qty:100,uom:'PCS',posting:'Posted'}];
 db=prepareDocument(db,'BUYER_PO',{id:'PO1',buyer:'B1',control:'Active'},[
  {id:'L1',sku:'SKU1',qty:50,uom:'PCS',cancelled:0}
 ],[]).next;
 db.ALLOCATIONS=[{id:'A1',buyerLine:'L1',warehouse:'W1',qty:40,uom:'PCS',control:'Active'}];
 const p=prepareDocument(db,'CONTAINERS',{id:'C1',buyer:'B1',type:'20FT',status:'Dispatched'},[
  {id:'D1',allocation:'A1',qty:25,uom:'PCS'}
 ],[]);
 assert.equal(summarize(p.next).buyerLines[0].outstanding,25);
 assert.equal(summarize(p.next).stockRows[0].physical,75);
 assert.equal(p.next.CONTAINERS[0].status,'Dispatched');
});
test('removing a linked Buyer PO item is blocked',()=>{
 let db=setup();
 db=prepareDocument(db,'BUYER_PO',{id:'PO1',buyer:'B1',control:'Active'},[
  {id:'L1',sku:'SKU1',qty:20,uom:'PCS',cancelled:0}
 ],[]).next;
 db.ADJUSTMENTS=[{id:'OPEN',sku:'SKU1',warehouse:'W1',qty:100,uom:'PCS',posting:'Posted'}];
 db.ALLOCATIONS=[{id:'A1',buyerLine:'L1',warehouse:'W1',qty:10,uom:'PCS',control:'Active'}];
 assert.throws(()=>prepareDocument(db,'BUYER_PO',{...db.BUYER_PO[0]},[],['L1']),/linked records/);
});
test('bulk delete blocks linked Supplier masters and posted receipts',()=>{
 const db=setup();
 db.SUPPLIER_PO=[{id:'SP1',supplier:'S1',control:'Active'}];
 db.SUPPLIER_LINES=[{id:'SPL1',po:'SP1',sku:'SKU1',qty:10,uom:'PCS'}];
 db.RECEIPTS=[{id:'GR1',supplierLine:'SPL1',warehouse:'W1',qty:10,uom:'PCS',posting:'Posted',quality:'Accepted'}];
 assert.equal(prepareBulkDelete(db,'SUPPLIERS',['S1']).operations.length,0);
 assert.equal(prepareBulkDelete(db,'RECEIPTS',['GR1']).errors.length,1);
});
test('bulk edit master field changes selected entries without touching others',()=>{
 const db=setup();
 db.BUYERS.push({id:'B2',name:'Buyer Two'});
 const p=prepareBulkEdit(db,'BUYERS',['B1'],'name','Buyer Updated');
 assert.equal(p.next.BUYERS[0].name,'Buyer Updated');
 assert.equal(p.next.BUYERS[1].name,'Buyer Two');
});
test('existing linked UOM conversion cannot be bulk deleted',()=>{
 const db=setup();
 db.UOM_MAP=[{id:'SKU1|CTN',sku:'SKU1',uom:'CTN',factor:24,active:'Yes'}];
 db.BUYER_PO=[{id:'PO1',buyer:'B1',control:'Active'}];
 db.BUYER_LINES=[{id:'L1',po:'PO1',sku:'SKU1',qty:2,uom:'CTN',cancelled:0}];
 assert.match(deleteBlocker(db,'UOM_MAP','SKU1|CTN'),/in use/);
});
