// WASM Interceptor for Training Modules
// Transparently intercepts /api/simulate fetch requests and routes them to the local WASM worker.
(function() {
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
        if (typeof resource === 'string' && resource.includes("/api/simulate")) {
            if (typeof Worker !== 'undefined') {
                if (!window.wasmWorker) {
                    window.wasmWorker = new Worker('../wasm_worker.js?v=' + Date.now());
                    window.wasmReqs = new Map();
                    window.wasmReqId = 0;
                    window.wasmWorker.onmessage = (e) => {
                        const { id, success, result, error } = e.data;
                        if (window.wasmReqs.has(id)) {
                            const { resolve, reject } = window.wasmReqs.get(id);
                            window.wasmReqs.delete(id);
                            if (success) resolve(result);
                            else reject(new Error(error));
                        }
                    };
                }
                
                try {
                    const payload = JSON.parse(init.body);
                    let engine = payload.engine || 'verilator';
                    let plusargsStr = (payload.plusargs || []).join(' ');
                    
                    let simCmd = engine === 'verilator' 
                       ? `verilator --binary -j 0 --timescale 1ns/1ns -Wall -Wno-fatal --timing -sv $FILE ${plusargsStr}` 
                       : `xezim --simulate --xtrace wave.vcd -DUVM_NO_DPI -I/Users/mac/xezim-workspace/uvm-1.2/src /Users/mac/xezim-workspace/uvm-1.2/src/uvm_pkg.sv $FILE ${plusargsStr}`;
                       
                    const id = ++window.wasmReqId;
                    const wasmPromise = new Promise((resolve, reject) => {
                        window.wasmReqs.set(id, { resolve, reject });
                    });
                    
                    window.wasmWorker.postMessage({
                        id,
                        type: 'SIMULATE',
                        files: payload.files,
                        command: simCmd,
                        simulator: engine === 'verilator' ? 'verilator' : 'xezim_wasm'
                    });
                    
                    const res = await wasmPromise;
                    return new Response(JSON.stringify(res), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (err) {
                    console.error("[WASM Interceptor] Error executing WASM:", err);
                    // Fallback to original fetch if something crashes
                }
            }
        }
        return originalFetch.apply(this, arguments);
    };
    console.log("[WASM Interceptor] Loaded and monitoring /api/simulate");
})();