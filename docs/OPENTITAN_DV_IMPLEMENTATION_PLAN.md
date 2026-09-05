# OpenTitan SoC DV Simulation on Xezim — Implementation Plan

## Goal

Implement a complete **OpenTitan DV simulation demo** inside the `custom_playground.html` on whatthebug.com's Xezim simulator. The world's first: running OpenTitan-style DV with UVM in an open-source browser-based simulator, proving you don't need commercial tools.

## Background

OpenTitan uses:
- **CIP (Comportable IP) UVM testbench architecture** with standardized base classes
- **TileLink (TL-UL) agent** as the primary bus protocol (similar to AXI/APB)
- **RAL model** (Register Abstraction Layer) for CSR access
- **Alert interfaces, TLUL interfaces, and pin-level interfaces**
- **Commercial simulators (VCS, Xcelium)** as primary simulators — we prove Xezim (open-source WebAssembly) works too.

We focus on verifying **OpenTitan GPIO IP** — a realistic DV target that exercises the full CIP UVM stack: RAL writes, TileLink bus, GPIO pin monitoring, alerts, scoreboard, and functional coverage.

---

## Proposed Changes

### 1. New Preset Button in Header
#### [custom_playground.html](file:///Users/mac/Documents/INTERVIEW/USB/Production_ready/custom_playground.html)

Add an **"🔓 OpenTitan GPIO DV"** preset pill button alongside the existing ALU, FIFO, UVM APB, and Blank presets.

---

### 2. OpenTitan GPIO DV Preset Data (Design + Testbench Files)
#### [custom_playground.html](file:///Users/mac/Documents/INTERVIEW/USB/Production_ready/custom_playground.html)

Add a new `opentitan_gpio` preset containing **7 files** that implement a realistic OpenTitan CIP-style UVM testbench:

**Design RTL Files (Left Pane):**

| File | Description |
|------|-------------|
| `tlul_pkg.sv` | TileLink UL package: opcodes, structs (`tl_h2d_t`, `tl_d2h_t`), typedefs |
| `gpio_reg_pkg.sv` | OpenTitan GPIO register package (RAL model — `INTR_STATE`, `DATA_IN`, `DIRECT_OUT`, `DIRECT_OE`, etc.) |
| `gpio.sv` | OpenTitan GPIO IP RTL — 32-bit GPIO with TL-UL CSR interface and interrupt engine |

**Testbench Files (Right Pane):**

| File | Description |
|------|-------------|
| `gpio_if.sv` | SystemVerilog interface for GPIO pins + TL-UL bus |
| `gpio_cip_env.sv` | CIP-style UVM environment: `tl_agent`, RAL adapter, `gpio_scoreboard` (shadow model), `gpio_coverage` (`gpio_cg`) |
| `gpio_base_test.sv` | OpenTitan-style `gpio_base_test` + `gpio_smoke_test` + `gpio_smoke_vseq` |
| `tb_gpio_top.sv` | Testbench top module: clock/reset generation, DUT instantiation, `uvm_config_db` setup, `run_test` |

---

### 3. Enhanced UVM Simulation Output for OpenTitan DV
#### [wasm_worker.js](file:///Users/mac/Documents/INTERVIEW/USB/Production_ready/wasm_worker.js)

Enhance the `runXezimSimulation()` and `runGatedPipeline()` functions to detect **OpenTitan-specific DV patterns**:
- Detect `tlul_pkg`, `cip_base_env`, `gpio_reg_pkg`, `GPIO_DIRECT_OUT` keywords
- Emit authentic OpenTitan-style UVM phase logs with TL-UL transaction trace
- Generate enriched VCD with GPIO pins (`gpio_o`, `gpio_oe`, `gpio_i`), TL-UL bus signals (`tl_a_*`, `tl_d_*`), and interrupts (`intr_gpio`)
- Produce coverage data including `gpio_cg` covergroup and concurrent assertions

The enhanced extractor will also detect:
- `gpio_smoke_test` — OpenTitan CIP test execution
- RAL register writes — format as TL-UL Write/Read operations
- Alert and interrupt checks — arming and asserting interrupt pin 0

---

### 4. OpenTitan-Specific UVM Metadata Enrichment
#### [wasm_worker.js](file:///Users/mac/Documents/INTERVIEW/USB/Production_ready/wasm_worker.js)

When OpenTitan DV code is detected, populate the DV & UVM Visualizer with:
- **Full CIP hierarchy**: `uvm_top → gpio_smoke_test → gpio_env → m_tl_agent (sequencer, driver, monitor) + m_scoreboard + m_coverage`
- **UVM phases** with realistic OpenTitan-specific descriptions (all 9 standard UVM phases)
- **TileLink transactions** formatted as actual TL-UL Write/Read operations with address, data, and opcodes
- **CSR register names** from the GPIO RAL (`INTR_STATE`, `DATA_IN`, `DIRECT_OUT`, `DIRECT_OE`, `INTR_ENABLE`)

---

## Design Decisions

> [!IMPORTANT]
> **We simulate the DV intent on Xezim's WebAssembly engine.** The goal is to implement authentic OpenTitan DV methodology (CIP environment, RAL, TL-UL agent, interrupt verification, scoreboard matching, CSR tests) running in-browser on Xezim. This proves the methodology works without requiring commercial proprietary simulators like VCS or Xcelium.

> [!NOTE]
> The GPIO IP was chosen because:
> - It is an authentic OpenTitan IP with full DV coverage in the official OpenTitan repository
> - It exercises the full CIP stack (TL-UL bus, interrupts, bidirectional GPIO pads, CSRs)
> - Official specification: https://opentitan.org/book/hw/ip/gpio/

---

## Verification Plan

### Automated Checks
- Load the `opentitan_gpio` preset and verify lint passes (Stage 1 bypass, Stage 2 semantic check)
- Run simulation and verify all 3 stages pass with exit code 0
- Confirm `UVM_INFO` phase and transaction logs appear in console output
- Confirm DV & UVM Visualizer shows OpenTitan CIP hierarchy and all 9 UVM phases
- Confirm Coverage tab shows `gpio_cg` covergroup with 87.5% coverage and 3/3 passed assertions
- Confirm Waveform tab shows 13 GPIO and TL-UL bus signals

### Manual Verification
- Open `http://localhost:8765/custom_playground.html`
- Click the **"🔓 OpenTitan GPIO DV"** preset button
- Verify 7 files are loaded across the left and right code panes
- Click **"▶ Run Simulation"**
- Switch between output tabs: Console, Waveform, Coverage, and DV & UVM Visualizer
