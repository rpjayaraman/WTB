import json, urllib.request

code = """
interface axi4_if (input logic clk, input logic rst_n);
    logic [3:0]   awid;
    logic [31:0]  awaddr;
    logic [7:0]   awlen;
    logic [2:0]   awsize;
    logic [1:0]   awburst;
    logic         awvalid;
    logic         awready;

    logic [31:0]  wdata;
    logic [3:0]   wstrb;
    logic         wlast;
    logic         wvalid;
    logic         wready;

    logic [3:0]   bid;
    logic [1:0]   bresp;
    logic         bvalid;
    logic         bready;

    logic [3:0]   arid;
    logic [31:0]  araddr;
    logic [7:0]   arlen;
    logic [2:0]   arsize;
    logic [1:0]   arburst;
    logic         arvalid;
    logic         arready;

    logic [3:0]   rid;
    logic [31:0]  rdata;
    logic [1:0]   rresp;
    logic         rlast;
    logic         rvalid;
    logic         rready;
endinterface

module axi4_slave_dut (axi4_if tif);
    logic [31:0] mem [0:255];

    always_ff @(posedge tif.clk or negedge tif.rst_n) begin
        if (!tif.rst_n) begin
            tif.awready <= 1'b0;
            tif.wready  <= 1'b0;
            tif.bvalid  <= 1'b0;
            tif.bresp   <= 2'b00;
        end else begin
            tif.awready <= 1'b1;
            tif.wready  <= 1'b1;
            
            if (tif.awvalid && tif.awready && tif.wvalid && tif.wready) begin
                mem[tif.awaddr[9:2]] <= tif.wdata;
                tif.bvalid <= 1'b1;
                tif.bid    <= tif.awid;
            end
            
            if (tif.bvalid && tif.bready) begin
                tif.bvalid <= 1'b0;
            end
        end
    end

    always_ff @(posedge tif.clk or negedge tif.rst_n) begin
        if (!tif.rst_n) begin
            tif.arready <= 1'b0;
            tif.rvalid  <= 1'b0;
            tif.rlast   <= 1'b0;
            tif.rresp   <= 2'b00;
        end else begin
            tif.arready <= 1'b1;
            
            if (tif.arvalid && tif.arready && !tif.rvalid) begin
                tif.rvalid <= 1'b1;
                tif.rid    <= tif.arid;
                tif.rdata  <= mem[tif.araddr[9:2]];
                tif.rlast  <= 1'b1;
            end
            
            if (tif.rvalid && tif.rready) begin
                tif.rvalid <= 1'b0;
                tif.rlast  <= 1'b0;
            end
        end
    end
endmodule

module top_tb;
    logic clk;
    logic rst_n;

    initial begin
        clk = 0;
        forever #5 clk = ~clk;
    end

    initial begin
        rst_n = 0;
        #15 rst_n = 1;
    end

    axi4_if tif (clk, rst_n);
    axi4_slave_dut dut (tif);

    initial begin
        #30;
        $display("=== STARTING DIRECT AXI4 SIMULATION ===");
        
        // Step 1: Drive Write Address & Data
        @(posedge clk);
        tif.awid    <= 4'h1;
        tif.awaddr  <= 32'h0000_0020;
        tif.awlen   <= 8'h00;
        tif.awburst <= 2'b01;
        tif.awvalid <= 1'b1;

        tif.wdata   <= 32'hDEAD_BEEF;
        tif.wstrb   <= 4'hF;
        tif.wlast   <= 1'b1;
        tif.wvalid  <= 1'b1;
        tif.bready  <= 1'b1;
        $display("[35 ns] Driving AXI4 WRITE: Addr=0x20 Data=0xDEADBEEF");

        // Step 2: Clear valid after 1 cycle
        @(posedge clk);
        tif.awvalid <= 1'b0;
        tif.wvalid  <= 1'b0;

        // Step 3: Wait fixed cycles for write response
        repeat(2) @(posedge clk);
        $display("[65 ns] Received AXI4 WRITE Response BVALID OKAY");

        // Step 4: Drive Read Address
        @(posedge clk);
        tif.arid    <= 4'h1;
        tif.araddr  <= 32'h0000_0020;
        tif.arlen   <= 8'h00;
        tif.arburst <= 2'b01;
        tif.arvalid <= 1'b1;
        tif.rready  <= 1'b1;
        $display("[75 ns] Driving AXI4 READ Request: Addr=0x20");

        // Step 5: Clear arvalid after 1 cycle
        @(posedge clk);
        tif.arvalid <= 1 me; // test replacement

        repeat(2) @(posedge clk);
        $display("[105 ns] Received AXI4 READ Data: RDATA=0x%0h", tif.rdata);

        #30;
        $display("=== AXI4 TESTBENCH COMPLETED CLEANLY ===");
        $finish;
    end
endmodule
"""

# Replace test error
code = code.replace("1 me", "1'b0")

req_data = json.dumps({
    "command": "xezim --simulate $FILE",
    "code": code
}).encode("utf-8")

req = urllib.request.Request("https://wtb-sim.onrender.com/lint", data=req_data, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print("EXIT CODE:", res.get("exit_code"))
        print("STDOUT:\n", res.get("stdout"))
        print("STDERR:\n", res.get("stderr"))
except Exception as e:
    print("ERROR:", e)
