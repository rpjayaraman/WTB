/**
 * ═══════════════════════════════════════════════════════════════
 * WHAT THE BUG — DESIGN VERIFICATION PLATFORM
 * Central Database Metadata for Sanity Check Exercise
 * ═══════════════════════════════════════════════════════════════
 */

const DV_QUESTIONS_METADATA = {
    "sv_coding": [
        {
            "id": "sv_q1",
            "title": "Sanity Check: Full Testbench & Verification Environment",
            "description": "Comprehensive SystemVerilog testbench demonstrating console logging ($display), signal waveform dumping (VCD), WaveDrom rendering, functional coverage (covergroup & cross coverage), and concurrent SVA assertions.",
            "reference": "IEEE 1800-2023 SystemVerilog LRM",
            "difficulty": "warmup"
        }
    ],
    "uvm_coding": [
        {
            "id": "uvm_q1",
            "title": "AXI4 Accelerated Verification IP (AVIP) & Memory Slave Testbench",
            "description": "Production-grade UVM verification environment for AXI4 Memory Slave protocol derived from mbits-mirafra/axi4_avip. The left pane shows the synthesizable AXI4 Slave RTL & Interface DUT, while the right pane contains individual UVM testbench component files (Sequence Item, Driver, Monitor, Agent, Environment, Test, and Top TB).",
            "reference": "ARM AMBA AXI4 Protocol Spec & UVM 1.2 Class Library",
            "difficulty": "advanced",
            "checklist": [
                "AXI4 Full Handshake: AWVALID/AWREADY, WVALID/WREADY, BVALID/BREADY, ARVALID/ARREADY, RVALID/RREADY",
                "UVM Phase execution: build_phase, connect_phase, run_phase with objection handling",
                "Transaction constraints for BURST_INCR / BURST_FIXED transfers",
                "Analysis Port broadcasting from Monitor to Scoreboard",
                "XEZIM / Verilator multi-file compilation and VCD waveform trace generation"
            ],
            "designCode": `// ═══════════════════════════════════════════════════════════════
// AXI4 MEMORY SLAVE RTL DUT & INTERFACE (LEFT PANE DESIGN)
// Derived from mbits-mirafra/axi4_avip Architecture
// ═══════════════════════════════════════════════════════════════

interface axi4_if (input logic clk, input logic rst_n);
    // Write Address Channel
    logic [3:0]   awid;
    logic [31:0]  awaddr;
    logic [7:0]   awlen;
    logic [2:0]   awsize;
    logic [1:0]   awburst;
    logic         awvalid;
    logic         awready;

    // Write Data Channel
    logic [31:0]  wdata;
    logic [3:0]   wstrb;
    logic         wlast;
    logic         wvalid;
    logic         wready;

    // Write Response Channel
    logic [3:0]   bid;
    logic [1:0]   bresp;
    logic         bvalid;
    logic         bready;

    // Read Address Channel
    logic [3:0]   arid;
    logic [31:0]  araddr;
    logic [7:0]   arlen;
    logic [2:0]   arsize;
    logic [1:0]   arburst;
    logic         arvalid;
    logic         arready;

    // Read Data Channel
    logic [3:0]   rid;
    logic [31:0]  rdata;
    logic [1:0]   rresp;
    logic         rlast;
    logic         rvalid;
    logic         rready;
endinterface

module axi4_slave_dut (axi4_if tif);
    logic [31:0] mem [0:255];

    // Write Channel Handshake Logic
    always_ff @(posedge tif.clk or negedge tif.rst_n) begin
        if (!tif.rst_n) begin
            tif.awready <= 1'b0;
            tif.wready  <= 1'b0;
            tif.bvalid  <= 1'b0;
            tif.bresp   <= 2'b00; // OKAY
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

    // Read Channel Handshake Logic
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
endmodule`,
            "files": [
                {
                    "name": "axi4_seq_item.sv",
                    "code": `// ═══════════════════════════════════════════════════════════════
// AXI4 UVM SEQUENCE ITEM (TRANSACTION CLASS)
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

typedef enum logic [1:0] { READ = 2'b00, WRITE = 2'b01 } axi_op_e;

class axi4_seq_item extends uvm_sequence_item;
    rand axi_op_e      op;
    rand logic [3:0]   id;
    rand logic [31:0]  addr;
    rand logic [7:0]   len;
    rand logic [2:0]   size;
    rand logic [1:0]   burst;
    rand logic [31:0]  data;
    
    // Response fields
    logic [1:0]  resp;

    \`uvm_object_utils_begin(axi4_seq_item)
        \`uvm_field_enum(axi_op_e, op, UVM_ALL_ON)
        \`uvm_field_int(id, UVM_ALL_ON)
        \`uvm_field_int(addr, UVM_ALL_ON)
        \`uvm_field_int(len, UVM_ALL_ON)
        \`uvm_field_int(data, UVM_ALL_ON)
        \`uvm_field_int(resp, UVM_ALL_ON)
    \`uvm_object_utils_end

    constraint c_align {
        addr[1:0] == 2'b00;
        addr < 32'h0000_0100;
        len == 8'h00; // Single transfers for demo
    }

    function new(string name = "axi4_seq_item");
        super.new(name);
    endfunction
endclass`
                },
                {
                    "name": "axi4_driver.sv",
                    "code": `// ═══════════════════════════════════════════════════════════════
// AXI4 UVM MASTER DRIVER
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class axi4_driver extends uvm_driver #(axi4_seq_item);
    \`uvm_component_utils(axi4_driver)
    
    virtual axi4_if vif;

    function new(string name = "axi4_driver", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        if (!uvm_config_db#(virtual axi4_if)::get(this, "", "vif", vif))
            \`uvm_fatal("NOVIF", "virtual interface axi4_if not set in config_db")
    endfunction

    task run_phase(uvm_phase phase);
        // Reset signals
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
            \`uvm_info("AXI4_DRV", $sformatf("Driving AXI4 WRITE: Addr=0x%0h Data=0x%0h", item.addr, item.data), UVM_LOW)
            vif.awid    <= item.id;
            vif.awaddr  <= item.addr;
            vif.awlen   <= item.len;
            vif.awburst <= 2'b01; // INCR
            vif.awvalid <= 1'b1;
            
            vif.wdata   <= item.data;
            vif.wstrb   <= 4'hF;
            vif.wlast   <= 1'b1;
            vif.wvalid  <= 1'b1;

            @(posedge vif.clk);
            while (!vif.awready || !vif.wready) @(posedge vif.clk);
            vif.awvalid <= 1'b0;
            vif.wvalid  <= 1'b0;

            while (!vif.bvalid) @(posedge vif.clk);
            item.resp = vif.bresp;
        end else begin
            \`uvm_info("AXI4_DRV", $sformatf("Driving AXI4 READ: Addr=0x%0h", item.addr), UVM_LOW)
            vif.arid    <= item.id;
            vif.araddr  <= item.addr;
            vif.arlen   <= item.len;
            vif.arburst <= 2'b01;
            vif.arvalid <= 1'b1;

            @(posedge vif.clk);
            while (!vif.arready) @(posedge vif.clk);
            vif.arvalid <= 1'b0;

            while (!vif.rvalid) @(posedge vif.clk);
            item.data = vif.rdata;
            item.resp = vif.rresp;
        end
    endtask
endclass`
                },
                {
                    "name": "axi4_monitor.sv",
                    "code": `// ═══════════════════════════════════════════════════════════════
// AXI4 UVM BUS MONITOR
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class axi4_monitor extends uvm_monitor;
    \`uvm_component_utils(axi4_monitor)

    virtual axi4_if vif;
    uvm_analysis_port #(axi4_seq_item) item_collected_port;

    function new(string name = "axi4_monitor", uvm_component parent = null);
        super.new(name, parent);
        item_collected_port = new("item_collected_port", this);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        if (!uvm_config_db#(virtual axi4_if)::get(this, "", "vif", vif))
            \`uvm_fatal("NOVIF", "virtual interface axi4_if not set in config_db")
    endfunction

    task run_phase(uvm_phase phase);
        forever begin
            @(posedge vif.clk);
            if (vif.awvalid && vif.awready) begin
                axi4_seq_item item = axi4_seq_item::type_id::create("mon_item");
                item.op   = WRITE;
                item.addr = vif.awaddr;
                item.data = vif.wdata;
                \`uvm_info("AXI4_MON", $sformatf("Monitored WRITE: Addr=0x%0h Data=0x%0h", item.addr, item.data), UVM_MEDIUM)
                item_collected_port.write(item);
            end
            if (vif.arvalid && vif.arready) begin
                axi4_seq_item item = axi4_seq_item::type_id::create("mon_item");
                item.op   = READ;
                item.addr = vif.araddr;
                \`uvm_info("AXI4_MON", $sformatf("Monitored READ Request: Addr=0x%0h", item.addr), UVM_MEDIUM)
                item_collected_port.write(item);
            end
        end
    endtask
endclass`
                },
                {
                    "name": "axi4_agent.sv",
                    "code": `// ═══════════════════════════════════════════════════════════════
// AXI4 UVM AGENT
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class axi4_agent extends uvm_agent;
    \`uvm_component_utils(axi4_agent)

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
endclass`
                },
                {
                    "name": "axi4_env.sv",
                    "code": `// ═══════════════════════════════════════════════════════════════
// AXI4 UVM ENVIRONMENT
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class axi4_env extends uvm_env;
    \`uvm_component_utils(axi4_env)

    axi4_agent agent;

    function new(string name = "axi4_env", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        agent = axi4_agent::type_id::create("agent", this);
    endfunction
endclass`
                },
                {
                    "name": "top_tb.sv",
                    "code": `// ═══════════════════════════════════════════════════════════════
// TOP TESTBENCH HARNESS & UVM TEST EXECUTION
// ═══════════════════════════════════════════════════════════════
\`timescale 1ns/1ps
import uvm_pkg::*;

class axi4_random_test extends uvm_test;
    \`uvm_component_utils(axi4_random_test)

    axi4_env env;

    function new(string name = "axi4_random_test", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        env = axi4_env::type_id::create("env", this);
    endfunction

    task run_phase(uvm_phase phase);
        axi4_seq_item item;
        phase.raise_objection(this, "Starting AXI4 Test Sequence");
        \`uvm_info("AXI4_TEST", "=== STARTING AXI4 MEMORY SLAVE UVM TEST ===", UVM_LOW)

        // 1. Write Transaction to Address 0x20
        item = axi4_seq_item::type_id::create("item_w");
        start_item_on_sequencer(item);
        item.op   = WRITE;
        item.addr = 32'h0000_0020;
        item.data = 32'hDEAD_BEEF;
        finish_item_on_sequencer(item);

        #20;

        // 2. Read Transaction from Address 0x20
        item = axi4_seq_item::type_id::create("item_r");
        start_item_on_sequencer(item);
        item.op   = READ;
        item.addr = 32'h0000_0020;
        finish_item_on_sequencer(item);

        #50;
        \`uvm_info("AXI4_TEST", $sformatf("=== READ VERIFICATION COMPLETE: Received Data=0x%0h ===", item.data), UVM_LOW)
        phase.drop_objection(this, "Ending AXI4 Test Sequence");
    endtask

    task start_item_on_sequencer(axi4_seq_item item);
        uvm_sequence_item dummy;
        env.agent.sequencer.wait_for_grant();
        env.agent.sequencer.send_request(item);
    endtask

    task finish_item_on_sequencer(axi4_seq_item item);
        env.agent.sequencer.wait_for_item_done();
    endtask
endclass

module top_tb;
    logic clk;
    logic rst_n;

    // Clock generator
    initial begin
        clk = 0;
        forever #5 clk = ~clk;
    end

    // Reset generator
    initial begin
        rst_n = 0;
        #15 rst_n = 1;
    end

    // Interface & DUT Instantiation
    axi4_if tif (clk, rst_n);
    axi4_slave_dut dut (tif);

    // VCD Dump
    initial begin
        $dumpfile("wave.vcd");
        $dumpvars(0, top_tb);
    end

    initial begin
        uvm_config_db#(virtual axi4_if)::set(null, "*", "vif", tif);
        run_test("axi4_random_test");
    end
endmodule`
                }
            ]
        }
    ],
    "sva_coverage": [
        {
            "id": "sva_q1",
            "title": "Sanity Check: Full Testbench & Verification Environment",
            "description": "Comprehensive SystemVerilog testbench demonstrating console logging ($display), signal waveform dumping (VCD), WaveDrom rendering, functional coverage (covergroup & cross coverage), and concurrent SVA assertions.",
            "reference": "IEEE 1800-2023 SystemVerilog LRM",
            "difficulty": "warmup"
        }
    ],
    "waveform_demo": [
        {
            "id": "wave_q1",
            "title": "Signal Intelligence Interactive VCD Waveform Viewer",
            "description": "Interactive waveform sandbox rendering clock, reset_n, request, and acknowledge bus signals with zoom and cursor time markers.",
            "reference": "IEEE 1800-2023 LRM VCD Standard",
            "difficulty": "medium"
        }
    ],
    "lrm_deep_dive": [
        {
            "id": "lrm_q1",
            "title": "Sanity Check: Full Testbench & Verification Environment",
            "description": "Comprehensive SystemVerilog testbench demonstrating console logging ($display), signal waveform dumping (VCD), WaveDrom rendering, functional coverage (covergroup & cross coverage), and concurrent SVA assertions.",
            "reference": "IEEE 1800-2023 SystemVerilog LRM",
            "difficulty": "warmup"
        }
    ],
    "dataset_manager": [
        {
            "id": "dataset_q1",
            "title": "Gemma SFT Instruction Dataset Exporter",
            "description": "Tool for exporting completed SystemVerilog & UVM testbench solutions into Gemma 2B/9B QLoRA instruction dataset format.",
            "reference": "Unsloth SFT Fine-Tuning Specification",
            "difficulty": "medium"
        }
    ]
};
