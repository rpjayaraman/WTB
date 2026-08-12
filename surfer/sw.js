// Service Worker for Surfer WASM viewer
// Handles: COEP/COOP headers for SharedArrayBuffer support + VCD data serving

let vcdData = null;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for VCD data from the parent page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_VCD') {
    vcdData = event.data.payload;
  }
});

self.addEventListener("fetch", function (event) {
  if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
    return;
  }

  const url = new URL(event.request.url);

  // Serve in-memory VCD data for the virtual endpoint
  if (url.pathname === '/vcd-data/current.vcd') {
    event.respondWith(
      vcdData
        ? new Response(vcdData, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache, no-store'
            }
          })
        : new Response('No VCD data available', { status: 404 })
    );
    return;
  }

  // For all other requests, proxy to network with COEP/COOP headers
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

        const moddedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });

        return moddedResponse;
      })
      .catch(function (e) {
        console.error(e);
      })
  );
});
