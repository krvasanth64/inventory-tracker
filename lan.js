// LAN client: all writes are authorized and serialized by server.mjs.
// The session cookie is HttpOnly and the server checks an exclusive edit lease.
let active=false,lease={active:false,mine:false,holder:''},revision=0,meta=null,heartbeat=null;
export const isLan=()=>active;
export const lanLease=()=>({...lease});
export const lanRevision=()=>revision;
export const lanMetadata=()=>meta;
async function api(path,{method='GET',data}={}){
 const response=await fetch('/api/'+path,{method,credentials:'same-origin',cache:'no-store',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok){const e=new Error(result.error||'LAN request failed');e.status=response.status;throw e}
 return result;
}
export async function detectLan(){
 try{const response=await fetch('/api/mode',{cache:'no-store'});if(!response.ok)return false;const data=await response.json();active=data.mode==='lan';return active}catch{return false}
}
export async function lanSession(){const result=await api('session');lease=result.lease;return result.user}
export async function lanLogin(username,password){
 const result=await api('login',{method:'POST',data:{username,password}});
 lease=result.lease;return result.user;
}
export async function lanLogout(){stopHeartbeat();await api('logout',{method:'POST',data:{}});lease={active:false,mine:false,holder:''};meta=null;revision=0}
export async function lanPassword(current,next){return (await api('password',{method:'POST',data:{current,next}})).user}
export async function lanUsers(){return (await api('users')).users}
export async function lanSaveUser(input){return (await api('users',{method:'POST',data:input})).user}
export async function lanRemoveUser(username){return api('users',{method:'DELETE',data:{username}})}
export async function lanLoad(){const result=await api('database');revision=result.revision;meta=result.metadata;return result.db}
export async function lanCommit(operations,label='Update'){
 const result=await api('commit',{method:'POST',data:{operations,expectedRevision:revision,label}});
 revision=result.revision;if(meta)meta.updatedAt=result.updatedAt;return result.db;
}
export async function lanReplace(db,label='Database update'){
 const result=await api('replace',{method:'POST',data:{db,expectedRevision:revision,label}});
 revision=result.revision;if(meta)meta.updatedAt=result.updatedAt;return result.db;
}
export async function lanPoll(){if(!active)return {changed:false};const status=await api('status');lease=status.lease;if(meta){meta.updatedAt=status.updatedAt;meta.name=status.name}return {changed:status.revision!==revision,revision:status.revision,lease:{...lease}}}
export async function refreshLease(){if(!active)return lease;const l=await api('lease');lease=l;return {...l}}
export async function leaseAction(action){const l=await api('lease',{method:'POST',data:{action}});lease=l;if(l.mine)startHeartbeat();else stopHeartbeat();return {...l}}
export function startHeartbeat(){
 if(heartbeat)return;
 heartbeat=setInterval(async()=>{if(!lease.mine)return;try{await leaseAction('heartbeat')}catch{lease={active:false,mine:false,holder:''};stopHeartbeat();window.dispatchEvent(new CustomEvent('flowstock-lease-changed'))}},25000);
}
export function stopHeartbeat(){if(heartbeat){clearInterval(heartbeat);heartbeat=null}}
export async function lanDetails(){return api('admin/database')}
export async function lanRename(name){return api('admin/database',{method:'POST',data:{name}})}
