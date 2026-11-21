// Do not cache /api/ responses or authenticated pages. LAN data must be fresh.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.pathname.startsWith('/api/'))return;
 // All application files are served network-first with no offline data replica.
});
