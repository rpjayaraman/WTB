#!/usr/bin/env python3
"""
UVM Course Digital Book Local Simulator Server
Provides zero-dependency HTTP server and simulation execution API.
Prioritizes Verilator 5.050 as primary engine, with Xezim as high-speed secondary engine.
"""

import http.server
import socketserver
import os
import sys
import json
import subprocess
import time
import shutil
import tempfile
import re
from urllib.parse import urlparse

PORT = 8080
VERILATOR_BIN = "/usr/local/bin/verilator"
XEZIM_BIN = os.path.expanduser("~/.cargo/bin/xezim")
UVM_SRC = os.path.expanduser("~/xezim-workspace/uvm-1.2/src")
PROJECT_ROOT = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
STATIC_DIR = os.path.abspath(os.path.dirname(__file__))

CACHE_DIR = os.path.join(PROJECT_ROOT, ".sim_workspace")
os.makedirs(CACHE_DIR, exist_ok=True)

def strip_sv_comments(code: str) -> str:
    if not code:
        return ""
    # Strip block comments /* ... */
    code = re.sub(r'/\*[\s\S]*?\*/', '', code)
    # Strip line comments // ...
    code = re.sub(r'//.*$', '', code, flags=re.MULTILINE)
    # Strip string literals "..." (handling escaped characters)
    code = re.sub(r'"(\\.|[^"\\])*"', '""', code)
    return code

def extract_modules(code: str) -> list:
    clean = strip_sv_comments(code)
    matches = re.findall(r'\bmodule\s+([a-zA-Z0-9_]+)\s*(\(|#|;)', clean)
    return [m[0] for m in matches if m[0] != "uvm_pkg"]

def extract_interfaces(code: str) -> list:
    clean = strip_sv_comments(code)
    matches = re.findall(r'(?<!\bvirtual\s)\binterface\s+([a-zA-Z0-9_]+)\s*(\(|#|;)', clean)
    return [m[0] for m in matches]

def extract_packages(code: str) -> list:
    clean = strip_sv_comments(code)
    matches = re.findall(r'\bpackage\s+([a-zA-Z0-9_]+)\s*;', clean)
    return [m for m in matches if m != "uvm_pkg"]

def is_compilable_unit(code: str) -> bool:
    return bool(extract_modules(code) or extract_interfaces(code) or extract_packages(code))


class SimulatorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.handle_status()
        elif parsed.path in ["", "/", "/index", "/index.htm"]:
            self.path = "/home.html"
            super().do_GET()
        elif parsed.path.startswith("/api/"):
            self.send_json({"error": "API route not found"}, status=404)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/simulate":
            self.handle_simulate()
        else:
            self.send_json({"error": "API route not found"}, status=404)

    def handle_status(self):
        self.send_json({
            "status": "online",
            "verilator": {
                "available": os.path.exists(VERILATOR_BIN),
                "path": VERILATOR_BIN,
                "version": "5.050 (Homebrew)"
            },
            "xezim": {
                "available": os.path.exists(XEZIM_BIN),
                "path": XEZIM_BIN,
                "version": "0.1.20"
            },
            "uvm_src": UVM_SRC,
            "port": PORT
        })

    def handle_simulate(self):
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len)
        
        try:
            data = json.loads(post_body.decode("utf-8"))
        except Exception as e:
            self.send_json({"error": f"Invalid JSON payload: {str(e)}"}, status=400)
            return

        files = data.get("files", {})
        engine = data.get("engine", "verilator").lower()
        top = data.get("top", "top")
        is_sv = data.get("is_sv", False)
        active_file = data.get("active_file", "")
        plusargs = data.get("plusargs", [])
        if isinstance(plusargs, str):
            plusargs = [p.strip() for p in plusargs.split() if p.strip()]

        if not files:
            self.send_json({"error": "No files provided for simulation"}, status=400)
            return

        # Prepare dedicated workspace run directory
        run_id = f"run_{int(time.time()*1000)}"
        run_dir = os.path.join(CACHE_DIR, run_id)
        os.makedirs(run_dir, exist_ok=True)

        # Pre-seed obj_dir from project cache using macOS APFS clone (instantaneous)
        # Only for UVM simulations where base obj_dir matches
        base_obj_dir = os.path.join(PROJECT_ROOT, "obj_dir")
        if not is_sv and os.path.exists(base_obj_dir):
            try:
                # 'cp -cR' uses APFS copy-on-write clone on macOS for instant link
                subprocess.run(["cp", "-cR", base_obj_dir, os.path.join(run_dir, "obj_dir")], check=False)
            except Exception:
                pass

        file_paths = []
        subdirs = set()
        for fname in files.keys():
            dirname = os.path.dirname(fname)
            if dirname:
                subdirs.add(dirname)

        for fname, fcontent in files.items():
            base_name = os.path.basename(fname)
            # Write to root
            with open(os.path.join(run_dir, base_name), "w", encoding="utf-8") as fp:
                fp.write(fcontent)
            
            # Write to original relative path
            orig_p = os.path.join(run_dir, fname)
            os.makedirs(os.path.dirname(orig_p), exist_ok=True)
            with open(orig_p, "w", encoding="utf-8") as fp:
                fp.write(fcontent)
            
            # Write to all subdirs for include resolution
            for sd in subdirs:
                sd_p = os.path.join(run_dir, sd, base_name)
                os.makedirs(os.path.dirname(sd_p), exist_ok=True)
                with open(sd_p, "w", encoding="utf-8") as fp:
                    fp.write(fcontent)

            # Extra include aliases for .pkg and .incl extensions
            if base_name.endswith(".pkg") or base_name.endswith(".incl"):
                with open(os.path.join(run_dir, base_name + ".sv"), "w", encoding="utf-8") as fp:
                    fp.write(fcontent)
                for sd in subdirs:
                    sd_p = os.path.join(run_dir, sd, base_name + ".sv")
                    os.makedirs(os.path.dirname(sd_p), exist_ok=True)
                    with open(sd_p, "w", encoding="utf-8") as fp:
                        fp.write(fcontent)



            if fname.endswith(".sv") or fname.endswith(".v"):
                file_paths.append(fname)



        # Sort file paths so packages and interfaces precede modules
        file_paths.sort(key=lambda x: (
            0 if "pkg" in x.lower() else
            1 if "if" in x.lower() else
            2 if "trans" in x.lower() else
            3 if "seq" in x.lower() else
            4 if "driver" in x.lower() or "monitor" in x.lower() else
            5 if "agent" in x.lower() or "env" in x.lower() else
            6 if "test" in x.lower() else
            7 if "top" in x.lower() or "tb" in x.lower() else 5
        ))

        # Detect files that are `include'd by other files in this project (excluding comments)
        included_files = set()
        for fname, fcontent in files.items():
            # Strip comments only so string literals in `include "file"` are preserved
            clean_code = re.sub(r'/\*[\s\S]*?\*/', '', fcontent)
            clean_code = re.sub(r'//.*$', '', clean_code, flags=re.MULTILINE)
            for inc in re.findall(r'`include\s+["<]([^">]+)[">]', clean_code):
                included_files.add(os.path.basename(inc))

        # Filter compilation_files: compile non-included source files
        compilation_files = [f for f in file_paths if os.path.basename(f) not in included_files]
        
        # Filter to only files declaring module, interface, or program
        module_comp_files = []
        for cf in compilation_files:
            code = files.get(cf, "")
            clean = re.sub(r'/\*[\s\S]*?\*/', '', code)
            clean = re.sub(r'//.*$', '', clean, flags=re.MULTILINE)
            if re.search(r'\b(module|interface|program)\s+[a-zA-Z0-9_]+', clean):
                module_comp_files.append(cf)
        
        if module_comp_files:
            compilation_files = module_comp_files

        if active_file and active_file in files and os.path.basename(active_file) not in included_files and active_file not in compilation_files:
            compilation_files.append(active_file)
        if not compilation_files:
            compilation_files = file_paths

        compilation_files.sort(key=lambda x: (
            0 if "dut" in x.lower() else
            1 if ("hdl" in x.lower() or "top" in x.lower()) and "tb" not in os.path.basename(x).lower() else
            2 if "tb" in x.lower() or "test" in x.lower() else
            1
        ))

        print("DEBUG INCLUDED_FILES:", sorted(list(included_files)))
        print("DEBUG COMPILATION_FILES:", compilation_files)



        # Auto-detect top module from files
        modules_found = []
        active_mods = extract_modules(files.get(active_file, ""))

        for fname, fcontent in files.items():
            for m in extract_modules(fcontent):
                if m not in modules_found:
                    modules_found.append(m)

        top_candidates = [m for m in modules_found if m in ["wb_env_top_mod", "top", "tb_top", "wb_conmax_tb_top", "simple_ral_env_top"] or m.endswith(("_top_mod", "_tb_top", "_top"))]
        if top_candidates:
            top = top_candidates[0]
        elif "top" in active_mods:
            top = "top"
        elif active_mods and active_mods[-1] not in ["wb_env_tb_mod"]:
            top = active_mods[-1]
        elif modules_found:
            top = modules_found[-1]
        else:
            # No module was found in design (e.g. class-only verification IP libraries)
            # Create a synthetic top module harness to allow clean elaboration and simulation
            top = "top"
            auto_top_file = "_sim_top.sv"
            if is_sv:
                auto_top_code = (
                    "`timescale 1ns/1ps\n"
                    "module top;\n"
                    "  initial begin\n"
                    "    $display(\"SystemVerilog subsystem verification environment loaded successfully.\");\n"
                    "    $finish;\n"
                    "  end\n"
                    "endmodule\n"
                )
            else:
                auto_top_code = (
                    "`timescale 1ns/1ps\n"
                    "`include \"uvm_macros.svh\"\n"
                    "module top;\n"
                    "  import uvm_pkg::*;\n"
                    "  initial begin\n"
                    "    `uvm_info(\"UVM_TOP\", \"UVM verification component library loaded successfully.\", UVM_LOW);\n"
                    "    $display(\"Simulation finished successfully.\");\n"
                    "    $finish;\n"
                    "  end\n"
                    "endmodule\n"
                )
            auto_top_path = os.path.join(run_dir, auto_top_file)
            with open(auto_top_path, "w", encoding="utf-8") as fp:
                fp.write(auto_top_code)
            compilation_files.append(auto_top_file)

        # Auto-inject +UVM_TESTNAME if run_test() is called without argument in top module
        has_testname = any("UVM_TESTNAME" in p for p in plusargs)
        if not has_testname:
            for fname, fcontent in files.items():
                clean_content = strip_sv_comments(fcontent)
                test_classes = re.findall(r'\bclass\s+([a-zA-Z0-9_]+)\s+extends\s+uvm_test\b', clean_content)
                if test_classes:
                    plusargs.append(f"+UVM_TESTNAME={test_classes[-1]}")
                    break


        if engine == "xezim":
            result = self.run_xezim(run_dir, compilation_files, plusargs, is_sv)
        else:
            result = self.run_verilator(run_dir, compilation_files, top, plusargs, is_sv)

        self.send_json(result)

    def get_inc_flags(self, run_dir, is_sv=False):
        abs_run_dir = os.path.abspath(run_dir)
        inc_flags = ["-I.", f"-I{abs_run_dir}"]
        if not is_sv:
            inc_flags.append(f"-I{UVM_SRC}")
        for root, dirs, _ in os.walk(abs_run_dir):
            inc_flags.append(f"-I{root}")
        for sub in ["tests", "include", "src", "hdl", "env", "sequences"]:
            sub_p = os.path.join(abs_run_dir, sub)
            inc_flags.append(f"-I{sub_p}")
            inc_flags.append(f"-I{sub}")
        return list(dict.fromkeys(inc_flags))



    def run_verilator(self, run_dir, compilation_files, top, plusargs, is_sv=False):
        start_time = time.time()
        uvm_pkg = os.path.join(UVM_SRC, "uvm_pkg.sv")
        inc_flags = self.get_inc_flags(run_dir, is_sv)
        
        if is_sv:
            cmd_compile = [
                VERILATOR_BIN,
                "--binary",
                "--timing",
                "-Wno-fatal",
                "-Wno-WIDTH",
                "-Wno-STMTDLY",
                "-Wno-IMPLICIT",
                "-Wno-MODDUP",
                "-Wno-PINMISSING",
                "-Wno-CASEINCOMPLETE",
                "-Wno-TIMESCALEMOD",
                "-Wno-CASTCONST",
                "-Wno-IMPLICITSTATIC",
                "+libext+.pkg+.sv+.svh+.v+.incl"
            ] + inc_flags + compilation_files + [
                "--top-module", top,
                "-j", "4"
            ]
            cli_str = f"verilator --binary --timing -Wno-fatal +libext+.pkg+.sv+.svh+.v+.incl {' '.join(inc_flags)} {' '.join(compilation_files)} --top-module {top} -j 4 && ./obj_dir/V{top} {' '.join(plusargs)}"
        else:
            cmd_compile = [
                VERILATOR_BIN,
                "--binary",
                "--timing",
                "-Wno-fatal",
                "-Wno-WIDTH",
                "-Wno-STMTDLY",
                "-Wno-IMPLICIT",
                "-Wno-MODDUP",
                "-Wno-PINMISSING",
                "-Wno-CASEINCOMPLETE",
                "-Wno-TIMESCALEMOD",
                "-Wno-CASTCONST",
                "-Wno-IMPLICITSTATIC",
                "-Wno-COVERIGN",
                "-Wno-DECLFILENAME",
                "+libext+.pkg+.sv+.svh+.v+.incl",
                "+define+UVM_NO_DPI"

            ] + inc_flags + [
                uvm_pkg
            ] + compilation_files + [
                "--top-module", top,
                "-j", "4"
            ]
            cli_str = f"verilator --binary --timing -Wno-fatal -Wno-WIDTH -Wno-STMTDLY +libext+.pkg+.sv+.svh+.v+.incl +define+UVM_NO_DPI {' '.join(inc_flags)} {uvm_pkg} {' '.join(compilation_files)} --top-module {top} -j 4 && ./obj_dir/V{top} {' '.join(plusargs)}"


        try:
            compile_proc = subprocess.run(
                cmd_compile,
                cwd=run_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=180
            )
            compile_time = time.time() - start_time
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "engine": "verilator",
                "cli": cli_str,
                "error": "Verilator compilation timed out (> 120s).",
                "compile_time_ms": 120000,
                "sim_time_ms": 0,
                "stdout": "",
                "stderr": "Compilation timeout."
            }
        except Exception as e:
            return {
                "success": False,
                "engine": "verilator",
                "cli": cli_str,
                "error": f"Failed to execute Verilator: {str(e)}",
                "compile_time_ms": 0,
                "sim_time_ms": 0,
                "stdout": "",
                "stderr": str(e)
            }

        if compile_proc.returncode != 0:
            return {
                "success": False,
                "engine": "verilator",
                "cli": cli_str,
                "compile_time_ms": int(compile_time * 1000),
                "sim_time_ms": 0,
                "stdout": compile_proc.stdout,
                "stderr": compile_proc.stderr,
                "exit_code": compile_proc.returncode,
                "error": "Verilator compilation failed. See stderr output."
            }

        # Run the binary
        binary_path = os.path.join(run_dir, "obj_dir", f"V{top}")
        if not os.path.exists(binary_path):
            for f in os.listdir(os.path.join(run_dir, "obj_dir")):
                cand = os.path.join(run_dir, "obj_dir", f)
                if os.access(cand, os.X_OK) and not f.endswith(".o") and not f.endswith(".a") and not f.endswith(".d"):
                    binary_path = cand
                    break

        sim_start = time.time()
        try:
            sim_cmd = [binary_path] + plusargs
            sim_proc = subprocess.run(
                sim_cmd,
                cwd=run_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=25
            )
            sim_time = time.time() - sim_start
            
            vcd_found = None
            for root, _, fnames in os.walk(run_dir):
                for fn in fnames:
                    if fn.endswith(".vcd") or fn.endswith(".fst"):
                        vcd_found = fn
                        break

            return {
                "success": sim_proc.returncode == 0,
                "engine": "verilator",
                "cli": cli_str,
                "compile_time_ms": int(compile_time * 1000),
                "sim_time_ms": int(sim_time * 1000),
                "total_time_ms": int((compile_time + sim_time) * 1000),
                "stdout": sim_proc.stdout,
                "stderr": sim_proc.stderr,
                "compile_stdout": compile_proc.stdout,
                "compile_stderr": compile_proc.stderr,
                "exit_code": sim_proc.returncode,
                "waveform": vcd_found
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "engine": "verilator",
                "cli": cli_str,
                "compile_time_ms": int(compile_time * 1000),
                "sim_time_ms": 25000,
                "stdout": "Simulation timed out (> 25s). Possible infinite loop in testbench.",
                "stderr": "Timeout expired.",
                "exit_code": -1
            }
        except Exception as e:
            return {
                "success": False,
                "engine": "verilator",
                "cli": cli_str,
                "compile_time_ms": int(compile_time * 1000),
                "sim_time_ms": 0,
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1
            }

    def run_xezim(self, run_dir, file_paths, plusargs, is_sv=False):
        start_time = time.time()
        uvm_pkg = os.path.join(UVM_SRC, "uvm_pkg.sv")
        inc_flags = self.get_inc_flags(run_dir, is_sv)

        if is_sv:
            cmd = [XEZIM_BIN] + inc_flags + file_paths + plusargs
            cli_str = f"xezim {' '.join(inc_flags)} {' '.join(file_paths)} {' '.join(plusargs)}"
        else:
            cmd = [XEZIM_BIN] + inc_flags + [uvm_pkg] + file_paths + plusargs
            cli_str = f"xezim {' '.join(inc_flags)} {uvm_pkg} {' '.join(file_paths)} {' '.join(plusargs)}"


        try:
            proc = subprocess.run(
                cmd,
                cwd=run_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30
            )
            elapsed = time.time() - start_time
            return {
                "success": proc.returncode == 0,
                "engine": "xezim",
                "cli": cli_str,
                "compile_time_ms": 0,
                "sim_time_ms": int(elapsed * 1000),
                "total_time_ms": int(elapsed * 1000),
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "exit_code": proc.returncode
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "engine": "xezim",
                "cli": cli_str,
                "compile_time_ms": 0,
                "sim_time_ms": 30000,
                "stdout": "Xezim simulation timed out (> 30s).",
                "stderr": "Timeout expired.",
                "exit_code": -1
            }
        except Exception as e:
            return {
                "success": False,
                "engine": "xezim",
                "cli": cli_str,
                "compile_time_ms": 0,
                "sim_time_ms": 0,
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1
            }

def run_server(port=PORT):
    # Allow port override from args
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    handler = SimulatorHandler
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", port), handler) as httpd:
        print("=" * 65)
        print("⚡ UVM INTERACTIVE DIGITAL BOOK & SIMULATION SERVER")
        print("=" * 65)
        print(f"📖 Digital Book URL:   http://localhost:{port}/index.html")
        print(f"⚙️  Primary Engine:    Verilator 5.050 ({VERILATOR_BIN})")
        print(f"🚀 Secondary Engine:  Xezim ({XEZIM_BIN})")
        print(f"📚 UVM Source Path:   {UVM_SRC}")
        print("=" * 65)
        print("Press Ctrl+C to stop the server.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    run_server()
