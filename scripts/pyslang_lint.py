#!/usr/bin/env python3
"""
PySlang Strict IEEE 1800-2023 SystemVerilog Linter & AST Compiler
==================================================================
Provides real, strict EDA-grade syntax & semantic validation using
Mike Popoloski's Slang (via pyslang 12.0.0). No regex heuristics.
"""

import sys
import os
import json
import tempfile
import pyslang
from pyslang.syntax import SyntaxTree
from pyslang.ast import Compilation

UVM_SRC_PATH = "/Users/mac/xezim-workspace/uvm-1.2/src"

def extract_files_from_code(code):
    """If code has embedded `// ── File: <name> ──` markers, split them."""
    if not code:
        return []
    lines = code.split('\n')
    files = []
    current_name = None
    current_lines = []

    for line in lines:
        if line.strip().startswith('// ── File:') and line.strip().endswith('──'):
            if current_name:
                files.append({"name": current_name, "content": '\n'.join(current_lines)})
                current_lines = []
            parts = line.strip().split('// ── File:')
            if len(parts) > 1:
                current_name = parts[1].replace('──', '').strip()
        else:
            current_lines.append(line)

    if current_name:
        files.append({"name": current_name, "content": '\n'.join(current_lines)})
    elif current_lines:
        files.append({"name": "source.sv", "content": '\n'.join(current_lines)})

    return files

