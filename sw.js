// Service Worker for Shared List Grocery App
const CACHE_NAME = 'shared-list-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './supabase-client.js',
    './manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Service Worker: Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Network-first for Supabase API calls
    if (url.hostname.includes('supabase')) {
        event.respondWith(
            fetch(request)
                .catch(() => caches.match(request))
        );
        return;
    }

    // Network-first for CDN resources (Supabase JS)
    if (url.hostname.includes('cdn.jsdelivr.net')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, clone);
                    });
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Cache-first for static assets
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cached version but also update cache in background
                fetch(request).then((response) => {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, response);
                    });
                }).catch(() => {});
                return cachedResponse;
            }

            return fetch(request).then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, clone);
                });
                return response;
            });
        })
    );
});
