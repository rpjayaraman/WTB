// vcd-sw.js — Service Worker that serves in-memory VCD data to Surfer WASM
// No backend server needed — all data served from browser memory.

let vcdData = null;

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_VCD') {
        vcdData = event.data.payload;
        // Acknowledge receipt
        if (event.source) {
            event.source.postMessage({ type: 'VCD_SET', ok: true });
        }
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Intercept requests for the virtual VCD endpoint
    if (url.pathname === '/vcd-data/current.vcd') {
        event.respondWith(
            vcdData
                ? new Response(vcdData, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/plain',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-cache'
                    }
                })
                : new Response('No VCD data available', { status: 404 })
        );
        return;
    }
    
    // Let all other requests pass through normally
});

// Activate immediately
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});
