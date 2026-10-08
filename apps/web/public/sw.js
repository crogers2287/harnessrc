/* Cache only the public offline notice. Conversation/API responses and credentials are never cached. */
self.addEventListener('install',event=>event.waitUntil(caches.open('relay-shell-v1').then(cache=>cache.add('/offline.html'))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));});
self.addEventListener('notificationclick',event=>{event.notification.close();const path=event.notification.data?.path??'/';event.waitUntil(self.clients.openWindow(new URL(path,self.location.origin).href));});
