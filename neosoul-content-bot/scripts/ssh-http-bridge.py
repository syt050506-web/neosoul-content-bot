"""Temporary HTTP byte transport to the existing localhost SSH server only.

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
