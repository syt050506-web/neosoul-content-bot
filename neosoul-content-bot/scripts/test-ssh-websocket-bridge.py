"""Local transport checks; uses loopback sockets and the Python standard library."""

import base64
import importlib.util
import os
from pathlib import Path
import socket
import socketserver
import struct
import threading
import unittest

source = Path(__file__).with_name("ssh-websocket-bridge.py")
spec = importlib.util.spec_from_file_location("bridge", source)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
BANNER = b"SSH-2.0-LocalTransportTest\r\n"


def read_exact(connection, count):
    data = b""
    while len(data) < count:
        block = connection.recv(count - len(data))
        if not block:
            raise EOFError
        data += block
    return data


def read_frame(connection):
    first, size = read_exact(connection, 2)
    if size == 126:
        size = struct.unpack("!H", read_exact(connection, 2))[0]
    elif size == 127:
        size = struct.unpack("!Q", read_exact(connection, 8))[0]
    return first & 15, read_exact(connection, size)


def frame(payload, opcode=2, final=True):
    size = len(payload)
    first = (128 if final else 0) | opcode
    header = bytes((first, 128 | size)) if size < 126 else bytes((first, 128 | 126)) + struct.pack("!H", size)
    mask = os.urandom(4)
    return header + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(payload))


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.sendall(BANNER)
        while True:
            data = self.request.recv(32768)
            if not data:
                return
            self.request.sendall(data)


class EchoServer(socketserver.ThreadingTCPServer):
    daemon_threads = True


class TransportChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.echo = EchoServer(("127.0.0.1", 0), Echo)
        bridge.TARGET = cls.echo.server_address
        cls.http = bridge.Server(("127.0.0.1", 0), bridge.Bridge)
        for server in (cls.echo, cls.http):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for server in (cls.http, cls.echo):
            server.shutdown()
            server.server_close()

    def connect(self):
        connection = socket.create_connection(self.http.server_address, timeout=3)
        self.addCleanup(connection.close)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            "GET /neosoul-ssh HTTP/1.1\r\nHost: localhost\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        connection.sendall(request.encode())
        headers = b""
        while not headers.endswith(b"\r\n\r\n"):
            headers += read_exact(connection, 1)
        self.assertTrue(headers.startswith(b"HTTP/1.1 101"))
        self.assertEqual(read_frame(connection), (2, BANNER))
        return connection

    def test_bidirectional_binary_stream(self):
        connection = self.connect()
        expected = bytes(range(256)) * 200
        connection.sendall(frame(expected))
        actual = b""
        while len(actual) < len(expected):
            opcode, payload = read_frame(connection)
            self.assertEqual(opcode, 2)
            actual += payload
        self.assertEqual(actual, expected)

    def test_fragmentation_and_ping(self):
        connection = self.connect()
        connection.sendall(frame(b"first-", final=False) + frame(b"ping", opcode=9) + frame(b"second", opcode=0))
        actual = b""
        pong = False
        while actual != b"first-second" or not pong:
            opcode, payload = read_frame(connection)
            if opcode == 10:
                self.assertEqual(payload, b"ping")
                pong = True
            else:
                self.assertEqual(opcode, 2)
                actual += payload

    def test_reject_unmasked_client(self):
        connection = self.connect()
        connection.sendall(b"\x82\x01X")
        self.assertEqual(connection.recv(1), b"")

    def test_reject_oversize_before_reading_payload(self):
        connection = self.connect()
        connection.sendall(b"\x82\xff" + struct.pack("!Q", bridge.MAX_FRAME + 1))
        self.assertEqual(connection.recv(1), b"")

    def test_reject_plain_http(self):
        with socket.create_connection(self.http.server_address, timeout=3) as connection:
            connection.sendall(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
            self.assertIn(b"400", connection.recv(1024).split(b"\r\n")[0])


if __name__ == "__main__":
    unittest.main()
