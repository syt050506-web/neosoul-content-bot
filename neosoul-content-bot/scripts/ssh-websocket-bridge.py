"""Temporary WebSocket transport for the existing localhost SSH server.

This forwards bytes to 127.0.0.1:22 only. Authentication and encryption remain
SSH's responsibility. Run as an unprivileged user under a time-limited unit.
"""

import base64
import binascii
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socket
import struct
import threading

TARGET = ("127.0.0.1", 22)
MAX_FRAME = 65536


class Bridge(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_GET(self):
        self.close_connection = True
        try:
            key = self.headers.get("Sec-WebSocket-Key", "")
            decoded = base64.b64decode(key, validate=True)
        except (ValueError, binascii.Error):
            decoded = b""
        if (
            self.path != "/neosoul-ssh"
            or self.headers.get("Upgrade", "").lower() != "websocket"
            or "upgrade" not in [v.strip().lower() for v in self.headers.get("Connection", "").split(",")]
            or self.headers.get("Sec-WebSocket-Version") != "13"
            or len(decoded) != 16
        ):
            self.send_error(400)
            return
        try:
            remote = socket.create_connection(TARGET, timeout=5)
        except OSError:
            self.send_error(503)
            return
        remote.settimeout(None)
        self.connection.settimeout(120)
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
        ).decode("ascii")
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        write_lock = threading.Lock()

        def send_frame(opcode, data):
            size = len(data)
            header = bytes((0x80 | opcode, size)) if size < 126 else bytes((0x80 | opcode, 126)) + struct.pack("!H", size)
            with write_lock:
                self.connection.sendall(header + data)

        def receive_ssh():
            try:
                while True:
                    data = remote.recv(32768)
                    if not data:
                        break
                    send_frame(2, data)
            except OSError:
                pass
            finally:
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

        def read_exact(count):
            data = self.rfile.read(count)
            if len(data) != count:
                raise EOFError
            return data

        reader = threading.Thread(target=receive_ssh, daemon=True)
        reader.start()
        fragmented = False
        try:
            while True:
                first, second = read_exact(2)
                final, opcode = bool(first & 0x80), first & 0x0F
                if first & 0x70 or not second & 0x80:
                    break
                size = second & 0x7F
                if size == 126:
                    size = struct.unpack("!H", read_exact(2))[0]
                elif size == 127:
                    size = struct.unpack("!Q", read_exact(8))[0]
                if size > MAX_FRAME or (opcode >= 8 and (not final or size > 125)):
                    break
                mask = read_exact(4)
                payload = read_exact(size)
                payload = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
                if opcode == 8:
                    send_frame(8, payload)
                    break
                if opcode == 9:
                    send_frame(10, payload)
                elif opcode == 10:
                    continue
                elif opcode == 2 and not fragmented:
                    fragmented = not final
                    remote.sendall(payload)
                elif opcode == 0 and fragmented:
                    fragmented = not final
                    remote.sendall(payload)
                else:
                    break
        except (OSError, EOFError, ValueError):
            pass
        finally:
            try:
                remote.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            remote.close()
            reader.join(timeout=2)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
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


if __name__ == "__main__":
    with Server(("0.0.0.0", 8765), Bridge) as server:
        print("Temporary SSH WebSocket transport listening on port 8765.", flush=True)
        server.serve_forever()
