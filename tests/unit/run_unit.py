#!/usr/bin/env python3
"""Run the browser unit tests headlessly and report a pass/fail exit code.

The app is plain ES modules with no build step, so a browser *is* the runtime:
this serves the repository, opens tests/unit/index.html in headless Firefox,
and waits for the page to POST its results back.

    python3 tests/unit/run_unit.py [--browser firefox] [--port 8931] [--keep-open]
"""
import argparse
import http.server
import json
import pathlib
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading

ROOT = pathlib.Path(__file__).resolve().parents[2]
RESULTS_PATH = "/__results__"

received = threading.Event()
payload = {"results": None}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path != RESULTS_PATH:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        payload["results"] = json.loads(self.rfile.read(length).decode())
        self.send_response(204)
        self.end_headers()
        received.set()

    def log_message(self, *args):
        pass  # keep the test output readable


def find_browser(preferred=None):
    for name in ([preferred] if preferred else []) + ["firefox", "firefox-esr", "chromium", "google-chrome"]:
        if name and shutil.which(name):
            return shutil.which(name)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser")
    ap.add_argument("--port", type=int, default=8931)
    ap.add_argument("--timeout", type=int, default=90)
    args = ap.parse_args()

    browser = find_browser(args.browser)
    if not browser:
        print("unit: no browser found (install firefox or chromium)", file=sys.stderr)
        return 2

    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    url = f"http://127.0.0.1:{args.port}/tests/unit/index.html"
    with tempfile.TemporaryDirectory() as profile:
        if "chrom" in browser:
            cmd = [browser, "--headless=new", f"--user-data-dir={profile}",
                   "--no-sandbox", "--disable-gpu", url]
        else:
            cmd = [browser, "--headless", "--no-remote", "--profile", profile, url]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        got = received.wait(args.timeout)
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()

    server.shutdown()

    if not got:
        print(f"unit: no results after {args.timeout}s — the test page probably "
              f"failed to load ({url})", file=sys.stderr)
        return 2

    results = payload["results"]
    failed = [r for r in results if not r["ok"]]
    for r in failed:
        print(f"  FAIL  {r['name']}\n        {r.get('error', '')}")
    print(f"unit: {len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
