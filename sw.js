const CACHE='sendmoney-v1';
const FILES=['/','/index.html','/client.html','/agent.html','/super-agent.html','/admin.html','/manifest.json','/logo3.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>{if(k!==CACHE) return caches.delete(k);}))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET') return; e.respondWith(caches.match(e.request).then(hit=>{const f=fetch(e.request).then(res=>{if(res.ok){const clone=res.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));}return res;}).catch(()=>hit); return hit||f; }));});
