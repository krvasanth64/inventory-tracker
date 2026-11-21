// FlowStock LAN host. Single server process is the only writer to these files.
// Start: node server.mjs (Node 22+). FLOWSTOCK_DATA_DIR can be a local or UNC folder.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {emptyDb,TABLES,SCHEMAS,byId,validate,diagnostics} from './core.js';
import {deleteBlocker} from './operations.js';
const scrypt=promisify(scryptCb);
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(process.env.FLOWSTOCK_DATA_DIR||path.join(root,'lan-data'));
const dbPath=path.join(dataDir,'database.json'),usersPath=path.join(dataDir,'users.json'),metaPath=path.join(dataDir,'metadata.json');
const port=Number(process.env.FLOWSTOCK_PORT||5173),host=process.env.FLOWSTOCK_HOST||'0.0.0.0';
const allowed=new Set(['index.html','styles.css','app.js','core.js','storage.js','admin.js','admin-ui.js','bulk.js','operations.js','forms-ui.js','workflow-ui.js','lan.js','manifest.webmanifest','flowstock-icon.svg','service-worker.js','favicon.ico']);
const roleNames=new Set(['VIEWER','ENTRY','MANAGER','POSTER','ADMIN']);
const masterTables=new Set(['BUYERS','SUPPLIERS','WAREHOUSES','ITEMS','UOM_MAP']);
const sessions=new Map(),loginAttempts=new Map();let lease=null,state,users,meta;let queue=Promise.resolve();
const now=()=>new Date().toISOString(),clone=o=>structuredClone(o),uid=()=>randomBytes(24).toString('hex');
const count=db=>TABLES.reduce((a,t)=>a+db[t].length,0);
const error=(status,message)=>Object.assign(new Error(message),{status});
const locked=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p};
function publicUser(u){return {username:u.username,displayName:u.displayName,roles:u.roles,active:u.active,mustChangePassword:u.mustChangePassword,createdAt:u.createdAt,updatedAt:u.updatedAt}}
async function hashed(pass,salt){const key=await scrypt(pass,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1});return key.toString('hex')}
async function setPassword(u,password,bootstrap=false){if(typeof password!=='string'||password.length<10&&!(bootstrap&&password==='admin'))throw error(400,'Password must be at least 10 characters');u.salt=randomBytes(16).toString('hex');u.hash=await hashed(password,u.salt);u.mustChangePassword=true;u.updatedAt=now()}
async function passwordMatches(u,password){const hash=Buffer.from(await hashed(password,u.salt),'hex'),actual=Buffer.from(u.hash,'hex');return hash.length===actual.length&&timingSafeEqual(hash,actual)}
async function atomic(file,value){const temp=file+'.'+process.pid+'.'+uid().slice(0,8)+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value,null,2),'utf8');await fs.rename(temp,file)}finally{await fs.rm(temp,{force:true}).catch(()=>{})}}
async function startup(){
 await fs.mkdir(dataDir,{recursive:true});
 async function restore(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;await atomic(file,fallback);return fallback}}
 state=await restore(dbPath,emptyDb());
 if(TABLES.some(t=>!Array.isArray(state[t])))throw Error('Invalid database schema at '+dbPath);
 users=await restore(usersPath,[]);
 if(!users.length){const admin={username:'admin',displayName:'System Administrator',roles:['ADMIN'],active:true,createdAt:now()};await setPassword(admin,'admin',true);users=[admin];await atomic(usersPath,users)}
 meta=await restore(metaPath,{name:'FlowStock Shared Database',createdAt:now(),updatedAt:now(),revision:0});
}
function clearStale(){const t=Date.now();for(const [id,s] of sessions){if(s.exp<t){sessions.delete(id);if(lease?.session===id)lease=null}}if(lease?.exp<t)lease=null}
function cookie(req,name){const text=req.headers.cookie||'';return text.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}
function session(req){clearStale();const id=cookie(req,'flowstock_sid'),s=sessions.get(id),u=users.find(u=>u.username===s?.username&&u.active);if(!u||!s)return null;s.exp=Date.now()+12*3600*1000;return {id,user:u}}
function requireUser(req){const s=session(req);if(!s)throw error(401,'Sign in required');return s}
function requireAdmin(s){if(!s.user.roles.includes('ADMIN'))throw error(403,'Administrator access required')}
function canWrite(u,table,kind='write'){if(u.roles.includes('ADMIN'))return true;const m=masterTables.has(table);return u.roles.includes(m?'MANAGER':'ENTRY')&&kind!=='post'}
function canPost(u){return u.roles.includes('ADMIN')||u.roles.includes('POSTER')}
function requireLease(s){clearStale();if(!lease||lease.session!==s.id)throw error(423,lease?'Editing locked by '+lease.username:'Take Edit Access before saving')}
function allowedWrite(u,table,record,existing){
 if(!canWrite(u,table))throw error(403,'Role cannot edit '+table);
 const posting=table==='RECEIPTS'||table==='ADJUSTMENTS';
 const container=table==='CONTAINERS';
 if(posting&&record?.posting==='Posted'&&existing?.posting!=='Posted'&&!canPost(u))throw error(403,'Stock Posting role required');
 if(container&&['Dispatched','Arrived'].includes(record?.status)&&record?.status!==existing?.status&&!canPost(u))throw error(403,'Stock Posting role required');
}
function diffRows(a,b,table){const s=SCHEMAS[table];return s.fields.some(f=>JSON.stringify(a?.[f.key]??'')!==JSON.stringify(b?.[f.key]??''))}
function remainingErrors(db,baseline){const bad=diagnostics(db).filter(x=>!x.ok&&!baseline.has(x.title));if(bad.length)throw error(422,'Data validation: '+bad.slice(0,4).map(x=>x.title).join('; '))}
function applyOperations(initial,operations,u){
 if(!Array.isArray(operations)||!operations.length||operations.length>1500)throw error(400,'Invalid change list');
 const next=clone(initial),baseline=new Set(diagnostics(initial).filter(x=>!x.ok).map(x=>x.title));
 for(const op of operations){
  const table=op?.table;if(!SCHEMAS[table])throw error(400,'Unknown table');
  const pk=SCHEMAS[table].pk,id=String(op.kind==='delete'?op.id:op.record?.[pk]??'');
  if(!id)throw error(400,'Document identifier required');
  const old=byId(next,table,id);
  if(op.kind==='delete'){
   if(!old)throw error(409,table+' '+id+' not found');
   if(!canWrite(u,table))throw error(403,'Role cannot delete '+table);
   const why=deleteBlocker(next,table,id);if(why)throw error(422,table+' '+id+': '+why);
   next[table]=next[table].filter(r=>String(r[pk])!==id);continue;
  }
  if(!['create','update'].includes(op.kind))throw error(400,'Invalid change action');
  if(op.kind==='create'&&old||op.kind==='update'&&!old)throw error(409,'Stale record '+table+'/'+id);
  const record={...(old||{}),...op.record};
  allowedWrite(u,table,record,old);
  try{validate(next,table,record,!!old)}catch(e){throw error(422,table+' '+id+': '+e.message)}
  if(old)next[table]=next[table].map(r=>String(r[pk])===id?record:r);else next[table].push(record);
 }
 remainingErrors(next,baseline);
 return next;
}
const order=[...TABLES];
function replacePlan(current,desired){
 if(!desired||typeof desired!=='object')throw error(400,'Invalid database payload');
 const ops=[],pending=[];
 for(const t of [...order].reverse()){
  if(!Array.isArray(desired[t]))throw error(400,'Missing table '+t);
  const pk=SCHEMAS[t].pk, ids=new Set();
  for(const x of desired[t]){const id=String(x[pk]??'');if(!id||ids.has(id))throw error(400,'Duplicate or empty '+t+' ID');ids.add(id)}
  for(const x of current[t])if(!ids.has(String(x[pk])))ops.push({kind:'delete',table:t,id:x[pk]});
 }
 for(const t of order){
  const pk=SCHEMAS[t].pk;
  for(const r of desired[t]){
   const old=byId(current,t,r[pk]);if(old&&!diffRows(old,r,t))continue;
   if(t==='CONTAINERS'&&['Dispatched','Arrived'].includes(r.status)&&old?.status!=='Dispatched'&&old?.status!=='Arrived'){
    pending.push({...r});
    ops.push({kind:old?'update':'create',table:t,record:{...r,status:'Loaded'}});
   }else ops.push({kind:old?'update':'create',table:t,record:r});
  }
 }
 for(const r of pending){
  ops.push({kind:'update',table:'CONTAINERS',record:{...r,status:'Dispatched'}});
  if(r.status==='Arrived')ops.push({kind:'update',table:'CONTAINERS',record:r});
 }
 return ops;
}
async function persist(next,u,actions,label){
 const prev=state,stamp=now();const backup=path.join(dataDir,'database.previous.json');
 try{await fs.copyFile(dbPath,backup)}catch(e){if(e.code!=='ENOENT')throw e}
 await atomic(dbPath,next);
 meta={...meta,updatedAt:stamp,revision:meta.revision+1};
 await atomic(metaPath,meta);
 state=next;
 await fs.appendFile(path.join(dataDir,'audit.log'),JSON.stringify({timestamp:stamp,username:u.username,actions,label,revision:meta.revision})+'\n').catch(e=>console.error('Audit append failed:',e.message));
 return {db:state,revision:meta.revision,updatedAt:meta.updatedAt}
}
function connectedUrl(req){const scheme=req.socket.encrypted?'https':'http';return scheme+'://'+req.headers.host}
function reply(res,status,data,extra={}){const payload=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...extra});res.end(payload)}
function originOK(req){if(['GET','HEAD','OPTIONS'].includes(req.method))return;const origin=req.headers.origin;if(origin&&origin!==connectedUrl(req))throw error(403,'Cross-origin write blocked');const content=req.headers['content-type']||'';if(!content.startsWith('application/json'))throw error(415,'JSON content type required')}
async function body(req){let size=0,buffers=[];for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024)throw error(413,'Request body too large');buffers.push(chunk)}try{return JSON.parse(Buffer.concat(buffers).toString('utf8'))}catch{throw error(400,'Invalid JSON')}}
function leasePublic(s){clearStale();return {active:!!lease,holder:lease?.username||'',mine:!!s&&lease?.session===s.id,expiresAt:lease?new Date(lease.exp).toISOString():null}}
function endpoints(){return Object.values(os.networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal).map(a=>(tls?'https://':'http://')+a.address+':'+port)}
async function handleApi(req,res,url){
 if(url.pathname==='/api/mode'&&req.method==='GET')return reply(res,200,{mode:'lan',version:'1.6.0'});
 if(url.pathname==='/api/login'&&req.method==='POST'){
  const {username,password}=await body(req),ip=String(req.socket.remoteAddress||'unknown');
  const tries=loginAttempts.get(ip)||{count:0,until:0};if(tries.until>Date.now())throw error(429,'Too many login attempts; retry later');
  const u=users.find(x=>x.username===String(username||'').toLowerCase()&&x.active);
  if(!u||typeof password!=='string'||!(await passwordMatches(u,password))){tries.count++;tries.until=tries.count>=8?Date.now()+60000:0;loginAttempts.set(ip,tries);throw error(401,'Incorrect username or password')}
  loginAttempts.delete(ip);
  const id=uid();sessions.set(id,{username:u.username,exp:Date.now()+12*3600*1000});
  return reply(res,200,{user:publicUser(u),lease:leasePublic({id})},{'Set-Cookie':'flowstock_sid='+id+'; HttpOnly; SameSite=Strict; Path=/'+(req.socket.encrypted?'; Secure':'')});
 }
 if(url.pathname==='/api/session'&&req.method==='GET'){const s=session(req);return reply(res,200,{user:s?publicUser(s.user):null,lease:leasePublic(s)})}
 const s=requireUser(req);
 if(url.pathname==='/api/logout'&&req.method==='POST'){
  sessions.delete(s.id);if(lease?.session===s.id)lease=null;
  return reply(res,200,{ok:true},{'Set-Cookie':'flowstock_sid=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/'});
 }
 if(url.pathname==='/api/password'&&req.method==='POST')return locked(async()=>{
  const {current,next}=await body(req);if(!await passwordMatches(s.user,String(current||'')))throw error(401,'Current password incorrect');
  if(next==='admin')throw error(400,'Choose a different password');
  await setPassword(s.user,next);s.user.mustChangePassword=false;await atomic(usersPath,users);return reply(res,200,{user:publicUser(s.user)});
 });
 if(s.user.mustChangePassword)throw error(403,'Change initial password before accessing data');
 if(url.pathname==='/api/lease'&&req.method==='GET')return reply(res,200,leasePublic(s));
 if(url.pathname==='/api/lease'&&req.method==='POST')return locked(async()=>{
  const {action}=await body(req);clearStale();
  if(action==='acquire'){
   if(!s.user.roles.some(x=>['ENTRY','MANAGER','ADMIN'].includes(x)))throw error(403,'Editing role required');
   if(lease&&lease.session!==s.id)throw error(423,'Currently edited by '+lease.username);
   lease={session:s.id,username:s.user.username,exp:Date.now()+90000};
  }else if(action==='heartbeat'){
   requireLease(s);lease.exp=Date.now()+90000;
  }else if(action==='release'){if(lease?.session===s.id)lease=null;
  }else if(action==='force-release'){requireAdmin(s);lease=null;
  }else throw error(400,'Unknown lease action');
  return reply(res,200,leasePublic(s));
 });
 if(url.pathname==='/api/database'&&req.method==='GET')return reply(res,200,{db:state,revision:meta.revision,metadata:{name:meta.name,createdAt:meta.createdAt,updatedAt:meta.updatedAt,count:count(state)}});
 if(url.pathname==='/api/commit'&&req.method==='POST'||url.pathname==='/api/replace'&&req.method==='POST')return locked(async()=>{
  requireLease(s);const request=await body(req);
  if(request.expectedRevision!==meta.revision)throw error(409,'Database changed; refresh before saving');
  const ops=url.pathname==='/api/commit'?request.operations:replacePlan(state,request.db);
  if(!ops.length)return reply(res,200,{db:state,revision:meta.revision,updatedAt:meta.updatedAt});
  const next=applyOperations(state,ops,s.user);
  return reply(res,200,await persist(next,s.user,ops.length,String(request.label||'').slice(0,120)));
 });
 if(url.pathname==='/api/users'&&req.method==='GET'){requireAdmin(s);return reply(res,200,{users:users.map(publicUser)})}
 if(url.pathname==='/api/users'&&req.method==='POST')return locked(async()=>{
  requireAdmin(s);const q=await body(req),username=String(q.username||'').toLowerCase().trim(),roles=[...new Set(q.roles||[])];
  if(!/^[a-z0-9._-]{3,50}$/.test(username)||!roles.length||roles.some(x=>!roleNames.has(x)))throw error(400,'Invalid username or roles');
  let user=users.find(x=>x.username===username);
  if(!user&&!q.password)throw error(400,'New user needs a password');
  if(username==='admin'&&!roles.includes('ADMIN'))throw error(400,'Default administrator cannot lose Admin role');
  if(username===s.user.username&&!roles.includes('ADMIN')&&s.user.roles.includes('ADMIN'))throw error(400,'Cannot revoke your own Admin role');
  if(username===s.user.username&&q.active===false)throw error(400,'Cannot disable your account');
  if(!user){user={username,createdAt:now()};users.push(user)}
  user.displayName=String(q.displayName||username).slice(0,100);user.roles=roles.includes('ADMIN')?['ADMIN']:roles;user.active=q.active!==false;user.updatedAt=now();
  if(q.password)await setPassword(user,q.password);
  await atomic(usersPath,users);return reply(res,200,{user:publicUser(user)});
 });
 if(url.pathname==='/api/users'&&req.method==='DELETE')return locked(async()=>{
  requireAdmin(s);const q=await body(req),username=String(q.username||'');
  if(username==='admin'||username===s.user.username)throw error(400,'Cannot remove administrator/current account');
  users=users.filter(x=>x.username!==username);for(const [id,v] of sessions)if(v.username===username){sessions.delete(id);if(lease?.session===id)lease=null}
  await atomic(usersPath,users);return reply(res,200,{ok:true});
 });
 if(url.pathname==='/api/admin/database'&&req.method==='GET'){
  requireAdmin(s);return reply(res,200,{name:meta.name,location:dbPath,folder:dataDir,usersFile:usersPath,auditFile:path.join(dataDir,'audit.log'),revision:meta.revision,createdAt:meta.createdAt,updatedAt:meta.updatedAt,records:count(state),connectedUsers:[...new Set([...sessions.values()].map(v=>v.username))],editor:leasePublic(s),urls:endpoints()});
 }
 if(url.pathname==='/api/admin/database'&&req.method==='POST')return locked(async()=>{
  requireAdmin(s);const q=await body(req),name=String(q.name||'').trim();
  if(name.length<3||name.length>100)throw error(400,'Database name must be 3–100 characters');
  meta.name=name;await atomic(metaPath,meta);return reply(res,200,{ok:true,name});
 });
 throw error(404,'API endpoint not found');
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
async function handle(req,res){
 try{
  originOK(req);
  const url=new URL(req.url,connectedUrl(req));
  if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url);
  if(!['GET','HEAD'].includes(req.method))throw error(405,'Method not allowed');
  let name=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
  if(name.endsWith('/'))name='index.html';
  if(!allowed.has(name))throw error(404,'Static file not found');
  const file=path.join(root,name),data=await fs.readFile(file);
  res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch(e){const status=e.status||500;if(status===500)console.error(e);reply(res,status,{error:e.message||'Server error'})}
}
await startup();
const tls=process.env.FLOWSTOCK_TLS_CERT&&process.env.FLOWSTOCK_TLS_KEY;
const server=tls?https.createServer({cert:await fs.readFile(process.env.FLOWSTOCK_TLS_CERT),key:await fs.readFile(process.env.FLOWSTOCK_TLS_KEY)},handle):http.createServer(handle);
server.listen(port,host,()=>console.log('FlowStock LAN server listening on '+(tls?'https':'http')+'://'+host+':'+port+'\nDatabase file: '+dbPath+'\nLAN URLs: '+endpoints().join(', ')));
