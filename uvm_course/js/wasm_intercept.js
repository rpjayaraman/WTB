(function() {
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
        let url = typeof resource === 'string' ? resource : (resource ? resource.url : '');
        if (url && url.includes("/api/simulate")) {
            if (typeof Worker !== 'undefined') {
                if (!window.wasmWorker) {
                    window.wasmWorker = new Worker('/wasm_worker.js?v=' + Date.now());
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
                    
                    let filesArr = payload.files;
                    if (filesArr && !Array.isArray(filesArr) && typeof filesArr === 'object') {
                        filesArr = Object.keys(filesArr).map(k => ({ name: k, content: filesArr[k], category: 'design' }));
                    }
                    
                    window.wasmWorker.postMessage({
                        id,
                        type: 'SIMULATE',
                        files: filesArr,
                        command: simCmd,
                        simulator: engine === 'verilator' ? 'verilator' : 'xezim_wasm'
                    });
                    
                    const res = await wasmPromise;
                    if (!res.engine) res.engine = engine;
                    if (res.compile_time_ms === undefined) res.compile_time_ms = 35;
                    if (res.sim_time_ms === undefined) res.sim_time_ms = 85;
                    if (res.total_time_ms === undefined) res.total_time_ms = res.compile_time_ms + res.sim_time_ms;
                    return new Response(JSON.stringify(res), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (err) {
                    console.error("WASM Intercept Error:", err);
                    return new Response(JSON.stringify({
                        exit_code: 1,
                        stdout: '',
                        stderr: "WASM Worker Exception: " + err.message
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
        }
        return originalFetch.apply(this, arguments);
    };
})();