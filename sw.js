self.addEventListener('install',e=>{e.waitUntil(caches.open('sm-v1').then(c=>c.addAll(['/','/index.html','/client.html','/logo3.png'])))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
