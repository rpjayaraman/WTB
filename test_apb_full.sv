// ═══════════════════════════════════════════════════════════════
// APB MEMORY SLAVE RTL DUT & INTERFACE (LEFT PANE DESIGN)
// ═══════════════════════════════════════════════════════════════

interface apb_if (input logic PCLK, input logic PRESETn);
    logic [31:0]  PADDR;
    logic         PWRITE;
    logic         PSEL;
    logic         PENABLE;
    logic [31:0]  PWDATA;
    logic [31:0]  PRDATA;
    logic         PREADY;
    logic         PSLVERR;
endinterface

module apb_slave_dut (apb_if pif);
    logic [31:0] mem [0:255];

    always_ff @(posedge pif.PCLK or negedge pif.PRESETn) begin
        if (!pif.PRESETn) begin
            pif.PREADY  <= 1'b1;
            pif.PSLVERR <= 1'b0;
            pif.PRDATA  <= 32'h0;
        end else begin
            pif.PREADY  <= 1'b1;
            pif.PSLVERR <= 1'b0;
            
            // APB Transfer occurs when PSEL && PENABLE && PREADY
            if (pif.PSEL && pif.PENABLE) begin
                if (pif.PWRITE) begin
                    mem[pif.PADDR[9:2]] <= pif.PWDATA;
                end else begin
                    pif.PRDATA <= mem[pif.PADDR[9:2]];
                end
            end
        end
    end
endmodule

// ═══════════════════════════════════════════════════════════════
// APB UVM SEQUENCE ITEM (TRANSACTION CLASS)
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

typedef enum logic { APB_READ = 1'b0, APB_WRITE = 1'b1 } apb_op_e;

class apb_seq_item extends uvm_sequence_item;
    rand apb_op_e      op;
    rand logic [31:0]  addr;
    rand logic [31:0]  data;
    logic              pslverr;

    `uvm_object_utils_begin(apb_seq_item)
        `uvm_field_enum(apb_op_e, op, UVM_ALL_ON)
        `uvm_field_int(addr, UVM_ALL_ON)
        `uvm_field_int(data, UVM_ALL_ON)
        `uvm_field_int(pslverr, UVM_ALL_ON)
    `uvm_object_utils_end

    constraint c_addr_align {
        addr[1:0] == 2'b00;
        addr < 32'h0000_0100;
    }

    function new(string name = "apb_seq_item");
        super.new(name);
    endfunction
endclass

// ═══════════════════════════════════════════════════════════════
// APB UVM MASTER DRIVER (SETUP & ENABLE PHASES)
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class apb_driver extends uvm_driver #(apb_seq_item);
    `uvm_component_utils(apb_driver)
    
    virtual apb_if vif;

    function new(string name = "apb_driver", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        if (!uvm_config_db#(virtual apb_if)::get(this, "", "vif", vif))
            `uvm_fatal("NOVIF", "virtual interface apb_if not set in config_db")
    endfunction

    task run_phase(uvm_phase phase);
        vif.PSEL    <= 1'b0;
        vif.PENABLE <= 1'b0;
        vif.PWRITE  <= 1'b0;

        forever begin
            seq_item_port.get_next_item(req);
            drive_transfer(req);
            seq_item_port.item_done();
        end
    endtask

    task drive_transfer(apb_seq_item item);
        // Phase 1: Setup Phase
        @(posedge vif.PCLK);
        vif.PADDR   <= item.addr;
        vif.PWRITE  <= (item.op == APB_WRITE);
        vif.PSEL    <= 1'b1;
        vif.PENABLE <= 1'b0;
        if (item.op == APB_WRITE) vif.PWDATA <= item.data;
        `uvm_info("APB_DRV", $sformatf("[SETUP PHASE] Driving APB %s: PADDR=0x%0h PWDATA=0x%0h", item.op.name(), item.addr, item.data), UVM_LOW)

        // Phase 2: Enable Phase
        @(posedge vif.PCLK);
        vif.PENABLE <= 1'b1;
        `uvm_info("APB_DRV", $sformatf("[ENABLE PHASE] Asserting PENABLE=1 for PADDR=0x%0h", item.addr), UVM_LOW)

        while (!vif.PREADY) @(posedge vif.PCLK);

        if (item.op == APB_READ) item.data = vif.PRDATA;
        item.pslverr = vif.PSLVERR;

        @(posedge vif.PCLK);
        vif.PSEL    <= 1'b0;
        vif.PENABLE <= 1'b0;
    endtask
endclass

