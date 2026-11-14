"""Run the bundled Dune Rush demo. Requires only Python 3.10 or newer."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path == '/':
            self.send_response(302)
            self.send_header('Location', '/worlds-opening/')
            self.end_headers()
            return
        super().do_GET()

    def translate_path(self, path):
        parts = Path(unquote(urlsplit(path).path)).parts[1:]
        if any(p.startswith('.') for p in parts):
            return str(ROOT / '__not_found__')
        # Keep earlier preview URLs usable without a sibling checkout.
        if parts and parts[0] == 'dev-game':
            parts = parts[1:]
            if not parts or parts == ('index.html',):
                parts = ('bike-game.html',)
        candidate = (ROOT / Path(*parts)).resolve()
        if not candidate.is_relative_to(ROOT):
            return str(ROOT / '__not_found__')
        return str(candidate)


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=17012)
    args = parser.parse_args()
    for name in ('fantasy-desert-v4-tile.ply', 'fantasy-worlds-roots-day-tile.ply',
                 'fantasy-worlds-roots-night-tile.ply', 'worlds-models/desert-rigged.glb'):
        path = ROOT / name
        if not path.is_file():
            parser.exit(1, f'Missing {name}. Download the complete release ZIP or run git lfs pull.\n')
        with path.open('rb') as file:
            if file.read(80).startswith(b'version https://git-lfs.github.com/spec/v1'):
                parser.exit(1, 'Assets are Git LFS pointers. Run git lfs pull, or download the ready-to-play release ZIP.\n')
    try:
        server = Server(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT)))
    except OSError as error:
        parser.exit(1, f'Could not start on port {args.port}: {error}\nTry: python3 serve.py --port 17015\n')
    print(f'Dune Rush: http://127.0.0.1:{args.port}/worlds-opening/', flush=True)
    print('Press Ctrl+C to stop the server.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
