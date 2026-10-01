const fs = require('fs');

// Stub Web Worker environment
global.self = {
    onmessage: null,
    postMessage: (msg) => console.log("WORKER OUT:", msg)
};

// Load the worker script
eval(fs.readFileSync('wasm_worker.js', 'utf8'));

// Fire a test message
const code = `module example;
  initial begin
    $display("Hello, SystemVerilog!");
    $finish;
  end
endmodule`;

self.onmessage({
    data: {
        id: 1,
        type: 'SIMULATE',
        files: [{ name: "example.sv", content: code, category: "design" }],
        command: "verilator",
        simulator: "verilator"
    }
});
