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

function register_message_listener() {
  window.addEventListener("message", (event) => {
    // JSON decode the message
    const decoded = event.data

    switch (decoded.command) {
      // Load a waveform from a URL. The format is inferred from the data.
      // Example: `{command: "LoadUrl", url: "https://app.surfer-project.org/picorv32.vcd"}`

      case 'LoadUrl': {
        const msg = {
          LoadWaveformFileFromUrl: [
            decoded.url,
            "Clear"
          ]
        }
        inject_message(JSON.stringify(msg))
        break;
      }

      case 'ToggleMenu': {
        const msg = "ToggleMenu"
        inject_message(JSON.stringify(msg))
        break;
      }

      // WhatTheBug custom: Send VCD data to this iframe's Service Worker,
      // then trigger Surfer to load from the virtual SW-served URL.
      case 'LoadVcdData': {
        const vcdText = decoded.data;
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SET_VCD', payload: vcdText });
          // Small delay to ensure SW has stored the data before Surfer fetches
          setTimeout(() => {
            const vcdUrl = '/vcd-data/current.vcd?t=' + Date.now();
            const msg = {
              LoadWaveformFileFromUrl: [
                vcdUrl,
                "Clear"
              ]
            }
            inject_message(JSON.stringify(msg));
          }, 50);
        } else {
          console.warn('[integration.js] No SW controller available for LoadVcdData');
        }
        break;
      }

      // Inject any other message supported by Surfer in the surfer::Message enum.
      // NOTE: The API of these is unstable.
      case 'InjectMessage': {
        inject_message(decoded.message);
        break
      }

      default:
        console.log(`Unknown message.command ${decoded.command}`)
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
