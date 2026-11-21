import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDb,summarize} from '../core.js';
import {buildRequirements,renderFlowHome,renderOrderDesk,renderOrderDetail,renderRequirements,renderInward,renderOutward,renderLoading,renderManagement} from '../workflow-ui.js';

function fixture(){
 const d=emptyDb();
 d.BUYERS=[{id:'B1',name:'Buyer Alpha'},{id:'B2',name:'Buyer Beta'}];
 d.SUPPLIERS=[{id:'S1',name:'Supplier One'}];
 d.WAREHOUSES=[{id:'W1',name:'Main Warehouse'}];
 d.ITEMS=[{sku:'A',name:'Item A',baseUom:'PCS',minStock:20,supplier:'S1'}];
 d.BUYER_PO=[{id:'PO1',buyer:'B1',number:'BUY-001',control:'Active'},{id:'PO2',buyer:'B2',number:'BUY-002',control:'Active'}];
 d.BUYER_LINES=[{id:'L1',po:'PO1',sku:'A',qty:80,uom:'PCS',cancelled:0},{id:'L2',po:'PO2',sku:'A',qty:90,uom:'PCS',cancelled:0}];
 d.SUPPLIER_PO=[{id:'SP1',supplier:'S1',control:'Active'}];
 d.SUPPLIER_LINES=[{id:'SL1',po:'SP1',sku:'A',qty:30,uom:'PCS'}];
 d.ADJUSTMENTS=[{id:'OPEN',sku:'A',warehouse:'W1',qty:100,uom:'PCS',posting:'Posted'}];
 d.ALLOCATIONS=[{id:'RES1',buyerLine:'L1',warehouse:'W1',qty:40,uom:'PCS',control:'Active'}];
 d.CONTAINERS=[{id:'SHIP1',buyer:'B1',status:'Dispatched',type:'20FT'}];
 d.DISPATCH=[{id:'D1',shipment:'SHIP1',allocation:'RES1',qty:20,uom:'PCS'}];
 return d;
}
test('Buyer-wise requirements distinguish pending, reserved and shared free stock',()=>{
 const d=fixture(),r=buildRequirements(d),b1=r.find(x=>x.buyer==='B1'),b2=r.find(x=>x.buyer==='B2');
 assert.equal(b1.outstanding,60);
 assert.equal(b1.reserved,20);
 assert.equal(b1.unreserved,40);
 assert.equal(b2.outstanding,90);
 assert.equal(b2.unreserved,90);
 assert.equal(b1.stock.available,60);
 assert.equal(b2.stock.available,60);
});
test('global purchase shortage is calculated once per SKU across Buyers',()=>{
 const d=fixture(),stock=summarize(d).stockRows[0];
 assert.equal(stock.demand,150);
 assert.equal(stock.physical,80);
 assert.equal(stock.incoming,30);
 assert.equal(stock.min,20);
 assert.equal(stock.shortage,60);
 const page=renderRequirements(d);
 assert.equal((page.match(/Create Purchase/g)||[]).length,1);
 assert.match(page,/Items to Purchase/);
 assert.match(page,/combined outstanding across all Buyers/i);
});
test('order desk and detail display Buyer orders and item outstanding',()=>{
 const d=fixture();
 assert.match(renderOrderDesk(d,{buyer:'B1'}),/Buyer Alpha/);
 assert.doesNotMatch(renderOrderDesk(d,{buyer:'B1'}),/BUY-002/);
 assert.match(renderOrderDetail(d,'PO1'),/BUY-001/);
 assert.match(renderOrderDetail(d,'PO1'),/60 PCS/);
});
test('stock inward and outward pages use manual non-deducting workflow labels',()=>{
 const d=fixture();
 assert.match(renderInward(d),/Record Stock In/);
 assert.match(renderOutward(d),/Planning does not reduce stock/);
 assert.match(renderLoading(d,'SHIP1'),/Loading Items/);
});
test('overview and advanced menu render without exposing raw tables in daily navigation',()=>{
 const d=fixture();
 assert.match(renderFlowHome(d),/What needs attention today/);
 assert.match(renderManagement(d,{admin:false,bulk:false}),/Master Data/);
 assert.doesNotMatch(renderManagement(d,{admin:false,bulk:false}),/Database Manager/);
});

test('on-hold Supplier orders are not counted as confirmed incoming stock',()=>{
 const d=fixture();
 d.SUPPLIER_PO[0].control='On Hold';
 const stock=summarize(d).stockRows[0];
 assert.equal(stock.incoming,0);
 assert.equal(stock.shortage,90);
});
