#!/usr/bin/env python3
"""
Production EDA Development & Simulation Server with PySlang IEEE-1800 Lint API
================================================================================
Serves static frontend assets with COOP/COEP headers and provides a live
PySlang AST verification endpoint at `/api/pyslang_lint`.
"""

import sys
import os
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Import PySlang lint runner
sys.path.insert(0, os.path.dirname(__file__))
try:
    from pyslang_lint import run_pyslang_lint
    PYSLANG_AVAILABLE = True
except Exception as e:
    PYSLANG_AVAILABLE = False
    print(f"Warning: Failed to import pyslang_lint: {e}")

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8089
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

class EDAServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        # Enable Cross-Origin Isolation for WASM SharedArrayBuffer & Performance
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            resp = json.dumps({"status": "ok", "pyslang": PYSLANG_AVAILABLE, "version": "12.0.0"})
            self.wfile.write(resp.encode('utf-8'))
            return
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/pyslang_lint':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                files = data.get('files', [])
                code = data.get('code', None)

                if PYSLANG_AVAILABLE:
                    result = run_pyslang_lint(files, code)
                else:
                    result = {
                        "success": False,
                        "errorCount": 1,
                        "warningCount": 0,
                        "diagnostics": [{"message": "PySlang not installed on server"}],
                        "output": "PySlang compiler engine not available on host."
                    }

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))
            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                err_resp = json.dumps({"success": False, "error": str(ex), "output": f"Server lint error: {str(ex)}"})
                self.wfile.write(err_resp.encode('utf-8'))
            return

        self.send_error(404, "Endpoint not found")

def run(port=PORT):
    server_address = ('', port)
    httpd = HTTPServer(server_address, EDAServerHandler)
    print(f"⚡ EDA Production Server running at http://localhost:{port}/ (Root: {ROOT_DIR})")
    print(f"⚡ Strict PySlang IEEE-1800 Lint API available at http://localhost:{port}/api/pyslang_lint")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == '__main__':
    run()