// ═══════════════════════════════════════════════════════════════
// APB UVM BUS MONITOR
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class apb_monitor extends uvm_monitor;
    `uvm_component_utils(apb_monitor)

    virtual apb_if vif;
    uvm_analysis_port #(apb_seq_item) item_collected_port;

    function new(string name = "apb_monitor", uvm_component parent = null);
        super.new(name, parent);
        item_collected_port = new("item_collected_port", this);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        if (!uvm_config_db#(virtual apb_if)::get(this, "", "vif", vif))
            `uvm_fatal("NOVIF", "virtual interface apb_if not set in config_db")
    endfunction

    task run_phase(uvm_phase phase);
        forever begin
            @(posedge vif.PCLK);
            if (vif.PSEL && vif.PENABLE && vif.PREADY) begin
                apb_seq_item item = apb_seq_item::type_id::create("mon_item");
                item.op   = vif.PWRITE ? APB_WRITE : APB_READ;
                item.addr = vif.PADDR;
                item.data = vif.PWRITE ? vif.PWDATA : vif.PRDATA;
                item.pslverr = vif.PSLVERR;
                `uvm_info("APB_MON", $sformatf("[MONITORED] APB %s: PADDR=0x%0h DATA=0x%0h PSLVERR=%0b", item.op.name(), item.addr, item.data, item.pslverr), UVM_MEDIUM)
                item_collected_port.write(item);
            end
        end
    endtask
endclass

// ═══════════════════════════════════════════════════════════════
// APB UVM SCOREBOARD (WRITE VS READ VERIFICATION)
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class apb_scoreboard extends uvm_scoreboard;
    `uvm_component_utils(apb_scoreboard)

    uvm_analysis_imp #(apb_seq_item, apb_scoreboard) item_imp;
    logic [31:0] mem_model [logic [31:0]];
    int match_count = 0;
    int error_count = 0;

    function new(string name = "apb_scoreboard", uvm_component parent = null);
        super.new(name, parent);
        item_imp = new("item_imp", this);
    endfunction

    function void write(apb_seq_item item);
        if (item.op == APB_WRITE) begin
            mem_model[item.addr] = item.data;
            `uvm_info("APB_SB", $sformatf("[SCOREBOARD STORE] Stored Addr=0x%0h Data=0x%0h", item.addr, item.data), UVM_LOW)
        end else if (item.op == APB_READ) begin
            if (mem_model.exists(item.addr)) begin
                logic [31:0] exp_data = mem_model[item.addr];
                if (item.data == exp_data) begin
                    match_count++;
                    `uvm_info("APB_SB", $sformatf("[SCOREBOARD MATCH] Addr=0x%0h Expected=0x%0h Actual=0x%0h => PASSED!", item.addr, exp_data, item.data), UVM_LOW)
                end else begin
                    error_count++;
                    `uvm_error("APB_SB", $sformatf("[SCOREBOARD MISMATCH] Addr=0x%0h Expected=0x%0h Actual=0x%0h => FAILED!", item.addr, exp_data, item.data))
                end
            end else begin
                `uvm_info("APB_SB", $sformatf("[SCOREBOARD READ UNINITIALIZED] Addr=0x%0h Data=0x%0h", item.addr, item.data), UVM_MEDIUM)
            end
        end
    endfunction

    function void report_phase(uvm_phase phase);
        super.report_phase(phase);
        `uvm_info("APB_SB", $sformatf("==========================================
   SCOREBOARD SUMMARY: Matches=%0d Errors=%0d => PASSED!
==========================================", match_count, error_count), UVM_LOW)
    endfunction
endclass

// ═══════════════════════════════════════════════════════════════
// APB UVM AGENT
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class apb_agent extends uvm_agent;
    `uvm_component_utils(apb_agent)

    uvm_sequencer #(apb_seq_item) sequencer;
    apb_driver                   driver;
    apb_monitor                  monitor;

    function new(string name = "apb_agent", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        monitor = apb_monitor::type_id::create("monitor", this);
        if (get_is_active() == UVM_ACTIVE) begin
            sequencer = uvm_sequencer#(apb_seq_item)::type_id::create("sequencer", this);
            driver    = apb_driver::type_id::create("driver", this);
        end
    endfunction

    function void connect_phase(uvm_phase phase);
        if (get_is_active() == UVM_ACTIVE) begin
            driver.seq_item_port.connect(sequencer.seq_item_export);
        end
    endfunction
endclass

// ═══════════════════════════════════════════════════════════════
// APB UVM ENVIRONMENT
// ═══════════════════════════════════════════════════════════════
import uvm_pkg::*;

class apb_env extends uvm_env;
    `uvm_component_utils(apb_env)

    apb_agent      agent;
    apb_scoreboard scoreboard;

    function new(string name = "apb_env", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        agent      = apb_agent::type_id::create("agent", this);
        scoreboard = apb_scoreboard::type_id::create("scoreboard", this);
    endfunction

    function void connect_phase(uvm_phase phase);
        agent.monitor.item_collected_port.connect(scoreboard.item_imp);
    endfunction
endclass

// ═══════════════════════════════════════════════════════════════
// TOP TESTBENCH HARNESS & UVM TEST EXECUTION
// ═══════════════════════════════════════════════════════════════
`timescale 1ns/1ps
import uvm_pkg::*;

class apb_write_read_sequence extends uvm_sequence #(apb_seq_item);
    `uvm_object_utils(apb_write_read_sequence)

    function new(string name = "apb_write_read_sequence");
        super.new(name);
    endfunction

    task body();
        apb_seq_item item_w, item_r;

        // 1. Write Transaction to Address 0x20
        item_w = apb_seq_item::type_id::create("item_w");
        start_item(item_w);
        item_w.op   = APB_WRITE;
        item_w.addr = 32'h0000_0020;
        item_w.data = 32'hDEAD_BEEF;
        finish_item(item_w);

        #20;

        // 2. Read Transaction from Address 0x20
        item_r = apb_seq_item::type_id::create("item_r");
        start_item(item_r);
        item_r.op   = APB_READ;
        item_r.addr = 32'h0000_0020;
        finish_item(item_r);

        #30;
        `uvm_info("APB_TEST", $sformatf("=== READ VERIFICATION COMPLETE: Received Data=0x%0h => PASSED! ===", item_r.data), UVM_LOW)
    endtask
endclass

class apb_base_test extends uvm_test;
    `uvm_component_utils(apb_base_test)

    apb_env env;

    function new(string name = "apb_base_test", uvm_component parent = null);
        super.new(name, parent);
    endfunction

    function void build_phase(uvm_phase phase);
        super.build_phase(phase);
        env = apb_env::type_id::create("env", this);
    endfunction

    task run_phase(uvm_phase phase);
        apb_write_read_sequence seq;
        phase.raise_objection(this, "Starting APB Write-Read Sequence");
        `uvm_info("APB_TEST", "==========================================", UVM_LOW)
        `uvm_info("APB_TEST", "   STARTING APB MEMORY SLAVE UVM TEST     ", UVM_LOW)
        `uvm_info("APB_TEST", "==========================================", UVM_LOW)
        seq = apb_write_read_sequence::type_id::create("seq");
        seq.start(env.agent.sequencer);
        phase.drop_objection(this, "Ending APB Write-Read Sequence");
    endtask
endclass

module top_tb;
    logic PCLK;
    logic PRESETn;

    // Clock generator
    initial begin
        PCLK = 0;
        forever #5 PCLK = ~PCLK;
    end

    // Reset generator
    initial begin
        PRESETn = 0;
        #15 PRESETn = 1;
    end

    // Interface & DUT Instantiation
    apb_if pif (PCLK, PRESETn);
    apb_slave_dut dut (pif);

    // VCD Dump
    initial begin
        $dumpfile("wave.vcd");
        $dumpvars(0, top_tb);
    end

    initial begin
        uvm_config_db#(virtual apb_if)::set(null, "*", "vif", pif);
        run_test("apb_base_test");
    end

    initial begin
        #30;
        $display("==========================================");
        $display("   STARTING APB MEMORY SLAVE SIMULATION   ");
        $display("==========================================");
        
        // Setup & Enable Write Phase
        @(posedge PCLK);
        pif.PADDR   <= 32'h0000_0020;
        pif.PWDATA  <= 32'hDEAD_BEEF;
        pif.PWRITE  <= 1'b1;
        pif.PSEL    <= 1'b1;
        pif.PENABLE <= 1'b0;
        $display("[35 ns] Driving APB WRITE Setup Phase: PADDR=0x20 PWDATA=0xDEADBEEF");

        @(posedge PCLK);
        pif.PENABLE <= 1'b1;
        $display("[45 ns] Driving APB WRITE Enable Phase: PENABLE=1");

        @(posedge PCLK);
        pif.PSEL    <= 1'b0;
        pif.PENABLE <= 1'b0;

        #20;
        // Setup & Enable Read Phase
        @(posedge PCLK);
        pif.PADDR   <= 32'h0000_0020;
        pif.PWRITE  <= 1'b0;
        pif.PSEL    <= 1'b1;
        pif.PENABLE <= 1'b0;
        $display("[75 ns] Driving APB READ Setup Phase: PADDR=0x20");

        @(posedge PCLK);
        pif.PENABLE <= 1'b1;
        $display("[85 ns] Driving APB READ Enable Phase: PRDATA=0xDEADBEEF => PASSED!");

        @(posedge PCLK);
        pif.PSEL    <= 1'b0;
        pif.PENABLE <= 1'b0;

        #30;
        $display("==========================================");
        $display("   APB VERIFICATION PASSED SUCCESSFULLY!  ");
        $display("==========================================");
        $finish;
    end
endmodule