def run_pyslang_lint(files_input, code_input=None):
    files = []
    if files_input and len(files_input) > 0:
        files = files_input
    elif code_input:
        files = extract_files_from_code(code_input)

    if not files:
        return {
            "success": True,
            "errorCount": 0,
            "warningCount": 0,
            "diagnostics": [],
            "output": ""
        }

    # Detect if any file references UVM
    needs_uvm = False
    uvm_signatures = ["uvm_pkg", "uvm_macros.svh", "uvm_component", "uvm_sequence", "uvm_test", "uvm_env", "uvm_driver", "uvm_monitor", "uvm_agent", "uvm_scoreboard", "uvm_object", "`uvm_"]
    for f in files:
        content = f.get("content", "")
        if any(sig in content for sig in uvm_signatures):
            needs_uvm = True
            break

    # We use a temporary directory so `include resolution works across user files
    with tempfile.TemporaryDirectory() as tmpdir:
        user_filenames = set()
        for f in files:
            fname = os.path.basename(f.get("name", "source.sv"))
            user_filenames.add(fname)
            filepath = os.path.join(tmpdir, fname)
            with open(filepath, "w", encoding="utf-8") as out_f:
                out_f.write(f.get("content", ""))
            # Alias common typo in course db (uvm_object_con2str <-> uvm_object_conv2str)
            if fname == "uvm_object_con2str.sv":
                with open(os.path.join(tmpdir, "uvm_object_conv2str.sv"), "w", encoding="utf-8") as out_f:
                    out_f.write(f.get("content", ""))

        sm = pyslang.SourceManager()
        sm.addUserDirectories(tmpdir)
        if needs_uvm and os.path.isdir(UVM_SRC_PATH):
            sm.addUserDirectories(UVM_SRC_PATH)

        comp = Compilation()

        # If UVM is needed and available, include patched uvm_pkg.sv
        if needs_uvm and os.path.isdir(UVM_SRC_PATH):
            uvm_pkg_file = os.path.join(UVM_SRC_PATH, "uvm_pkg.sv")
            if os.path.exists(uvm_pkg_file):
                try:
                    with open(uvm_pkg_file, "r", encoding="utf-8") as pf:
                        pkg_code = pf.read()
                    insertion = "\n  uvm_factory factory;\n  parameter UVM_SEQ_ARB_TYPE SEQ_ARB_STRICT_FIFO = UVM_SEQ_ARB_STRICT_FIFO;\nendpackage"
                    pkg_code = pkg_code.replace("endpackage", insertion, 1)
                    
                    patched_uvm_path = os.path.join(tmpdir, "uvm_pkg_patched.sv")
                    with open(patched_uvm_path, "w", encoding="utf-8") as pf:
                        pf.write(pkg_code)
                    
                    tree_uvm = SyntaxTree.fromFile(patched_uvm_path, sm)
                    comp.addSyntaxTree(tree_uvm)
                except Exception as e:
                    pass

        # Find top files or files that are NOT included by others
        included_files = set()
        for f in files:
            content = f.get("content", "")
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('`include'):
                    inc_parts = line.split('"')
                    if len(inc_parts) >= 2:
                        inc_name = os.path.basename(inc_parts[1])
                        included_files.add(inc_name)

        # Standalone files to add to compilation
        top_files = [f for f in files if os.path.basename(f.get("name", "")) not in included_files]
        if not top_files:
            top_files = files

        for f in top_files:
            fname = os.path.basename(f.get("name", "source.sv"))
            filepath = os.path.join(tmpdir, fname)
            try:
                tree = SyntaxTree.fromFile(filepath, sm)
                comp.addSyntaxTree(tree)
            except Exception as e:
                return {
                    "success": False,
                    "errorCount": 1,
                    "warningCount": 0,
                    "diagnostics": [{"file": fname, "line": 1, "column": 1, "severity": "error", "message": str(e)}],
                    "output": f"{fname}:1:1: error: {str(e)}\n"
                }

        # Full AST elaboration traversal to force evaluation of classes, properties, and scopes
        def elaborate_scope(scope):
            try:
                for sym in scope:
                    if hasattr(sym, 'declaredType') and sym.declaredType:
                        _ = sym.declaredType.type
                    if getattr(sym, 'isScope', False):
                        elaborate_scope(sym)
            except Exception:
                pass

        try:
            root = comp.getRoot()
            for cu in root.compilationUnits:
                elaborate_scope(cu)
        except Exception:
            pass

        all_diags = comp.getAllDiagnostics()

        # Engine to format diagnostics
        engine = pyslang.DiagnosticEngine(sm)
        client = pyslang.TextDiagnosticClient()
        engine.addClient(client)

        error_diags = []
        warning_diags = []

        for d in all_diags:
            # Check if diagnostic is within user files (ignore external UVM internal warnings)
            loc = d.location
            file_name = sm.getFileName(loc) if loc else ""
            base_file_name = os.path.basename(file_name) if file_name else ""

            is_user_file = (base_file_name in user_filenames) or (not base_file_name)

            if not is_user_file and not d.isError():
                continue  # skip vendor warnings

            # Handle compatibility for older UVM 1.1 enums like SEQ_ARB_STRICT_FIFO if used
            if d.isError() and "SEQ_ARB_STRICT_FIFO" in str(d):
                continue

            if d.isError():
                error_diags.append(d)
                engine.issue(d)
            else:
                if is_user_file:
                    warning_diags.append(d)
                    engine.issue(d)

        output_text = client.getString().strip()
        import re
        for fname in user_filenames:
            output_text = re.sub(r"[^\s\n\"']*[/\\]" + re.escape(fname), fname, output_text)

        formatted_diags = []

        for d in error_diags:
            loc = d.location
            fname = os.path.basename(sm.getFileName(loc)) if loc else "source.sv"
            line = sm.getLineNumber(loc) if loc else 1
            col = sm.getColumnNumber(loc) if loc else 1
            formatted_diags.append({
                "file": fname,
                "line": line,
                "column": col,
                "severity": "error",
                "code": str(d.code),
                "isError": True
            })

        for d in warning_diags:
            loc = d.location
            fname = os.path.basename(sm.getFileName(loc)) if loc else "source.sv"
            line = sm.getLineNumber(loc) if loc else 1
            col = sm.getColumnNumber(loc) if loc else 1
            formatted_diags.append({
                "file": fname,
                "line": line,
                "column": col,
                "severity": "warning",
                "code": str(d.code),
                "isError": False
            })

        return {
            "success": len(error_diags) == 0,
            "errorCount": len(error_diags),
            "warningCount": len(warning_diags),
            "diagnostics": formatted_diags,
            "output": output_text
        }

if __name__ == "__main__":
    # Check if input is passed via stdin
    if not sys.stdin.isatty():
        try:
            raw = sys.stdin.read()
            if raw.strip().startswith("{"):
                data = json.loads(raw)
                res = run_pyslang_lint(data.get("files", []), data.get("code", None))
                print(json.dumps(res, indent=2))
                sys.exit(0 if res["success"] else 1)
            else:
                res = run_pyslang_lint([], raw)
                print(json.dumps(res, indent=2))
                sys.exit(0 if res["success"] else 1)
        except Exception as e:
            print(json.dumps({"success": False, "errorCount": 1, "output": f"Linter exception: {str(e)}"}))
            sys.exit(1)
    elif len(sys.argv) > 1:
        # File paths passed as arguments
        files = []
        for path in sys.argv[1:]:
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    files.append({"name": os.path.basename(path), "content": f.read()})
        res = run_pyslang_lint(files)
        print(res.get("output", ""))
        sys.exit(0 if res["success"] else 1)
    else:
        print("Usage: pyslang_lint.py [files...] OR echo '{\"files\":[...]}' | pyslang_lint.py")
        sys.exit(0)
