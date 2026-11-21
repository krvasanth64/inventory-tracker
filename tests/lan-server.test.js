import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port}
function userCookie(response){return response.headers.get('set-cookie')?.split(';')[0]||''}
async function request(base,route,{method='GET',cookie='',data,origin=base}={}){
 const r=await fetch(base+route,{method,headers:{...(cookie?{cookie}:{}),...(data!==undefined?{'content-type':'application/json'}:{}),...(method!=='GET'?{origin}: {})},body:data===undefined?undefined:JSON.stringify(data)});
 const json=await r.json();return {status:r.status,data:json,cookie:userCookie(r)};
}
async function hostServer(dir,port){
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,FLOWSTOCK_DATA_DIR:dir,FLOWSTOCK_PORT:String(port),FLOWSTOCK_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',d=>logs+=d.toString());child.stdout.on('data',d=>logs+=d.toString());
 const base='http://127.0.0.1:'+port;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('LAN host exited: '+logs);try{const r=await fetch(base+'/api/mode');if(r.ok)return {child,base}}catch{}await delay(50)}
 child.kill();throw Error('LAN server never started: '+logs);
}
test('LAN server authenticates users, enforces one writer and hides paths from viewers', {timeout:25000}, async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'flowstock-lan-'));
 const port=await freePort();
 let app;
 try{
  app=await hostServer(dir,port);const base=app.base;
  let r=await request(base,'/api/mode');assert.equal(r.data.mode,'lan');
  r=await request(base,'/api/database');assert.equal(r.status,401);
  r=await request(base,'/api/login',{method:'POST',data:{username:'admin',password:'admin'}});
  assert.equal(r.status,200);const admin=r.cookie;assert.equal(r.data.user.mustChangePassword,true);
  r=await request(base,'/api/database',{cookie:admin});assert.equal(r.status,403);
  r=await request(base,'/api/password',{method:'POST',cookie:admin,data:{current:'admin',next:'Changed-Secure-Password-123'}});
  assert.equal(r.status,200);assert.equal(r.data.user.mustChangePassword,false);
  r=await request(base,'/api/database',{cookie:admin});assert.equal(r.status,200);let version=r.data.revision;
  assert.ok(!JSON.stringify(r.data).includes(dir));
  r=await request(base,'/api/admin/database',{cookie:admin});assert.equal(r.status,200);
  assert.equal(r.data.location,path.join(dir,'database.json'));
  r=await request(base,'/api/users',{cookie:admin,method:'POST',data:{username:'viewer',displayName:'Viewer',password:'Viewer-Password-123',roles:['VIEWER'],active:true}});assert.equal(r.status,200);
  r=await request(base,'/api/users',{cookie:admin,method:'POST',data:{username:'entry',displayName:'Data Entry',password:'DataEntry-Password-123',roles:['ENTRY'],active:true}});assert.equal(r.status,200);
  const viewLogin=await request(base,'/api/login',{method:'POST',data:{username:'viewer',password:'Viewer-Password-123'}});assert.equal(viewLogin.status,200);
  const viewer=viewLogin.cookie;
  r=await request(base,'/api/password',{method:'POST',cookie:viewer,data:{current:'Viewer-Password-123',next:'New-Viewer-Password-123'}});assert.equal(r.status,200);
  r=await request(base,'/api/database',{cookie:viewer});assert.equal(r.status,200);
  r=await request(base,'/api/admin/database',{cookie:viewer});assert.equal(r.status,403);
  r=await request(base,'/api/lease',{method:'POST',cookie:viewer,data:{action:'acquire'}});assert.equal(r.status,403);
  const entryLogin=await request(base,'/api/login',{method:'POST',data:{username:'entry',password:'DataEntry-Password-123'}});const entry=entryLogin.cookie;
  await request(base,'/api/password',{method:'POST',cookie:entry,data:{current:'DataEntry-Password-123',next:'New-DataEntry-Password-123'}});
  r=await request(base,'/api/commit',{method:'POST',cookie:entry,data:{expectedRevision:version,operations:[{kind:'create',table:'BUYERS',record:{id:'B1',name:'Blocked'}}]}});assert.equal(r.status,423);
  r=await request(base,'/api/lease',{method:'POST',cookie:admin,data:{action:'acquire'}});assert.equal(r.status,200);assert.equal(r.data.mine,true);
  r=await request(base,'/api/lease',{method:'POST',cookie:entry,data:{action:'acquire'}});assert.equal(r.status,423);
  r=await request(base,'/api/commit',{method:'POST',cookie:admin,data:{expectedRevision:version,label:'Test master',operations:[{kind:'create',table:'BUYERS',record:{id:'B1',name:'Buyer One'}}]}});
  assert.equal(r.status,200);version=r.data.revision;assert.equal(r.data.db.BUYERS.length,1);
  r=await request(base,'/api/lease',{method:'POST',cookie:admin,data:{action:'release'}});assert.equal(r.status,200);
  r=await request(base,'/api/lease',{method:'POST',cookie:entry,data:{action:'acquire'}});assert.equal(r.status,200);assert.equal(r.data.mine,true);
  r=await request(base,'/api/commit',{method:'POST',cookie:entry,data:{expectedRevision:version,operations:[{kind:'create',table:'BUYERS',record:{id:'B2',name:'Illegal'}}]}});assert.equal(r.status,403);
  r=await request(base,'/api/commit',{method:'POST',cookie:entry,data:{expectedRevision:version,operations:[{kind:'create',table:'BUYER_PO',record:{id:'PO1',buyer:'B1',control:'Active'}}]}});
  assert.equal(r.status,200);assert.equal(r.data.db.BUYER_PO.length,1);
  r=await request(base,'/api/commit',{method:'POST',cookie:entry,data:{expectedRevision:version,operations:[{kind:'create',table:'BUYER_PO',record:{id:'PO2',buyer:'B1',control:'Active'}}]}});
  assert.equal(r.status,409);
  r=await request(base,'/api/lease',{method:'POST',cookie:entry,data:{action:'release'}});assert.equal(r.status,200);
  const persisted=JSON.parse(await readFile(path.join(dir,'database.json'),'utf8'));assert.equal(persisted.BUYER_PO.length,1);
 }finally{
  if(app){app.child.kill('SIGTERM');await new Promise(resolve=>{if(app.child.exitCode!==null)resolve();else{app.child.once('exit',resolve);setTimeout(resolve,1000)}})}
  await rm(dir,{recursive:true,force:true});
 }
});
