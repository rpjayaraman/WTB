import json, urllib.request

with open("db_metadata.js") as f:
    js_text = f.read()

# Load db_metadata to python
import re

design_code = """
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
"""

seq_item = """
import uvm_pkg::*;

class axi4_seq_item extends uvm_sequence_item;
    typedef enum {READ, WRITE} op_type_e;
    rand op_type_e op;
    rand logic [31:0] addr;
    rand logic [31:0] data;
    rand logic [7:0]  len;
    rand logic [3:0]  id;
    logic [1:0]       resp;

    `uvm_object_utils_begin(axi4_seq_item)
        `uvm_field_enum(axi4_seq_item::op_type_e, op, UVM_ALL_ON)
        `uvm_field_int(id, UVM_ALL_ON)
        `uvm_field_int(addr, UVM_ALL_ON)
        `uvm_field_int(len, UVM_ALL_ON)
        `uvm_field_int(data, UVM_ALL_ON)
        `uvm_field_int(resp, UVM_ALL_ON)
    `uvm_object_utils_end

    constraint c_align {
        addr[1:0] == 2'b00;
        addr < 32'h0000_0100;
        len == 8'h00;
    }

    function new(string name = "axi4_seq_item");
        super.new(name);
    endfunction
endclass
"""

driver = """
import uvm_pkg::*;

class axi4_driver extends uvm_driver #(axi4_seq_item);
    `uvm_component_utils(axi4_driver)

    virtual axi4_if vif;

    function new(string name = "axi4_driver", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        if (!uvm_config_db#(virtual axi4_if)::get(this, "", "vif", vif)) begin
            `uvm_fatal("DRV_NOVIF", "Virtual interface not set in uvm_config_db!")
        end
    endfunction

    task run_phase(uvm_phase phase);
        vif.awvalid <= 1'b0;
        vif.wvalid  <= 1'b0;
        vif.bready  <= 1'b1;
        vif.arvalid <= 1'b0;
        vif.rready  <= 1'b1;

        forever begin
            seq_item_port.get_next_item(req);
            drive_transfer(req);
            seq_item_port.item_done();
        end
    endtask

    task drive_transfer(axi4_seq_item item);
        @(posedge vif.clk);
        if (item.op == WRITE) begin
            `uvm_info("AXI4_DRV", $sformatf("Driving AXI4 WRITE: Addr=0x%0h Data=0x%0h", item.addr, item.data), UVM_LOW)
            vif.awid    <= item.id;
            vif.awaddr  <= item.addr;
            vif.awlen   <= item.len;
            vif.awburst <= 2'b01;
            vif.awvalid <= 1'b1;
            
            vif.wdata   <= item.data;
            vif.wstrb   <= 4'hF;
            vif.wlast   <= 1'b1;
            vif.wvalid  <= 1'b1;

            @(posedge vif.clk);
            vif.awvalid <= 1'b0;
            vif.wvalid  <= 1'b0;

            repeat(2) @(posedge vif.clk);
            item.resp = vif.bresp;
        end else begin
            `uvm_info("AXI4_DRV", $sformatf("Driving AXI4 READ: Addr=0x%0h", item.addr), UVM_LOW)
            vif.arid    <= item.id;
            vif.araddr  <= item.addr;
            vif.arlen   <= item.len;
            vif.arburst <= 2'b01;
            vif.arvalid <= 1'b1;

            @(posedge vif.clk);
            vif.arvalid <= 1'b0;

            repeat(2) @(posedge vif.clk);
            item.data = vif.rdata;
            item.resp = vif.rresp;
        end
    endtask
endclass
"""

monitor = """
import uvm_pkg::*;

class axi4_monitor extends uvm_monitor;
    `uvm_component_utils(axi4_monitor)

    virtual axi4_if vif;
    uvm_analysis_port #(axi4_seq_item) item_collected_port;

    function new(string name = "axi4_monitor", uvm_component parent = null);
        super.new(name, parent);
        item_collected_port = new("item_collected_port", this);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        if (!uvm_config_db#(virtual axi4_if)::get(this, "", "vif", vif)) begin
            `uvm_fatal("MON_NOVIF", "Virtual interface not set in uvm_config_db!")
        end
    endfunction

    task run_phase(uvm_phase phase);
        forever begin
            @(posedge vif.clk);
            if (vif.awvalid && vif.awready) begin
                axi4_seq_item item = axi4_seq_item::type_id::create("mon_item");
                item.op   = WRITE;
                item.addr = vif.awaddr;
                item.data = vif.wdata;
                item_collected_port.write(item);
            end
        end
    endtask
endclass
"""

