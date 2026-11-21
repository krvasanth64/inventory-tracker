import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDb,summarize,validate,baseQty,diagnostics} from '../core.js';

function fixture(){
 const d=emptyDb();
 d.BUYERS=[{id:'B',name:'Test Buyer'}];
 d.SUPPLIERS=[{id:'S',name:'Test Supplier'}];
 d.WAREHOUSES=[{id:'W',name:'Primary warehouse'}];
 d.ITEMS=[{sku:'A',name:'Item A',baseUom:'PCS',minStock:10}];
 d.UOM_MAP=[{id:'A|CTN',sku:'A',uom:'CTN',factor:20,active:'Yes'}];
 d.BUYER_PO=[{id:'BP',buyer:'B',control:'Active'}];
 d.BUYER_LINES=[{id:'BL',po:'BP',sku:'A',qty:5,uom:'CTN',cancelled:0}];
 d.SUPPLIER_PO=[{id:'SP',supplier:'S',control:'Active'}];
 d.SUPPLIER_LINES=[{id:'SL',po:'SP',sku:'A',qty:10,uom:'CTN'}];
 d.RECEIPTS=[{id:'GR1',supplierLine:'SL',warehouse:'W',qty:4,uom:'CTN',quality:'Accepted',posting:'Posted'},{id:'GR2',supplierLine:'SL',warehouse:'W',qty:2,uom:'CTN',quality:'Hold',posting:'Draft'}];
 d.ADJUSTMENTS=[{id:'OP',sku:'A',warehouse:'W',qty:20,uom:'PCS',posting:'Posted'}];
 d.ALLOCATIONS=[{id:'AL',buyerLine:'BL',warehouse:'W',qty:3,uom:'CTN',control:'Active'}];
 d.CONTAINERS=[{id:'CN',buyer:'B',status:'Planning'}];
 d.DISPATCH=[{id:'DP',shipment:'CN',allocation:'AL',qty:2,uom:'CTN'}];
 return d;
}
test('SKU-specific UOM conversion uses correct base units',()=>{const d=fixture();assert.equal(baseQty(d,'A','CTN',3),60);assert.equal(baseQty(d,'A','PCS',5),5);assert.equal(baseQty(d,'A','ROLL',1),null)});
test('planned container reserves stock but does not post dispatch',()=>{
 const s=summarize(fixture());
 assert.equal(s.buyerLines[0].ordered,100);assert.equal(s.buyerLines[0].outstanding,100);
 assert.equal(s.buyerLines[0].reserved,60);assert.equal(s.stockRows[0].physical,100);assert.equal(s.stockRows[0].available,40);
 assert.equal(s.supplierLines[0].received,80);assert.equal(s.supplierLines[0].pending,120);
});
test('dispatch confirmation reduces stock and PO pending exactly once',()=>{
 const d=fixture();validate(d,'CONTAINERS',{...d.CONTAINERS[0],status:'Dispatched'},true);d.CONTAINERS[0].status='Dispatched';
 const s=summarize(d);assert.equal(s.buyerLines[0].shipped,40);assert.equal(s.buyerLines[0].outstanding,60);
 assert.equal(s.buyerLines[0].reserved,20);assert.equal(s.stockRows[0].physical,60);assert.equal(s.stockRows[0].available,40);assert.equal(diagnostics(d).filter(x=>!x.ok).length,0);
});
test('buyer order cancellation requires release of open reservation',()=>{
 const d=fixture();assert.throws(()=>validate(d,'BUYER_PO',{...d.BUYER_PO[0],control:'Cancelled'},true),/Release open reservations/);
 d.ALLOCATIONS[0].control='Released';validate(d,'BUYER_PO',{...d.BUYER_PO[0],control:'Cancelled'},true);d.BUYER_PO[0].control='Cancelled';
 assert.equal(summarize(d).buyerLines[0].outstanding,0);
});
test('cannot post stock adjustment leaving negative available stock',()=>{
 const d=fixture();assert.throws(()=>validate(d,'ADJUSTMENTS',{id:'BAD',sku:'A',warehouse:'W',qty:-50,uom:'PCS',posting:'Posted'},false),/available stock below zero/);
});
test('cannot load more than reserved or ship to another buyer',()=>{
 const d=fixture();assert.throws(()=>validate(d,'DISPATCH',{id:'BAD',shipment:'CN',allocation:'AL',qty:2,uom:'CTN'},false),/exceeds allocation/);
 d.CONTAINERS[0].buyer='WRONG';assert.throws(()=>validate(d,'DISPATCH',{id:'BAD2',shipment:'CN',allocation:'AL',qty:1,uom:'PCS'},false),/does not match/);
});
test('Arrived can follow Dispatched, but dispatch cannot be rolled back',()=>{
 const d=fixture();d.CONTAINERS[0].status='Dispatched';
 validate(d,'CONTAINERS',{...d.CONTAINERS[0],status:'Arrived'},true);
 assert.throws(()=>validate(d,'CONTAINERS',{...d.CONTAINERS[0],status:'Planning'},true),/rolled back/);
});
test('posted receipts are immutable',()=>{
 const d=fixture();assert.throws(()=>validate(d,'RECEIPTS',{...d.RECEIPTS[0],qty:5},true),/immutable/);
});
