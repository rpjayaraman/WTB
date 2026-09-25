#!/usr/bin/env python3
"""
OpenTitan & UVM Verification Dev Server
Provides:
  - Static HTTP file serving (OpenTitan IDE, presets, assets)
  - POST /api/simulate: Native execution via Xezim (IEEE 1800 SystemVerilog + UVM 1.2) or Verilator
  - POST /api/lint: Fast syntax / lint checking
  - GET  /api/status: Health & tool availability check
"""

import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

PORT = 8000
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
XEZIM_BIN = "/Users/mac/xezim-workspace/xezim/target/release/xezim"
UVM_SRC   = "/Users/mac/xezim-workspace/uvm-1.2/src"

class DevServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WORKSPACE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status = {
                "status": "online",
                "xezim_available": os.path.isfile(XEZIM_BIN) and os.access(XEZIM_BIN, os.X_OK),
                "xezim_path": XEZIM_BIN,
                "uvm_available": os.path.isdir(UVM_SRC),
                "uvm_path": UVM_SRC,
                "verilator_available": shutil.which("verilator") is not None,
                "server_time": time.time()
            }
            self.wfile.write(json.dumps(status, indent=2).encode("utf-8"))
            return

        # Fallback to standard static file server
        super().do_GET()

    def do_POST(self):
        if self.path in ("/api/simulate", "/simulate"):
            self.handle_simulate()
        elif self.path in ("/api/lint", "/lint"):
            self.handle_lint()
        else:
            self.send_error(404, f"API endpoint {self.path} not found")

    def handle_simulate(self):
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len)
        try:
            req = json.loads(post_body.decode("utf-8"))
        except Exception as e:
            self.send_json_error(400, f"Invalid JSON payload: {e}")
            return

        files = req.get("files", [])
        engine = req.get("engine", "xezim")
        top_module = req.get("top", "tb")
        custom_cmd = req.get("command", "")

        # Auto-detect top module if needed
        all_modules = []
        for f in files:
            matches = re.findall(r'\bmodule\s+([a-zA-Z0-9_]+)', f.get("content", ""))
            all_modules.extend(matches)
        if top_module not in all_modules and all_modules:
            tb_mods = [m for m in all_modules if m.startswith("tb") or m.endswith("_top")]
            if tb_mods:
                top_module = tb_mods[-1]
            else:
                top_module = all_modules[-1]

        tmp_dir = tempfile.mkdtemp(prefix="opentitan_sim_")
        t0 = time.time()
        try:
            # 1. Write all source files
            file_names = []
            for f in files:
                fname = os.path.basename(f.get("name", "source.sv"))
                fpath = os.path.join(tmp_dir, fname)
                with open(fpath, "w", encoding="utf-8") as fp:
                    fp.write(f.get("content", ""))
                file_names.append(fname)

            # 2. Build compile command
            cmd = []
            if custom_cmd and custom_cmd.strip():
                # If the user provided a full custom CLI command string:
                tokens = custom_cmd.strip().split()
                # Replace executable if needed
                if tokens[0] in ["xezim", "./xezim"]:
                    tokens[0] = XEZIM_BIN
                cmd = tokens
            else:
                if engine == "verilator":
                    cmd = ["verilator", "--binary", "-j", "0", "-Wall", "-Wno-fatal",
                           f"--top-module", top_module] + [f for f in file_names if f.endswith(".sv") or f.endswith(".v")]
                else: # default: xezim
                    cmd = [
                        XEZIM_BIN,
                        "--simulate",
                        "-s", top_module,
                        "-DUVM_NO_DPI",
                        f"+incdir+{UVM_SRC}",
                        "+incdir+.",
                        os.path.join(UVM_SRC, "uvm_pkg.sv")
                    ]
                    # Detect which files are included by other files via `include "filename"
                    included_files = set()
                    include_re = re.compile(r'`include\s*["<]([^">]+)[">]')
                    for f in files:
                        for match in include_re.findall(f.get("content", "")):
                            included_files.add(os.path.basename(match))

                    # Separate headers and packages from interface/module files
                    packages = []
                    interfaces = []
                    modules = []
                    for f in file_names:
                        if f.endswith(".svh") or f in included_files:
                            continue
                        elif "pkg" in f:
                            packages.append(f)
                        elif "if" in f:
                            interfaces.append(f)
                        else:
                            modules.append(f)

                    # Ensure base packages come before env packages
                    def pkg_sort_key(name):
                        if "tlul" in name: return 0
                        if "reg" in name: return 1
                        if "base" in name: return 2
                        if "agent" in name: return 3
                        if "env" in name: return 4
                        return 5
                    packages.sort(key=pkg_sort_key)

                    # Top module file should come last
                    top_file = f"{top_module}.sv"
                    for m in list(modules):
                        if m == top_file or m.startswith("tb") or m.endswith("_top.sv"):
                            modules.remove(m)
                            modules.append(m)

                    cmd += packages + interfaces + modules

            # 3. Execute process
            proc = subprocess.run(
                cmd,
                cwd=tmp_dir,
                capture_output=True,
                text=True,
                timeout=90
            )
            elapsed_ms = int((time.time() - t0) * 1000)

            # 4. Check for VCD waveform
            vcd_content = None
            vcd_path = os.path.join(tmp_dir, "wave.vcd")
            if os.path.isfile(vcd_path):
                try:
                    with open(vcd_path, "r", encoding="utf-8", errors="replace") as vfp:
                        vcd_content = vfp.read(10 * 1024 * 1024) # Up to 10MB
                except Exception:
                    pass

            resp = {
                "success": proc.returncode == 0,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "command": " ".join(cmd),
                "elapsed_ms": elapsed_ms,
                "engine": engine,
                "has_vcd": vcd_content is not None,
                "vcd": vcd_content
            }

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode("utf-8"))

        except subprocess.TimeoutExpired:
            self.send_json_error(504, "Simulation timed out after 90 seconds")
        except Exception as ex:
            self.send_json_error(500, f"Execution failed: {str(ex)}")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def handle_lint(self):
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len)
        try:
            req = json.loads(post_body.decode("utf-8"))
        except Exception as e:
            self.send_json_error(400, f"Invalid JSON payload: {e}")
            return

        if "code" in req:
            code = req["code"]
            command = req.get("command", "verilator --lint-only -Wall --timing -sv $FILE")
            tmp_dir = tempfile.mkdtemp(prefix="wtb_lint_")
            try:
                src_path = os.path.join(tmp_dir, "scratch.sv")
                if not code.endswith("\n"):
                    code += "\n"
                with open(src_path, "w", encoding="utf-8") as fp:
                    fp.write(code)

                import shlex
                raw_args = shlex.split(command)
                cmd_args = []
                for arg in raw_args:
                    if arg == "$FILE":
                        cmd_args.append(src_path)
                    else:
                        cmd_args.append(arg)
                if src_path not in cmd_args:
                    cmd_args.append(src_path)

                if "verilator" in cmd_args[0]:
                    if "-Wno-DECLFILENAME" not in cmd_args:
                        cmd_args.append("-Wno-DECLFILENAME")
                    if "-Wno-EOFNEWLINE" not in cmd_args:
                        cmd_args.append("-Wno-EOFNEWLINE")
                    if "-Wno-fatal" not in cmd_args:
                        cmd_args.append("-Wno-fatal")

                proc = subprocess.run(
                    cmd_args,
                    cwd=tmp_dir,
                    capture_output=True,
                    text=True,
                    timeout=45
                )
                stdout = proc.stdout
                stderr = proc.stderr
                exit_code = proc.returncode

                # If verilator --binary produced an executable, execute it to run the simulation!
                if "verilator" in cmd_args[0] and "--binary" in cmd_args and exit_code == 0:
                    obj_dir = os.path.join(tmp_dir, "obj_dir")
                    if os.path.isdir(obj_dir):
                        for f in os.listdir(obj_dir):
                            fpath = os.path.join(obj_dir, f)
                            if os.path.isfile(fpath) and os.access(fpath, os.X_OK) and not f.endswith(".o") and not f.endswith(".a"):
                                sim_res = subprocess.run([fpath], cwd=tmp_dir, capture_output=True, text=True, timeout=30)
                                stdout += ("\n" + sim_res.stdout if sim_res.stdout else "")
                                stderr += ("\n" + sim_res.stderr if sim_res.stderr else "")
                                exit_code = sim_res.returncode
                                break

                # Check for VCD waveform
                vcd_content = None
                for fname in os.listdir(tmp_dir):
                    if fname.endswith(".vcd"):
                        try:
                            with open(os.path.join(tmp_dir, fname), "r", errors="replace") as vfp:
                                vcd_content = vfp.read(10 * 1024 * 1024)
                            break
                        except Exception:
                            pass

                resp = {
                    "success": exit_code == 0,
                    "exit_code": exit_code,
                    "stdout": stdout,
                    "stderr": stderr,
                    "output": (stdout + "\n" + stderr).strip(),
                    "vcd_text": vcd_content
                }
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(resp).encode("utf-8"))
                return
            except Exception as ex:
                self.send_json_error(500, f"Execution failed: {str(ex)}")
                return
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

        files = req.get("files", [])
        top_module = req.get("top", "tb")

        tmp_dir = tempfile.mkdtemp(prefix="opentitan_lint_")
        try:
            file_names = []
            for f in files:
                fname = os.path.basename(f.get("name", "source.sv"))
                fpath = os.path.join(tmp_dir, fname)
                with open(fpath, "w", encoding="utf-8") as fp:
                    fp.write(f.get("content", ""))
                file_names.append(fname)

            cmd = ["verilator", "--lint-only", "-Wall", "-Wno-fatal"]
            if shutil.which("verilator"):
                proc = subprocess.run(
                    cmd + [f for f in file_names if f.endswith(".sv") or f.endswith(".v")],
                    cwd=tmp_dir,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                output = (proc.stdout + "\n" + proc.stderr).strip()
            else:
                output = "Verilator not found on server host."

            resp = {
                "success": True,
                "output": output
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode("utf-8"))
        except Exception as ex:
            self.send_json_error(500, f"Lint failed: {str(ex)}")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def send_json_error(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"success": False, "error": message}).encode("utf-8"))

def main():
    port = PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    server_address = ("", port)
    httpd = http.server.HTTPServer(server_address, DevServerHandler)
    print(f"🚀 OpenTitan Full-Stack DV Server running at http://localhost:{port}/")
    print(f"   Native Simulator: {XEZIM_BIN}")
    print(f"   Accellera UVM:    {UVM_SRC}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == "__main__":
    main()
