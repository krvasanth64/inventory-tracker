// Browser-local accounts and permissions. NOT a trusted production authentication boundary.
// For real multi-user Google Sheets access, enforce these rules on a server-side API.
const IDB='flowstock-admin-v1';
const ROLES={
  VIEWER:{label:'View Only',permissions:['read']},
  ENTRY:{label:'Data Entry',permissions:['read','transaction.write','transaction.bulk']},
  POSTER:{label:'Stock Posting / Dispatch',permissions:['read','transaction.post']},
  MANAGER:{label:'Master Manager',permissions:['read','master.write','master.bulk']},
  ADMIN:{label:'Administrator',permissions:['*']}
};
export const ROLE_DEFINITIONS=ROLES;
export const MASTER_TABLES=new Set(['BUYERS','SUPPLIERS','WAREHOUSES','ITEMS','UOM_MAP']);
const DB=(name='state')=>new Promise((resolve,reject)=>{const r=indexedDB.open(IDB,1);r.onupgradeneeded=()=>r.result.createObjectStore(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function read(k){const db=await DB();return new Promise((res,rej)=>{const t=db.transaction('state','readonly'),r=t.objectStore('state').get(k);r.onsuccess=()=>{res(r.result);db.close()};r.onerror=()=>{db.close();rej(r.error)}})}
async function write(k,v){const db=await DB();return new Promise((res,rej)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(v,k);t.oncomplete=()=>{db.close();res()};t.onerror=()=>{db.close();rej(t.error)}})}
function bytesToHex(b){return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function hexToBytes(s){return new Uint8Array(s.match(/.{2}/g).map(x=>parseInt(x,16)))}
async function hash(password,salt){const raw=new TextEncoder().encode(password);const key=await crypto.subtle.importKey('raw',raw,'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:hexToBytes(salt),iterations:180000,hash:'SHA-256'},key,256);return bytesToHex(bits)}
const makeSalt=()=>bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const safeName=s=>String(s||'').trim();
let actor=null;
const sessionKey='flowstock-user-session-v1';
const cleanUser=u=>({username:u.username,displayName:u.displayName,roles:[...u.roles],active:u.active!==false,createdAt:u.createdAt,updatedAt:u.updatedAt,mustChangePassword:!!u.mustChangePassword});
export async function initializeAccounts(){
 let users=await read('users');
 if(!users||!users.length){const salt=makeSalt(),now=new Date().toISOString();users=[{username:'admin',displayName:'System Administrator',roles:['ADMIN'],active:true,salt,hash:await hash('admin',salt),mustChangePassword:true,createdAt:now,updatedAt:now}];await write('users',users)}
 const username=sessionStorage.getItem(sessionKey);
 actor=(users.find(x=>x.username===username&&x.active)||null);
 return actor?cleanUser(actor):null;
}
export const currentUser=()=>actor?cleanUser(actor):null;
export function may(permission,table){if(!actor||!actor.active||actor.mustChangePassword)return false;if(actor.roles.includes('ADMIN'))return true;if(permission==='read')return actor.roles.some(x=>ROLES[x]?.permissions.includes('read'));const master=MASTER_TABLES.has(table),kind=master?'master':'transaction';return actor.roles.some(role=>ROLES[role]?.permissions.includes(kind+'.'+permission))}
export function isAdmin(){return !!actor&&actor.roles.includes('ADMIN')}
export async function authenticate(username,password){const users=await read('users')||[];const u=users.find(x=>x.username===safeName(username).toLowerCase());if(!u||!u.active||await hash(password,u.salt)!==u.hash)throw Error('Invalid credentials or account disabled');actor=u;sessionStorage.setItem(sessionKey,u.username);return cleanUser(u)}
export function logout(){actor=null;sessionStorage.removeItem(sessionKey)}
export async function changeOwnPassword(current,next){if(!actor)throw Error('Sign in first');if(next.length<10)throw Error('New password must contain at least 10 characters');if(next==='admin')throw Error('Choose a password other than the initial default');const users=await read('users'),u=users.find(x=>x.username===actor.username);if(await hash(current,u.salt)!==u.hash)throw Error('Current password is incorrect');u.salt=makeSalt();u.hash=await hash(next,u.salt);u.mustChangePassword=false;u.updatedAt=new Date().toISOString();await write('users',users);actor=u;return cleanUser(u)}
export async function listUsers(){if(!isAdmin())throw Error('Admin access required');return (await read('users')||[]).map(cleanUser)}
function checkedRoles(roles){const values=[...new Set(roles.filter(x=>ROLES[x]))];if(!values.length)throw Error('Select at least one role');return values.includes('ADMIN')?['ADMIN']:values}
export async function upsertUser({username,displayName,roles,active,password}){
 if(!isAdmin())throw Error('Admin access required');
 username=safeName(username).toLowerCase();if(!/^[a-z0-9._-]{3,50}$/.test(username))throw Error('Username must be 3–50 letters, digits, periods, hyphens or underscores');
 const users=await read('users')||[],existing=users.find(x=>x.username===username);
 if(existing?.username==='admin'&&!roles.includes('ADMIN'))throw Error('Cannot remove default administrator privileges');
 if(existing?.username===actor.username&&active===false)throw Error('You cannot disable your own account');
 if(existing?.username===actor.username&&!roles.includes('ADMIN'))throw Error('You cannot revoke your own admin access');
 if(!existing&&(!password||password.length<10))throw Error('New user password must have at least 10 characters');
 if(password&&password.length<10)throw Error('Password must contain at least 10 characters');
 const now=new Date().toISOString(),roleSet=checkedRoles(roles),u=existing||{username,createdAt:now};
 u.displayName=safeName(displayName)||username;u.active=active!==false;u.roles=roleSet;u.updatedAt=now;
 if(password){u.salt=makeSalt();u.hash=await hash(password,u.salt);u.mustChangePassword=true}
 if(!existing)users.push(u);await write('users',users);
 if(actor.username===username)actor=u;
 return cleanUser(u)
}
export async function removeUser(username){if(!isAdmin())throw Error('Admin required');if(username==='admin'||username===actor.username)throw Error('Cannot remove this administrator');const users=await read('users')||[];const result=users.filter(x=>x.username!==username);if(result.length===users.length)throw Error('User not found');await write('users',result)}
export function roleLabels(roles){return (roles||[]).map(x=>ROLES[x]?.label||x).join(', ')}
export async function getPreferences(){return await read('preferences')||{}}
export async function setPreferences(pref){await write('preferences',pref)}
