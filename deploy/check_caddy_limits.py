"""Does the front door (Caddy) let through what it must and refuse what it must - with the real Caddyfile?

    python deploy/check_caddy_limits.py --caddy /path/to/caddy [--caddyfile deploy/shared/Caddyfile]

It starts two tiny servers that stand for the API and for the admin panel (they read the whole body and say how much arrived), starts
Caddy with the Caddyfile you name - only the certificate and the two addresses behind it are replaced, every line about limits and
paths is the real one - and sends bodies of different sizes to different paths:

  * a sheet of contacts (up to 200 MB) and a recording (up to 120 MB) must get through, by the API's own path and by the panel's;
  * anything else (a small JSON document) is refused above 2 MB, and so is a path that only looks like those two.

Why it exists: a limit written for one path can silently be overruled by a limit written for the whole site (the two are applied one
after the other and the smaller one wins), and `caddy validate` cannot see that. It has to be tried.
"""

from __future__ import annotations

import argparse
import http.client
import http.server
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

MB = 1_000_000  # (Caddy's "2MB" is two million bytes)


# ------------------------------------------------------------------------------------------------ what stands behind Caddy
class Upstream(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # silence
        pass

    def _reply(self, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._reply({"upstream": self.server.label, "path": self.path})  # type: ignore[attr-defined]

    def do_POST(self) -> None:
        left, got = int(self.headers.get("content-length") or 0), 0
        try:
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                got, left = got + len(chunk), left - len(chunk)
            self._reply({"upstream": self.server.label, "path": self.path, "bytes": got, "complete": left == 0})  # type: ignore[attr-defined]
        except OSError:  # Caddy cut the body short (the limit) - that is the case being tested
            self.close_connection = True


class QuietServer(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address) -> None:  # Caddy drops the connection when it refuses a body: that is expected here
        pass


def start_upstream(label: str) -> tuple[http.server.ThreadingHTTPServer, int]:
    server = QuietServer(("127.0.0.1", 0), Upstream)
    server.daemon_threads = True
    server.label = label  # type: ignore[attr-defined]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


# ------------------------------------------------------------------------------------------------ Caddy with the real Caddyfile
def local_copy_of(caddyfile: str, *, api_port: int, admin_port: int, cert: Path, key: Path) -> str:
    """The real Caddyfile with the certificate and the two upstream addresses swapped; nothing about limits or paths is touched."""
    text = caddyfile.replace("api:8000", f"127.0.0.1:{api_port}").replace("admin:3000", f"127.0.0.1:{admin_port}")
    text = re.sub(r"^\s*tls\s+\S+\s+\S+\s*$\n?", "", text, flags=re.M)  # (the real certificate is not here; the test has its own)
    needs_off = not re.search(r"^\s*auto_https\s+off", text, flags=re.M)
    out, depth, global_done, site_done = [], 0, False, False
    for line in text.split("\n"):
        out.append(line)
        if depth == 0 and line.strip() == "{" and not global_done:  # global options: no admin endpoint, no automatic certificates
            out.extend(["\tadmin off"] + (["\tauto_https off"] if needs_off else []))
            global_done = True
        elif depth == 0 and not site_done and re.match(r"^\S.*\{\s*$", line):  # the site: our certificate, and only on this machine
            out.extend([f"\ttls {cert.as_posix()} {key.as_posix()}", "\tbind 127.0.0.1"])
            site_done = True
        depth += line.count("{") - line.count("}")
    return "\n".join(out)


def make_certificate(folder: Path) -> tuple[Path, Path]:
    cert, key = folder / "cert.pem", folder / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )
    return cert, key


# ------------------------------------------------------------------------------------------------ the client
class Zeros:
    """A body of `size` zero bytes that is never held in memory."""

    def __init__(self, size: int) -> None:
        self.left = size

    def read(self, n: int = -1) -> bytes:
        n = self.left if n is None or n < 0 else min(n, self.left)
        self.left -= n
        return b"\0" * n


def send(port: int, method: str, path: str, size: int = 0) -> tuple[str, dict]:
    """('answered', {...}) with what the server behind said and the status, or ('cut', {}) when the connection was dropped mid-upload."""
    conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=120, context=ssl._create_unverified_context())  # (a certificate made for this test)
    conn.blocksize = 1 << 20
    host = {"host": f"localhost:{port}"}  # the site answers to this name only; any other Host gets Caddy's empty fallback
    try:
        try:
            if method == "POST":
                conn.request("POST", path, body=Zeros(size), headers={**host, "content-type": "application/octet-stream", "content-length": str(size)})
            else:
                conn.request("GET", path, headers=host)
        except (OSError, http.client.HTTPException):
            pass  # Caddy answered (413) and closed while we were still sending: the answer may still be waiting for us
        if conn.sock is None:
            return "cut", {}  # not even connected (Caddy is not listening yet)
        try:
            response = conn.getresponse()
            raw = response.read()
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = {"raw": raw[:80].decode("latin-1")}
            payload["status"] = response.status
            return "answered", payload
        except (OSError, http.client.HTTPException):
            return "cut", {}
    finally:
        conn.close()


