// Service Worker for Surfer WASM viewer
// Handles: VCD data serving via in-memory store + receipt acknowledgement

let vcdData = null;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for VCD data from the page (iframe context)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_VCD') {
    vcdData = event.data.payload;
    // Acknowledge to the iframe that VCD data is now stored
    if (event.source) {
      try { event.source.postMessage({ type: 'VCD_SET_ACK' }); } catch (e) {}
    }
  }
});

self.addEventListener("fetch", function (event) {
  if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
    return;
  }

  const url = new URL(event.request.url);

  // Serve in-memory VCD data for any URL containing "vcd-data"
  if (url.pathname.includes('vcd-data')) {
    event.respondWith(
      vcdData
        ? new Response(vcdData, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain;charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache, no-store'
            }
          })
        : new Response('No VCD data available', { status: 404 })
    );
    return;
  }

  // Pass all other requests through normally
  // (no COEP/COOP injection — that breaks cross-origin subrequests)
  // Simply fall through, letting the browser handle normally
});