agent = """
import uvm_pkg::*;

class axi4_agent extends uvm_agent;
    `uvm_component_utils(axi4_agent)

    uvm_sequencer #(axi4_seq_item) sequencer;
    axi4_driver                  driver;
    axi4_monitor                 monitor;

    function new(string name = "axi4_agent", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        monitor = axi4_monitor::type_id::create("monitor", this);
        if (get_is_active() == UVM_ACTIVE) begin
            sequencer = uvm_sequencer#(axi4_seq_item)::type_id::create("sequencer", this);
            driver    = axi4_driver::type_id::create("driver", this);
        end
    endfunction

    function void connect_phase(uvm_phase phase);
        if (get_is_active() == UVM_ACTIVE) begin
            driver.seq_item_port.connect(sequencer.seq_item_export);
        end
    endfunction
endclass
"""

env = """
import uvm_pkg::*;

class axi4_env extends uvm_env;
    `uvm_component_utils(axi4_env)

    axi4_agent agent;

    function new(string name = "axi4_env", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        agent = axi4_agent::type_id::create("agent", this);
    endfunction
endclass
"""

top_tb = """
`timescale 1ns/1ps
import uvm_pkg::*;

class axi4_base_sequence extends uvm_sequence #(axi4_seq_item);
    `uvm_object_utils(axi4_base_sequence)

    function new(string name = "axi4_base_sequence");
        super.new(name);
    endfunction

    task body();
        axi4_seq_item item_w, item_r;

        item_w = axi4_seq_item::type_id::create("item_w");
        start_item(item_w);
        item_w.op   = WRITE;
        item_w.addr = 32'h0000_0020;
        item_w.data = 32'hDEAD_BEEF;
        finish_item(item_w);

        #20;

        item_r = axi4_seq_item::type_id::create("item_r");
        start_item(item_r);
        item_r.op   = READ;
        item_r.addr = 32'h0000_0020;
        finish_item(item_r);

        #50;
        `uvm_info("AXI4_TEST", $sformatf("=== READ VERIFICATION COMPLETE: Received Data=0x%0h ===", item_r.data), UVM_LOW)
    endtask
endclass

class axi4_random_test extends uvm_test;
    `uvm_component_utils(axi4_random_test)

    axi4_env env;

    function new(string name = "axi4_random_test", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        env = axi4_env::type_id::create("env", this);
    endfunction

    task run_phase(uvm_phase phase);
        axi4_base_sequence seq;
        phase.raise_objection(this, "Starting AXI4 Test Sequence");
        `uvm_info("AXI4_TEST", "=== STARTING AXI4 MEMORY SLAVE UVM TEST ===", UVM_LOW)
        seq = axi4_base_sequence::type_id::create("seq");
        seq.start(env.agent.sequencer);
        phase.drop_objection(this, "Ending AXI4 Test Sequence");
    endtask
endclass

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
        $dumpfile("wave.vcd");
        $dumpvars(0, top_tb);
    end

    initial begin
        uvm_config_db#(virtual axi4_if)::set(null, "*", "vif", tif);
        run_test("axi4_random_test");
    end
endmodule
"""

full_payload = "\n\n".join([design_code, seq_item, driver, monitor, agent, env, top_tb])

req_data = json.dumps({
    "command": "xezim --simulate -DUVM_NO_DPI -I/uvm/uvm-1.2/src /uvm/uvm-1.2/src/uvm_pkg.sv $FILE",
    "code": full_payload
}).encode("utf-8")

req = urllib.request.Request("https://wtb-sim.onrender.com/lint", data=req_data, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print("EXIT CODE:", res.get("exit_code"))
        print("STDOUT:\n", res.get("stdout"))
        print("STDERR:\n", res.get("stderr"))
except Exception as e:
    print("ERROR:", e)
