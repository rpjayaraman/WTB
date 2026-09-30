# ⚡ UVM Architect — Interactive Digital Book & Verification Playground

An interactive digital book and verification battle station inspired by **[whathebug.com](https://whathebug.com)**, built directly from the `UVMCourse` repository and comprehensive wiki curriculum.

---

## 🌟 Key Features

1. **Tri-Mode Learning Workspace**:
   - 📖 **Reader Focus Mode**: Clean, distraction-free textbook reading with deep-dive theory, code callouts, and interactive diagrams.
   - ⚡ **Split Lab Mode (Battle Station - Default)**: Side-by-side verification station (Left: Theory & Student Mission; Right: Multi-tab SystemVerilog Code Playground; Bottom: Resizable Console).
   - 💻 **IDE Studio Mode**: 100% full-width code editor and verification console for intensive testbench development and debugging.

2. **Strict Verilator-First Simulation**:
   - **Default Simulator**: **Verilator 5.050** (`--binary --timing -Wno-fatal +define+UVM_NO_DPI`).
   - Translates and executes SystemVerilog and UVM 1.2 testbenches with native C++ execution speed.
   - Built-in incremental compilation cache for sub-second re-runs.
   - **Secondary Engine**: **Xezim** (the engine used by WhatTheBug) is available as an instant-run engine (< 0.5s) via the top engine dropdown.

3. **10 Course Modules (28 Interactive Labs)**:
   - **01. UVM Introduction**: Why UVM, SV TB vs UVM TB, Testbench Architecture.
   - **02. Basics & Base Classes**: `uvm_void`, `uvm_object`, `uvm_component`, `uvm_root`, printing, string conversion, and object comparison.
   - **03. Reporting & Verbosity**: `UVM_INFO`, `UVM_WARNING`, `UVM_ERROR`, `UVM_FATAL`, verbosity filtering, and custom report actions.
   - **04. UVM Factory & Overrides**: `type_id::create()`, `new()`, type overrides, and instance overrides.
   - **05. Stimulus Generation & Sequences**: Sequences, `body()`, `uvm_do` macros, arbitration policies (FIFO, STRICT, RANDOM, WEIGHTED), and virtual sequences.
   - **06. Driver-Sequence Handshake**: `get_next_item()` / `item_done()`, `start_item()` / `finish_item()`, and late randomization.
   - **07. UVM Phases**: The 9 common phases, top-down vs bottom-up execution, the 12 run sub-phases, and objections.
   - **08. Configuration & Resource DB**: `uvm_config_db`, `uvm_resource_db`, hierarchical scope resolution, and virtual interface passing.
   - **09. UVM TLM 1.0 & 2.0**: Blocking/non-blocking put/get, TLM FIFOs, Analysis ports, and TLM 2.0 sockets.
   - **10. Miscellaneous Utilities**: `uvm_pool`, `uvm_event_pool`, and `uvm_comparer`.

4. **Pedagogical Tools for Students**:
   - **Interactive UVM Topology Map**: Automatically visualizes the instantiated component hierarchy (`uvm_top` → `test` → `env` → `agent` → `driver`/`monitor`/`sequencer`).
   - **UVM Phasing Timeline**: Visual execution timeline showing phase order and function vs task characteristics.
   - **Student Lab Missions**: Guided challenges in each chapter to encourage active experimentation.
   - **Colorized Severity Console**: Real-time streaming log highlights `UVM_INFO` (green), `UVM_WARNING` (amber), `UVM_ERROR` (red), `UVM_FATAL` (crimson), and phase events (cyan).
   - **Golden Reference Diff**: Compare your simulation results 1-to-1 against golden reference logs.

---

## 🚀 Quick Start

### 1. Launch with One Command
```bash
./digital_book/run_book.sh
```
This starts the local simulation server and automatically opens `http://localhost:8080/index.html` in your default web browser.

### 2. Manual Server Startup
Alternatively, run with Python directly:
```bash
python3 digital_book/server.py 8080
```
Then navigate to:
```
http://localhost:8080/index.html
```

### 3. Standalone Offline Mode
You can also open `digital_book/index.html` directly in any web browser without running Python. All course theory, multi-file code examples, and pre-computed golden logs are fully embedded!

---

## 🎮 How to Use the Digital Book

1. **Select a Chapter** from the left curriculum sidebar.
2. **Read the Theory & Student Mission** in the left reader pane.
3. **Inspect and Edit Code** in the right playground editor across multiple file tabs (`top.sv`, `test.sv`, etc.).
4. **Adjust CLI Flags** in the top bar (e.g. change `+UVM_VERBOSITY` from `UVM_MEDIUM` to `UVM_DEBUG`).
5. **Click `▶ Run Simulation`**: Watch the Verilator simulation stream live output into the console drawer!
6. **Switch Console Tabs** to view the **UVM Topology tree**, **Phasing timeline**, **Golden reference log**, or **Benchmark stats**.
