/* Pump Nation service worker — basic offline shell + bypass API calls */

const VERSION = "v10";  // bump when you change cached files to force a refresh
const SHELL_CACHE = `pump-shell-${VERSION}`;

// Files we always want available offline (the "app shell").
// Static assets are cached on install; HTML is fetched fresh when online.
const SHELL_FILES = [
    "/",
    "/workouts/",
    "/workouts/progress.html",
    "/cardio/",
    "/login.html",
    "/logo.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/icons/favicon-32.png",
    "/manifest.webmanifest"
];

// ─── Install: pre-cache the shell ─────────────────────────────────────────
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
    );
});

// ─── Activate: nuke old versions ──────────────────────────────────────────
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ─── Fetch strategy ───────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1. Never cache anything that isn't a GET (POSTs to Apps Script must go live)
    if (req.method !== "GET") return;

    // 2. Bypass for Apps Script / identity / external APIs — always go to network
    const NETWORK_ONLY_HOSTS = [
        "script.google.com",
        "script.googleusercontent.com",
        "identity.netlify.com"
    ];
    if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
        return; // let the browser handle it directly
    }

    // 3. HTML navigation: network-first so users get fresh content when online,
    //    fall back to cached shell when offline.
    if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res.status === 200) {
                        const copy = res.clone();
                        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req).then((r) => r || caches.match("/workouts/")))
        );
        return;
    }

    // 4. Same-origin static assets: cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((res) => {
                    if (res.status === 200) {
                        const copy = res.clone();
                        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
                    }
                    return res;
                }).catch(() => cached);
            })
        );
    }
    // 5. Anything else (CDN scripts, fonts, etc.) — let the browser handle it.
});
