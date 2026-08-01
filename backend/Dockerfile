# ══════════════════════════════════════════════════════════════════
# WTB Simulation Server — Dockerfile
# Multi-stage build:
#   Stage 1 (builder) : Compile xezim from source using Rust
#   Stage 2 (runtime) : Lean Ubuntu image with xezim + Python + UVM
# ══════════════════════════════════════════════════════════════════

# ── Stage 1: Build xezim from source ─────────────────────────────
FROM rust:latest AS builder

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone both repos side-by-side (xezim Cargo.toml references ../xezim-core)
RUN git clone --depth 1 https://github.com/aionhw/xezim-core.git xezim-core
RUN git clone --depth 1 https://github.com/aionhw/xezim.git xezim

WORKDIR /build/xezim
RUN cargo build --release

# ── Stage 2: Runtime image ────────────────────────────────────────
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    verilator \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled xezim binary from builder stage
COPY --from=builder /build/xezim/target/release/xezim /usr/local/bin/xezim
RUN chmod +x /usr/local/bin/xezim

# ── Bundle UVM libraries ──────────────────────────────────────────
# UVM 1.2 (Accellera official)
RUN mkdir -p /uvm && \
    git clone --depth 1 https://github.com/accellera-official/uvm-core.git /uvm/uvm-1.2

# ── Install Python server dependencies ────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy server
COPY server.py .

# ── Environment ───────────────────────────────────────────────────
ENV XEZIM_BIN=/usr/local/bin/xezim
ENV UVM_12_SRC=/uvm/uvm-1.2/src

EXPOSE 8000

# ── Start FastAPI server ──────────────────────────────────────────
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
