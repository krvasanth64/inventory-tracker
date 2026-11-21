import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDb} from '../core.js';
import {documentFormHTML,groupedFormHTML} from '../forms-ui.js';
import {prepareEntries} from '../operations.js';
function data(){
 const db=emptyDb();db.BUYERS=[{id:'B1',name:'Buyer 1'}];db.SUPPLIERS=[{id:'S1',name:'Supplier 1'}];db.WAREHOUSES=[{id:'W1',name:'Main Warehouse'}];db.ITEMS=[{sku:'SKU1',name:'Part 1',baseUom:'PCS'}];db.UOM_MAP=[{id:'SKU1|CTN',sku:'SKU1',uom:'CTN',factor:24,active:'Yes'}];return db;
}
test('Buyer order single popup contains header and multiple item rows',()=>{
 const db=data(),html=documentFormHTML(db,'BUYER_PO',{id:'PO1',buyer:'B1',control:'Active'},[
  {id:'L1',po:'PO1',sku:'SKU1',qty:12,uom:'PCS'},
  {id:'L2',po:'PO1',sku:'SKU1',qty:2,uom:'CTN'}
 ]);
 assert.match(html,/Document Details/);
 assert.match(html,/Buyer PO Lines/);
 assert.match(html,/data-editor-row="0"/);
 assert.match(html,/data-editor-row="1"/);
 assert.match(html,/Add Row/);
});
test('Item master popup accepts a new UOM and conversion',()=>{
 const db=data(),html=documentFormHTML(db,'ITEMS',{sku:'SKU2',name:'New Part',baseUom:'PCS'},[
  {id:'SKU2|BOX',sku:'SKU2',uom:'BOX',factor:12,active:'Yes'}
 ]);
 assert.match(html,/UOM Conversions/);
 assert.match(html,/BOX/);
 assert.match(html,/Base UOM/);
});
test('Grouped receipt popup places all inward rows in one form',()=>{
 const db=data(),html=groupedFormHTML(db,'RECEIPTS',[
  {id:'GR1',supplierLine:'SL1',warehouse:'W1',qty:12,uom:'PCS',posting:'Draft'},
  {id:'GR2',supplierLine:'SL2',warehouse:'W1',qty:4,uom:'PCS',posting:'Draft'}
 ]);
 assert.match(html,/Goods Receipts/);
 assert.match(html,/GR1/);
 assert.match(html,/GR2/);
});
test('eligible draft receipt can be removed from grouped editor',()=>{
 const db=data();db.RECEIPTS=[{id:'GR1',supplierLine:'SL1',warehouse:'W1',qty:10,uom:'PCS',posting:'Draft'}];
 const p=prepareEntries(db,'RECEIPTS',[],['GR1']);
 assert.equal(p.next.RECEIPTS.length,0);
 assert.equal(p.operations[0].kind,'delete');
});
