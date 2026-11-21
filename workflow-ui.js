/**
 * FlowStock V1.4 – one-screen operations, no change to underlying transaction tables.
 * Buyer requirements are line-based in SKU base UOM; never aggregate unlike UOMs.
 * Customer-facing planning numbers distinguish buyer demand, physically available stock,
 * inbound supplier balance and reservations already committed to other buyers.
 */
import {SCHEMAS,byId,summarize,N} from './core.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;',"'" :'&#39;'}[c]));
const n=(v,d=0)=>Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:d});
const date=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?h(v):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};
const button=(text,action,primary=false)=>'<button class="btn '+(primary?'btn-primary':'btn-ghost')+'" data-action="'+action+'">'+text+'</button>';
const panel=(title,note,content,action='')=>'<section class="panel"><div class="panel-header"><div><h3>'+title+'</h3><div class="panel-desc">'+note+'</div></div>'+action+'</div>'+content+'</section>';
const tag=x=>'<span class="tag '+(/received|complete|active|posted|arrived/i.test(x)?'good':/overdue|short|low stock|cancelled/i.test(x)?'bad':'warn')+'">'+h(x)+'</span>';
const uom=(db,sku)=>h(byId(db,'ITEMS',sku)?.baseUom||'');
const item=(db,sku)=>h(byId(db,'ITEMS',sku)?.name||sku);
const buyer=(db,id)=>h(byId(db,'BUYERS',id)?.name||id);
const supplier=(db,id)=>h(byId(db,'SUPPLIERS',id)?.name||id);
const table=(heads,rows,empty='No records to display')=>'<div class="table-wrap"><table class="data-table"><thead><tr>'+heads.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+heads.length+'" class="empty">'+empty+'</td></tr>')+'</tbody></table></div>';
const stat=(label,value,note)=>'<div class="kpi"><div class="kpi-top"><span>'+h(label)+'</span></div><div class="kpi-number">'+h(value)+'</div><div class="kpi-caption">'+h(note)+'</div></div>';
const intro=(title,sub,actions)=>'<div class="workflow-hero"><div class="eyebrow">DAILY OPERATIONS</div><h2>'+title+'</h2><p>'+sub+'</p><div class="flow-actions">'+actions+'</div></div>';
const td=(value,cls='')=>'<td'+(cls?' class="'+cls+'"':'')+'>'+value+'</td>';
function workflows(db){
 const s=summarize(db);
 const active=s.buyerLines.filter(x=>x.outstanding>0&&x.status!=='Cancelled');
 const buyerMap=new Map();for(const l of active){const x=buyerMap.get(l.buyer)||{buyer:l.buyer,orders:new Set(),lines:0,late:0,unreserved:0};x.orders.add(l.po);x.lines++;if(l.unreserved>0)x.unreserved++;if(l.due&&new Date(l.due)<new Date())x.late++;buyerMap.set(l.buyer,x)}
 return {s,active,byBuyer:[...buyerMap.values()].sort((a,b)=>b.late-a.late||b.lines-a.lines)};
}
export function buildRequirements(db){
 const {s,active}=workflows(db);
 const stockBySku=new Map(s.stockRows.map(x=>[x.sku,x]));
 const demandBySku=new Map();for(const l of active)demandBySku.set(l.sku,(demandBySku.get(l.sku)||0)+l.outstanding);
 return active.map(l=>{
  const stock=stockBySku.get(l.sku);
  const orderDemand=demandBySku.get(l.sku)||0;
  const physicallyAvailable=Math.max(0,stock?.available||0);
  // Available to plan is unreserved warehouse stock; reservations are already assigned.
  // This is a snapshot, NOT an allocation promise. Separate PO lines can show the
  // same free stock; the final allocation validates against the warehouse balance.
  const allocationNeed=Math.max(0,l.outstanding-l.reserved);
  const freeForThisLine=Math.min(allocationNeed,physicallyAvailable);
  const lineGap=Math.max(0,allocationNeed-freeForThisLine);
  return {...l,orderDemand,freeForThisLine,lineGap,stock:stock||null,
    sourcingGap:stock?.shortage||0,baseUom:byId(db,'ITEMS',l.sku)?.baseUom||''};
 });
}
function buyerSelector(db,selected){
 return '<label class="flow-filter"><span>Buyer</span><select id="workflow-buyer"><option value="">All Buyers</option>'+db.BUYERS.map(b=>'<option value="'+h(b.id)+'" '+(selected===b.id?'selected':'')+'>'+h(b.name||b.id)+'</option>').join('')+'</select></label>';
}
function filterBuyer(lines,selected,search=''){
 return lines.filter(x=>(!selected||x.buyer===selected)&&(!search||JSON.stringify(x).toLowerCase().includes(search.toLowerCase())));
}
function searchBar(value){return '<label class="flow-filter wide"><span>Find PO, item or SKU</span><input id="workflow-search" value="'+h(value)+'" placeholder="Search orders or items"></label>'}
function orderLines(db,s,poId){
 const lines=s.buyerLines.filter(x=>x.po===poId),closed=lines.filter(x=>x.outstanding<=0).length;
 return '<div class="order-line-sub"><strong>'+lines.length+' items</strong> · '+closed+' fully supplied · '+lines.filter(x=>x.outstanding>0).length+' outstanding</div>';
}
export function renderOrderDesk(db,state={}){
 const {s,active,byBuyer}=workflows(db),selected=state.buyer||'',q=(state.search||'').toLowerCase();
 const orders=db.BUYER_PO.filter(p=>(!selected||p.buyer===selected)&&(!q||[p.id,p.number,p.buyer,byId(db,'BUYERS',p.buyer)?.name,...s.buyerLines.filter(x=>x.po===p.id).map(x=>x.sku)].join(' ').toLowerCase().includes(q))).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 const rows=orders.slice(0,100).map(po=>{
  const lines=s.buyerLines.filter(l=>l.po===po.id),open=lines.filter(l=>l.outstanding>0),fully=lines.length>0&&open.length===0;
  const status=po.control==='Cancelled'?'Cancelled':fully?'Completed':lines.some(l=>l.shipped>0)?'Part supplied':po.control==='On Hold'?'On Hold':'Open';
  return '<tr>'+td('<strong>'+h(po.number||po.id)+'</strong><div class="footnote">'+h(po.id)+'</div>')+td(buyer(db,po.buyer))+td(date(po.date))+td(date(po.due))+td(orderLines(db,s,po.id))+td(open.length+' open lines')+td(tag(status))+td(button('View Items','flow-order:'+encodeURIComponent(po.id)))+'</tr>';
 });
 const cards='<div class="kpis workflow-kpis">'+stat('Active Buyer Orders',new Set(active.map(l=>l.po)).size,'Orders with outstanding items')+stat('Outstanding Items',active.length,'PO lines, mixed UOM')+stat('Partially Sent',active.filter(x=>x.shipped>0).length,'Order lines')+stat('Overdue Items',active.filter(x=>x.due&&new Date(x.due)<new Date()).length,'Past required date')+'</div>';
 const buyers=byBuyer.slice(0,8).map(x=>'<div class="buyer-snapshot"><div><strong>'+buyer(db,x.buyer)+'</strong><div class="footnote">'+x.orders.size+' orders · '+x.lines+' open item lines</div></div><div>'+tag(x.late?x.late+' overdue':x.unreserved+' need stock')+'</div></div>').join('');
 return intro('Buyer Orders','Create one Buyer PO, add its items and track every partial dispatch. Quantities stay in each item’s own UOM.',button('+ New Buyer Order','new:BUYER_PO',true)+button('Add PO Item','new:BUYER_LINES')+button('Outstanding','go:requirements'))+cards+
 '<div class="flow-filterbar">'+buyerSelector(db,selected)+searchBar(state.search||'')+'</div>'+
 panel('Buyer order register','Select View Items to see item-wise ordered, dispatched and pending balances',table(['Buyer PO','Buyer','PO Date','Required Date','Items','Open','Status','Actions'],rows,'No orders match the selected Buyer'),button('Buyer PO Lines','go:BUYER_LINES'))+
 panel('Buyer-wise follow-up','Buyers with open orders, highest overdue priority first','<div class="panel-body">'+(buyers||'<p class="muted">No outstanding Buyer orders.</p>')+'</div>');
}
export function renderOrderDetail(db,id){
 const {s}=workflows(db),po=byId(db,'BUYER_PO',id);if(!po)return '<div class="notice warning">Buyer order not found.</div>';
 const lines=s.buyerLines.filter(l=>l.po===id),rows=lines.map(l=>{
  const poUom=l.uom;const orderQty=Number(l.qty||0);
  return '<tr>'+td('<strong>'+h(l.sku)+'</strong><div class="footnote">'+item(db,l.sku)+'</div>')+td(h(poUom))+td(n(orderQty,2),'num')+td(n(l.shipped,2)+' '+uom(db,l.sku),'num')+td('<strong>'+n(l.outstanding,2)+' '+uom(db,l.sku)+'</strong>','num')+td(n(l.reserved,2)+' '+uom(db,l.sku),'num')+td(tag(l.status))+td(button('Edit Item','edit:BUYER_LINES:'+encodeURIComponent(l.id)))+'</tr>';
 });
 const caption='<div class="notice">Ordered quantity uses the PO UOM. Sent, pending and reserved quantities are shown in the SKU base UOM. This prevents confusing cartons with pieces or KG with PCS.</div>';
 return '<div class="flow-back">'+button('← Back to Buyer Orders','go:orders')+'</div>'+intro(h(po.number||po.id),buyer(db,po.buyer)+' · PO '+h(po.id)+' · required '+date(po.due),button('+ Add Another Item','new-po-line:'+encodeURIComponent(po.id),true)+button('Edit Order','edit:BUYER_PO:'+encodeURIComponent(po.id)))+caption+panel('Items & outstanding',lines.length+' items in this Buyer order',table(['Item','Order UOM','Ordered','Dispatched','Outstanding','Reserved','Status','Action'],rows,'No items added yet'));
}
export function renderRequirements(db,state={}){
 const lines=filterBuyer(buildRequirements(db),state.buyer||'',state.search||''),s=summarize(db),selected=state.buyer||'';
 const need=lines.filter(x=>x.outstanding>0&&x.status!=='Cancelled'),late=need.filter(x=>x.due&&new Date(x.due)<new Date()),unreserved=need.filter(x=>x.unreserved>0),supplierSkus=new Set(s.stockRows.filter(x=>x.shortage>0).map(x=>x.sku));
 const rows=need.slice(0,120).map(l=>{
  const x=l.stock||{};
  return '<tr>'+td('<strong>'+buyer(db,l.buyer)+'</strong><div class="footnote">'+h(l.po)+'</div>')+td('<strong>'+h(l.sku)+'</strong><div class="footnote">'+item(db,l.sku)+'</div>')+td(date(l.due))+td(n(l.outstanding,2)+' '+uom(db,l.sku),'num')+td(n(l.reserved,2)+' '+uom(db,l.sku),'num')+td(n(x.available||0,2)+' '+uom(db,l.sku),'num')+td('<strong>'+n(l.unreserved,2)+' '+uom(db,l.sku)+'</strong>','num')+td(tag(l.unreserved===0?'Reserved':l.due&&new Date(l.due)<new Date()?'Overdue':(x.available||0)<l.unreserved?'Needs Stock':'Plan Stock'))+td(button('Reserve','new-reservation:'+encodeURIComponent(l.id)))+'</tr>';
 });
 const guidance='<div class="notice">**Planning rule:** outstanding = ordered − cancelled − confirmed dispatch. Available = physical stock − open reservations. Free stock shown per row is shared across outstanding orders; do not add the available quantities across rows. Use Reserve Stock to commit inventory to a specific PO line.</div>';
 return intro('Requirements & Outstanding','Follow up each Buyer’s unsent items, reserve available stock and identify what needs purchasing.',button('Reserve Stock','new:ALLOCATIONS',true)+button('Purchase from Supplier','go:SUPPLIER_PO')+button('Stock Availability','go:stock'))+
 '<div class="kpis workflow-kpis">'+stat('Open PO Items',need.length,'Buyer PO item lines')+stat('Not Fully Reserved',unreserved.length,'Require allocation')+stat('Overdue Items',late.length,'Past required date')+stat('SKUs Need Sourcing',supplierSkus.size,'Shortage after available supply')+'</div>'+
 '<div class="flow-filterbar">'+buyerSelector(db,selected)+searchBar(state.search||'')+'</div>'+guidance+
 panel('Buyer-wise pending requirements','Outstanding and stock values shown in each SKU base UOM',table(['Buyer / PO','Item','Required','Outstanding','Reserved','Free Stock','To Allocate','Priority','Action'],rows,'No outstanding items for this Buyer'))+
 panel('Next action','Use an explicit allocation before planning outward dispatch. Procurement shortage is calculated across all Buyers per SKU, never per row.','<div class="panel-body"><div class="flow-step-list"><div><b>1</b> Review pending Buyer items</div><div><b>2</b> Reserve available stock</div><div><b>3</b> Purchase any remaining shortfall</div><div><b>4</b> Receive goods and dispatch manually</div></div></div>');
}
export function renderInward(db,state={}){
 const s=summarize(db),pending=s.supplierLines.filter(l=>l.pending>0),posted=db.RECEIPTS.filter(r=>r.posting==='Posted'&&r.quality==='Accepted'),recent=[...db.RECEIPTS].reverse().slice(0,30);
 const rows=pending.slice(0,80).map(l=>'<tr>'+td('<strong>'+h(l.po)+'</strong>')+td(supplier(db,byId(db,'SUPPLIER_PO',l.po)?.supplier))+td(h(l.sku)+'<div class="footnote">'+item(db,l.sku)+'</div>')+td(n(l.ordered,2)+' '+uom(db,l.sku),'num')+td(n(l.received,2)+' '+uom(db,l.sku),'num')+td('<strong>'+n(l.pending,2)+' '+uom(db,l.sku)+'</strong>','num')+td(button('Record Inward','new-receipt:'+encodeURIComponent(l.id)))+'</tr>');
 const latest=recent.map(r=>{const line=byId(db,'SUPPLIER_LINES',r.supplierLine);return '<tr>'+td(h(r.id))+td(date(r.date))+td(h(line?.sku||''))+td(n(r.qty,2)+' '+h(r.uom),'num')+td(h(r.warehouse))+td(tag(r.posting||'Draft'))+'</tr>'});
 return intro('Stock In','Record received goods against Supplier POs. Draft receipts do not increase physical stock; accepted and posted receipts do.',button('+ Record Stock In','new:RECEIPTS',true)+button('Supplier Orders','go:SUPPLIER_PO')+button('Stock Adjustments','go:ADJUSTMENTS'))+
 '<div class="kpis workflow-kpis">'+stat('Supplier PO Lines Pending',pending.length,'Remaining to receive')+stat('Posted Inwards',posted.length,'Accepted receipts')+stat('Draft Receipts',db.RECEIPTS.filter(x=>x.posting!=='Posted').length,'Awaiting posting')+stat('Active Suppliers',db.SUPPLIERS.filter(x=>x.active!=='No').length,'Supplier masters')+'</div>'+
 panel('Pending Supplier Purchases','Receive against the relevant supplier order line',table(['Supplier PO','Supplier','Item','Ordered','Received','Pending','Action'],rows,'All active supplier orders have been received'))+
 panel('Recent Stock In','Draft / posted history',table(['Receipt','Date','Item','Quantity','Warehouse','Status'],latest));
}
export function renderOutward(db,state={}){
 const {s}=workflows(db),open=s.buyerLines.filter(l=>l.outstanding>0&&l.status!=='Cancelled'),planned=db.CONTAINERS.filter(x=>['Planning','Loaded'].includes(x.status)),sent=db.CONTAINERS.filter(x=>['Dispatched','Arrived'].includes(x.status));
 const rows=[...db.CONTAINERS].reverse().slice(0,70).map(x=>{
  const load=db.DISPATCH.filter(l=>l.shipment===x.id),sentCount=load.reduce((total,l)=>total+(s.deliveries.find(x=>x.id===l.id)?.posted?1:0),0);
  return '<tr>'+td('<strong>'+h(x.id)+'</strong><div class="footnote">'+h(x.number||'No container no.')+'</div>')+td(buyer(db,x.buyer))+td(h(x.type||'—'))+td(load.length+' item lines')+td(date(x.etd))+td(tag(x.status||'Planning'))+td(button('View Loading','view-loading:'+encodeURIComponent(x.id)))+'</tr>';
 });
 const allocationRows=db.ALLOCATIONS.filter(x=>x.control!=='Released').slice(0,30).map(a=>{
  const l=s.buyerLines.find(x=>x.id===a.buyerLine),reserved=l?s.deliveries.filter(x=>x.allocation===a.id&&x.posted).reduce((n,x)=>n+x.base,0):0;
  const factor= l? Number(a.qty||0)*((l.sku&&db.UOM_MAP.find(x=>x.sku===l.sku&&x.uom===a.uom)?.factor)||1):0;
  return '<tr>'+td(h(a.id))+td(l?buyer(db,l.buyer):'—')+td(h(l?.po||''))+td(h(l?.sku||''))+td(n(factor,2)+' '+uom(db,l?.sku),'num')+td(n(Math.max(0,factor-reserved),2)+' '+uom(db,l?.sku),'num')+td(button('Load Item','new:DISPATCH'))+'</tr>';
 });
 return intro('Stock Out & Dispatch','Reserve by Buyer PO, enter manual container loading, then confirm dispatch. Planning does not reduce stock.',button('+ Plan Container','new:CONTAINERS',true)+button('Add Loading Item','new:DISPATCH')+button('Reserve Stock','new:ALLOCATIONS'))+
 '<div class="kpis workflow-kpis">'+stat('Containers to Send',planned.length,'Planning or loaded')+stat('Sent Containers',sent.length,'Confirmed dispatch / arrived')+stat('Open Reservations',db.ALLOCATIONS.filter(a=>a.control!=='Released').length,'Including partly shipped')+stat('Buyer Items Pending',open.length,'Still outstanding')+'</div>'+
 '<div class="flow-step-list big"><div><b>1</b> Reserve the Buyer item</div><div><b>2</b> Create container</div><div><b>3</b> Add loading lines</div><div><b>4</b> Change status to Dispatched</div></div>'+
 panel('Container Register','20FT / 40FT / 40HC: manual loading quantities only',table(['Shipment / Container','Buyer','Type','Loaded Lines','ETD','Status','Action'],rows,'No containers recorded'))+
 panel('Stock Reserved for Buyers','Open Buyer line reservations. Enter loading against the specific allocation.',table(['Reservation','Buyer','Buyer PO','SKU','Allocated','Still Reserved','Action'],allocationRows,'No active stock reservations'));
}
export function renderLoading(db,id){
 const shipment=byId(db,'CONTAINERS',id);if(!shipment)return '<div class="notice warning">Container not found.</div>';
 const s=summarize(db),rows=db.DISPATCH.filter(d=>d.shipment===id).map(d=>{
  const x=s.deliveries.find(y=>y.id===d.id);return '<tr>'+td(h(d.id))+td(h(d.allocation))+td(x?buyer(db,x.buyer):'—')+td(h(x?.sku||''))+td(n(d.qty,2)+' '+h(d.uom),'num')+td(x?.posted?tag('Dispatched'):tag('Not yet dispatched'))+td(button('Edit Loading','edit:DISPATCH:'+encodeURIComponent(d.id)))+'</tr>';
 });
 const edit= ['Planning','Loaded'].includes(shipment.status);
 return '<div class="flow-back">'+button('← Back to Stock Out','go:outward')+'</div>'+
 intro(h(shipment.id)+' · '+h(shipment.number||''),buyer(db,shipment.buyer)+' · '+h(shipment.type||'Manual container')+' · '+h(shipment.status||'Planning'),(edit?button('+ Add Loading Item','new-container-line:'+encodeURIComponent(id),true)+button('Confirm Dispatch','edit:CONTAINERS:'+encodeURIComponent(id)):'')+button('Container Details','edit:CONTAINERS:'+encodeURIComponent(id)))+
 '<div class="notice">Goods are deducted from stock and Buyer outstanding only after container status is Dispatched. Do not use Loaded as a shipping confirmation.</div>'+
 panel('Loading Items',rows.length+' item lines',table(['Dispatch Line','Allocation','Buyer','SKU','Loaded Qty','Status','Action'],rows));
}
export function renderManagement(db){
 return intro('Master Data & Settings','Administrative lists and advanced registers stay here so daily users see fewer menus.',button('Items','go:ITEMS',true)+button('Buyers','go:BUYERS')+button('Suppliers','go:SUPPLIERS'))+
 '<div class="manage-grid">'+
 [['Masters',[['Items','ITEMS'],['Buyers','BUYERS'],['Suppliers','SUPPLIERS'],['Warehouses','WAREHOUSES'],['UOM Conversions','UOM_MAP']]],
 ['Order Details',[['Buyer PO Lines','BUYER_LINES'],['Supplier PO Lines','SUPPLIER_LINES'],['Supplier Purchases','SUPPLIER_PO']]],
 ['Inventory Records',[['Receipts','RECEIPTS'],['Adjustments','ADJUSTMENTS'],['Reservations','ALLOCATIONS'],['Loading Lines','DISPATCH'],['Containers','CONTAINERS']]],
 ['Administration',[['Bulk Upload','bulk'],['Data Checks','checks'],['Database Manager','databases'],['Users & Roles','users'],['Database Connection','settings'],['My Account','account']]]].map(([heading,links])=>'<section class="settings-card"><h3>'+heading+'</h3><div class="manage-links">'+links.map(([label,page])=>'<button class="quick-link" data-action="go:'+page+'">'+label+' <span>↗</span></button>').join('')+'</div></section>').join('')+'</div>';
}
export const FLOW_LABELS={dashboard:'Overview',orders:'Buyer Orders',requirements:'Requirements & Pending',inward:'Stock In',outward:'Stock Out',stock:'Stock Balance',manage:'More Tools'};
