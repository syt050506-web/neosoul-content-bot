"""Self-contained 30-minute SSH transport for authorized DNA Pulse deployment.

This only opens temporary access. It does not stop, start or restore any bot.
"""

import fcntl
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJvfvD4m1UmsWu38B8WXhKVIusZmEgXQT9jF053r/NRe codex-dna-pulse-deploy"
BRIDGE_SOURCE = r'''"""Temporary HTTP byte transport to the existing localhost SSH server only.

SSH provides end-to-end authentication, host verification and encryption. HTTP
requests carry encrypted SSH packets; this service has no command execution API.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import re
import secrets
import select
import socket
import threading
import time

TARGET = ("127.0.0.1", 22)
MAX_PACKET = 65536


class Session:
    def __init__(self, connection):
        self.connection = connection
        self.read_lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.touched = time.monotonic()
        self.closed = False

    def close(self):
        self.closed = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()


class Bridge(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def reply(self, code, payload=b""):
        self.close_connection = True
        self.send_response(code)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def lookup(self):
        match = re.fullmatch(r"/ssh/([a-f0-9]{64})/(read|write|close)", self.path)
        if not match:
            return None, None
        with self.server.session_lock:
            session = self.server.sessions.get(match[1])
            if session and (session.closed or time.monotonic() - session.touched > 180):
                session.close()
                del self.server.sessions[match[1]]
                session = None
        return session, match[2]

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, b"neosoul-ssh-http-transport\n")
            return
        session, operation = self.lookup()
        if not session or operation != "read":
            self.reply(404)
            return
        if not session.read_lock.acquire(blocking=False):
            self.reply(409)
            return
        try:
            readable, _, _ = select.select([session.connection], [], [], 15)
            if not readable:
                self.reply(204)
                return
            data = session.connection.recv(32768)
            if not data:
                session.close()
                self.reply(410)
                return
            session.touched = time.monotonic()
            self.reply(200, data)
        except (OSError, ValueError):
            session.close()
            self.reply(410)
        finally:
            session.read_lock.release()

    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.reply(400)
            return
        if self.headers.get("Transfer-Encoding") or size < 0 or size > MAX_PACKET:
            self.reply(413)
            return
        payload = self.rfile.read(size)
        if len(payload) != size:
            self.reply(400)
            return
        if self.path == "/ssh/create":
            if payload:
                self.reply(400)
                return
            with self.server.session_lock:
                for identifier, session in list(self.server.sessions.items()):
                    if session.closed or time.monotonic() - session.touched > 180:
                        session.close()
                        del self.server.sessions[identifier]
                if len(self.server.sessions) >= 4:
                    self.reply(429)
                    return
                try:
                    connection = socket.create_connection(TARGET, timeout=5)
                    connection.settimeout(10)
                except OSError:
                    self.reply(503)
                    return
                identifier = secrets.token_hex(32)
                self.server.sessions[identifier] = Session(connection)
            self.reply(201, identifier.encode("ascii"))
            return
        session, operation = self.lookup()
        if not session:
            self.reply(404)
            return
        if operation == "close":
            session.close()
            self.reply(204)
            return
        if operation != "write":
            self.reply(404)
            return
        try:
            with session.write_lock:
                session.connection.sendall(payload)
                session.touched = time.monotonic()
            self.reply(204)
        except OSError:
            session.close()
            self.reply(410)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
        self.sessions = {}
        self.session_lock = threading.Lock()
        super().__init__(*args, **kwargs)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def server_close(self):
        for session in self.sessions.values():
            session.close()
        super().server_close()


if __name__ == "__main__":
    with Server(("0.0.0.0", 8765), Bridge) as server:
        print("Temporary SSH HTTP transport listening on port 8765.", flush=True)
        server.serve_forever()
'''
BRIDGE_SHA256 = "da35e10526d02589ea5c44ceda64690fe727f7ff514bcaa165331b484b0714df"
UNIT = "neosoul-admin-tunnel.service"


def run(arguments, check=True):
    return subprocess.run(arguments, capture_output=True, text=True, check=check)


