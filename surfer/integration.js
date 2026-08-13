// Web apps which integrate Surfer as an iframe can give commands to surfer via
// the .postMessage [1] function on the iframe.
//
//  For example, to tell Surfer to load waveforms from a URL, use
// `.postMessage({command: "LoadUrl", url: "https://app.surfer-project.org/picorv32.vcd"})`
//
//  For more complex functionality, one can also inject any `Message` defined
// in `surfer::Message` in surfer/main.rs. However, the API of these messages
// is not stable and may change at any time. If you add functionality via
// these, make sure to test the new functionality when changing Surfer version.
//
// [1] https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

// NOTE: The window.fetch monkey-patch is defined in index.html's synchronous <script>
// block so it runs BEFORE the WASM module initializes. This file runs after WASM init.

// ─── Helper: build a proper absolute URL for the WASM URL parser ──────────────
// (kept for LoadUrl command; not used for LoadVcdData which now uses LoadFromData)
function _vcdUrl() {
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  return base + 'vcd-data/current.vcd?t=' + Date.now();
}

// ─── Helper: load VCD by passing content directly to WASM (no URL/fetch) ───────
// LoadFromData bypasses libsurfer's path_and_query() stripping bug entirely.
// No ehttp call, no url::Url::parse, no Service Worker needed.
function _loadVcdViaSW(vcdText) {
  window._currentVcdText = vcdText;
  // LoadFromData passes VCD string directly in-memory
  inject_message(JSON.stringify({ LoadFromData: [vcdText, 'Clear'] }));
}


function register_message_listener() {
  window.addEventListener("message", (event) => {
    const decoded = event.data;
    if (!decoded || !decoded.command) return;

    switch (decoded.command) {
      // Load a waveform from a URL. The format is inferred from the data.
      // Example: `{command: "LoadUrl", url: "https://app.surfer-project.org/picorv32.vcd"}`
      case 'LoadUrl': {
        let targetUrl = decoded.url;
        try { targetUrl = new URL(decoded.url, window.location.origin).href; } catch (e) {}
        inject_message(JSON.stringify({ LoadWaveformFileFromUrl: [targetUrl, "Clear"] }));
        break;
      }

      case 'ToggleMenu':
        inject_message(JSON.stringify("ToggleMenu"));
        break;

      // WhatTheBug custom: store VCD text and tell Surfer to fetch via virtual URL.
      // The window.fetch monkey-patch (in index.html) intercepts the WASM fetch.
      // The SW also stores the data as a backup (with ACK to prevent race condition).
      case 'LoadVcdData': {
        const vcdText = decoded.data;
        if (!vcdText) break;
        _loadVcdViaSW(vcdText);
        break;
      }

      // Inject any other message supported by Surfer in the surfer::Message enum.
      // NOTE: The API of these is unstable.
      case 'InjectMessage':
        inject_message(decoded.message);
        break;

      default:
        console.log(`[integration.js] Unknown message.command ${decoded.command}`);
        break;
    }
  });
}

// Called by the Surfer WASM code to send a message to the host (e.g. VS Code extension).
// The host must have stored its postMessage handle in window.__surfer_host_api.
window.surfer_notify_host = function(message_json) {
  if (window.__surfer_host_api) {
    window.__surfer_host_api.postMessage(JSON.parse(message_json));
  }
};
