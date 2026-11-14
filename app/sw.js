/* Service worker van de Budgetplanner.
   Doel: de app opent ook zonder internet.
   - De app zelf (index.html, iconen…): eerst online de nieuwste versie halen, lukt dat niet → de bewaarde kopie.
     Zo krijgt iedereen updates meteen, en werkt het offline toch.
   - Lettertypes van Google: één keer ophalen en daarna uit de bewaarde kopie.
   Je gegevens zitten NIET hierin: die staan in IndexedDB en worden nooit door dit script verstuurd. */
const CACHE = "budgetplanner-app-v1";
const FONTS = "budgetplanner-fonts-v1";
const CORE = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon-32.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Online proberen (max. 4 s), anders de bewaarde kopie.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("traag")), 4000))]);
    if (res && res.ok) cache.put(req.mode === "navigate" ? "./" : req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req.mode === "navigate" ? "./" : req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

// Eerst de bewaarde kopie, anders online ophalen en bewaren.
async function cacheFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") { e.respondWith(cacheFirst(req)); return; }
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
});