def key_update(add, directory=Path("/root/.ssh")):
    if directory.is_symlink():
        raise RuntimeError("SSH directory needs inspection")
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / "authorized_keys"
    if path.is_symlink():
        raise RuntimeError("SSH authorization file needs inspection")
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    with path.open("r+") as output:
        fcntl.flock(output, fcntl.LOCK_EX)
        lines = output.readlines()
        public = KEY.split()[1]
        remaining = [line for line in lines if public not in line.split()]
        if add:
            if remaining and not remaining[-1].endswith("\n"):
                remaining[-1] += "\n"
            remaining.append("restrict " + KEY + "\n")
        output.seek(0)
        output.writelines(remaining)
        output.truncate()


def close(directory):
    directory = Path(directory).resolve()
    if directory.parent != Path("/run") or not directory.name.startswith(
        "neosoul-admin-tunnel."
    ):
        raise RuntimeError("Unexpected cleanup path")
    if (directory / "ufw-added").exists():
        run(["/usr/sbin/ufw", "--force", "delete", "allow", "8765/tcp"], check=False)
    key_update(False)
    shutil.rmtree(directory, ignore_errors=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Run in the root DigitalOcean Console")
    if len(sys.argv) == 3 and sys.argv[1] == "--close":
        close(sys.argv[2])
        return
    run(["systemctl", "start", "ssh"])
    source = BRIDGE_SOURCE.encode("utf-8")
    if hashlib.sha256(source).hexdigest() != BRIDGE_SHA256:
        raise RuntimeError("Transport source checksum failed; no access opened")
    if run(["systemctl", "is-active", "--quiet", UNIT], check=False).returncode == 0:
        run(["systemctl", "stop", UNIT])
        for _ in range(20):
            if (
                run(
                    ["systemctl", "show", "--property=LoadState", "--value", UNIT],
                    check=False,
                ).stdout.strip()
                == "not-found"
            ):
                break
            time.sleep(0.25)
    if run(["ss", "-H", "-lnt", "( sport = :8765 )"]).stdout.strip():
        raise RuntimeError("Port 8765 is in use; no access opened")
    directory = Path(tempfile.mkdtemp(prefix="neosoul-admin-tunnel.", dir="/run"))
    directory.chmod(0o755)
    (directory / "bridge.py").write_bytes(source)
    (directory / "bridge.py").chmod(0o644)
    shutil.copyfile(__file__, directory / "cleanup.py")
    (directory / "cleanup.py").chmod(0o600)
    started = False
    try:
        if shutil.which("ufw"):
            rules = run(["ufw", "status"]).stdout
            if rules.startswith("Status: active") and not any(
                line.startswith(("8765 ", "8765/tcp ")) for line in rules.splitlines()
            ):
                (directory / "ufw-added").touch()
                run(["ufw", "allow", "8765/tcp"])
        run(["systemctl", "reset-failed", UNIT], check=False)
        properties = [
            "RuntimeMaxSec=30min",
            "User=nobody",
            "Group=nogroup",
            "NoNewPrivileges=yes",
            "ProtectSystem=strict",
            "ProtectHome=yes",
            "PrivateTmp=yes",
            "PrivateDevices=yes",
            "MemoryMax=96M",
            "TasksMax=32",
            f"ExecStopPost=+/usr/bin/python3 -B {directory}/cleanup.py --close {directory}",
        ]
        run(
            [
                "systemd-run",
                "--unit=" + UNIT,
                "--collect",
                *("--property=" + value for value in properties),
                "/usr/bin/python3",
                "-B",
                str(directory / "bridge.py"),
            ]
        )
        started = True
        for _ in range(20):
            if run(["ss", "-H", "-lnt", "( sport = :8765 )"]).stdout.strip():
                key_update(True)
                print(
                    "Temporary DNA Pulse deployment access ready; expires in 30 minutes.",
                    flush=True,
                )
                print(
                    run(
                        ["ssh-keygen", "-lf", "/etc/ssh/ssh_host_ed25519_key.pub"]
                    ).stdout.strip(),
                    flush=True,
                )
                return
            time.sleep(0.25)
        raise RuntimeError("Temporary transport did not start")
    except BaseException:
        if started:
            run(["systemctl", "stop", UNIT], check=False)
        close(directory)
        raise


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            print(
                "Deployment access stopped: a required system command failed.",
                flush=True,
            )
        else:
            print("Deployment access stopped:", str(error), flush=True)
        raise SystemExit(1)