# ------------------------------------------------------------------------------------------------ the cases
# (method, path, megabytes, must be: "api" / "admin" = let through to that one, "refused" = 413 or cut)
CASES = [
    ("GET", "/health", 0, "api"),
    ("GET", "/api/v1/me", 0, "api"),
    ("GET", "/", 0, "admin"),
    ("GET", "/api/backend/analytics/overview", 0, "admin"),
    ("POST", "/api/v1/auth/login", 1.9, "api"),
    ("POST", "/api/v1/auth/login", 2.1, "refused"),
    ("POST", "/api/backend/employees", 2.1, "refused"),
    ("POST", "/api/v1/contacts/import", 50, "api"),
    ("POST", "/api/backend/contacts/import", 12, "admin"),  # the case that failed on the real server: a sheet of 12 MB
    ("POST", "/api/backend/contacts/import", 209, "admin"),
    ("POST", "/api/backend/contacts/import", 211, "refused"),
    ("POST", "/api/v1/recordings/12/upload", 100, "api"),
    ("POST", "/api/backend/recordings/12/upload", 100, "admin"),
    ("POST", "/api/v1/recordings/12/upload", 121, "refused"),
    ("POST", "/api/v1/recordings/abc/upload", 3, "refused"),  # looks like a recording, is not one
    ("POST", "/api/v1/contacts", 3, "refused"),  # looks like the sheet, is not it
    ("POST", "/api/v1/contacts/import/5/confirm", 3, "refused"),
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--caddy", required=True, help="the caddy binary")
    parser.add_argument("--caddyfile", default=str(Path(__file__).parent / "shared" / "Caddyfile"))
    args = parser.parse_args(argv)

    api, api_port = start_upstream("api")
    admin, admin_port = start_upstream("admin")
    port = free_port()
    failures = 0
    with tempfile.TemporaryDirectory(prefix="caddy-limits-") as tmp:
        folder = Path(tmp)
        cert, key = make_certificate(folder)
        config = folder / "Caddyfile"
        config.write_text(local_copy_of(Path(args.caddyfile).read_text(encoding="utf-8"), api_port=api_port, admin_port=admin_port, cert=cert, key=key), encoding="utf-8")
        env = dict(os.environ, PUBLIC_HOST="localhost", HTTPS_PORT=str(port), SITE_ADDRESS=f"https://localhost:{port}", ACME_EMAIL="ci@example.com", XDG_DATA_HOME=str(folder / "data"), XDG_CONFIG_HOME=str(folder / "conf"), APPDATA=str(folder / "appdata"))
        log = (folder / "caddy.log").open("w")
        caddy = subprocess.Popen([args.caddy, "run", "--config", str(config), "--adapter", "caddyfile"], env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            ready = False
            for _ in range(150):
                if caddy.poll() is not None:
                    break
                if send(port, "GET", "/health")[0] == "answered":
                    ready = True
                    break
                time.sleep(0.2)
            if not ready:
                log.flush()
                print((folder / "caddy.log").read_text(errors="replace")[-3000:])
                print("Caddy did not start with this Caddyfile")
                return 2
            print(f"Caddy {Path(args.caddyfile).as_posix()} on port {port}\n")
            for method, path, megabytes, must in CASES:
                how, got = send(port, method, path, int(megabytes * MB))
                status, who = got.get("status"), got.get("upstream")
                if must == "refused":
                    ok = how == "cut" or status == 413
                    seen = "413 (refused)" if status == 413 else ("connection cut" if how == "cut" else f"HTTP {status} from {who}, {got.get('bytes')} bytes")
                else:
                    ok = how == "answered" and status == 200 and who == must and (megabytes == 0 or got.get("bytes") == int(megabytes * MB))
                    seen = f"HTTP {status} from {who}, {got.get('bytes')} bytes" if how == "answered" else "connection cut"
                failures += not ok
                print(f"  {'ok  ' if ok else 'FAIL'} {method:<4} {path:<38} {megabytes:>5} MB  must be {must:<8} -> {seen}")
        finally:
            caddy.terminate()
            try:
                caddy.wait(timeout=10)
            except subprocess.TimeoutExpired:
                caddy.kill()
            log.close()
            api.shutdown()
            admin.shutdown()
    print(f"\n{failures} CASE(S) FAILED" if failures else "\nAll cases behave as they must.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
