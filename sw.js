/* RainScore service worker — offline shell only.
   Rule #1: API requests (Open-Meteo) must pass through untouched — bare return,
   never respondWith(JSON). We only cache the app shell. */
const CACHE = "rainscore-lab-20260627-22";
const SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);
  // Never intercept the weather APIs — let the network handle them (and retry logic in app).
  if(url.origin !== self.location.origin) return;          // rule #1: bare return
  if(e.request.method !== "GET") return;
  // App shell: cache-first, fall back to network, update cache on success.
  e.respondWith(
    caches.match(e.request).then(hit=>{
      if(hit) return hit;
      return fetch(e.request).then(res=>{
        if(res && res.status===200 && res.type==="basic"){
          const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy));
        }
        return res;
      }).catch(()=>caches.match("./index.html"));
    })
  );
});
