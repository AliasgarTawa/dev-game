"""Loopback receiver for canvas captures: POST {name, dataUrl} JSON to http://127.0.0.1:17098/ (port = 2nd argument) .
Writes <out_dir>/<name>.png. Used because pane screenshots can be stale under viewport emulation."""
import base64, json, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', 'content-type')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        name = '/'.join(re.sub(r'[^\w.-]', '_', part) for part in body['name'].split('/') if part not in ('', '.', '..'))
        data = base64.b64decode(body['dataUrl'].split(',', 1)[1])
        sub = OUT / Path(name).with_suffix('.png')
        sub.parent.mkdir(parents=True, exist_ok=True); sub.write_bytes(data)
        self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(str(sub).encode())
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2]) if len(sys.argv) > 2 else 17098), H).serve_forever()
