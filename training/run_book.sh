#!/usr/bin/env bash
# ==============================================================================
# ⚡ UVM ARCHITECT — Launch Script
# Starts local simulation server and opens the interactive digital book.
# ==============================================================================

PORT=8080
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/.."

echo "=================================================================="
echo "⚡ UVM ARCHITECT: INTERACTIVE DIGITAL BOOK & SIMULATION STATION"
echo "=================================================================="

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is required to run the simulation backend."
    exit 1
fi

# Check for Verilator
if command -v verilator &> /dev/null; then
    VERILATOR_VER=$(verilator --version | head -n 1)
    echo "✅ Verilator Simulator:  $VERILATOR_VER (PRIMARY DEFAULT)"
else
    echo "⚠️  Warning: Verilator not found in PATH."
fi

# Check for Xezim
if [ -f "$HOME/.cargo/bin/xezim" ]; then
    echo "✅ Xezim Engine:        Available at $HOME/.cargo/bin/xezim (SECONDARY)"
else
    echo "ℹ️  Xezim Engine:        Not found at ~/.cargo/bin/xezim"
fi

# Check UVM library
if [ -f "$HOME/xezim-workspace/uvm-1.2/src/uvm_pkg.sv" ]; then
    echo "✅ UVM 1.2 Library:      Detected at $HOME/xezim-workspace/uvm-1.2/src"
fi

echo "------------------------------------------------------------------"
echo "🚀 Starting server at http://localhost:$PORT/index.html"
echo "Press Ctrl+C anytime to stop."
echo "=================================================================="

# Open browser in background after short delay
(
    sleep 1
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:$PORT/index.html"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "http://localhost:$PORT/index.html" &> /dev/null || true
    fi
) &

python3 "$DIR/server.py" "$PORT"
