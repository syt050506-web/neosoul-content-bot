"""Real loopback HTTP/TCP checks with synthetic bytes and no credentials."""

import importlib.util
from pathlib import Path
import socketserver
import threading
import unittest
import urllib.error
import urllib.request

source = Path(__file__).with_name("ssh-http-bridge.py")
spec = importlib.util.spec_from_file_location("bridge", source)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
BANNER = b"SSH-2.0-LocalTransportTest\r\n"


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.sendall(BANNER)
        try:
            while data := self.request.recv(32768):
                self.request.sendall(data)
        except OSError:
            pass


class EchoServer(socketserver.ThreadingTCPServer):
    daemon_threads = True


class TransportChecks(unittest.TestCase):
    def setUp(self):
        self.echo = EchoServer(("127.0.0.1", 0), Echo)
        bridge.TARGET = self.echo.server_address
        self.http = bridge.Server(("127.0.0.1", 0), bridge.Bridge)
        for server in (self.echo, self.http):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        for server in (self.http, self.echo):
            server.shutdown()
            server.server_close()

    def request(self, path, data=None):
        url = f"http://127.0.0.1:{self.http.server_port}{path}"
        with self.opener.open(urllib.request.Request(url, data=data), timeout=3) as response:
            return response.status, response.read()

    def create(self):
        status, identifier = self.request("/ssh/create", b"")
        self.assertEqual(status, 201)
        self.assertRegex(identifier.decode(), "^[a-f0-9]{64}$")
        path = "/ssh/" + identifier.decode()
        self.assertEqual(self.request(path + "/read"), (200, BANNER))
        return path

    def test_bidirectional_binary_stream(self):
        path = self.create()
        expected = bytes(range(256)) * 200
        self.assertEqual(self.request(path + "/write", expected), (204, b""))
        actual = b""
        while len(actual) < len(expected):
            status, data = self.request(path + "/read")
            self.assertEqual(status, 200)
            actual += data
        self.assertEqual(actual, expected)

    def test_session_close_revokes_transport(self):
        path = self.create()
        self.assertEqual(self.request(path + "/close", b""), (204, b""))
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path + "/write", b"data")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_reject_oversize_request(self):
        path = self.create()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path + "/write", b"X" * (bridge.MAX_PACKET + 1))
        self.assertEqual(error.exception.code, 413)
        error.exception.close()

    def test_session_capacity_recovers_after_close(self):
        paths = [self.create() for _ in range(4)]
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/ssh/create", b"")
        self.assertEqual(error.exception.code, 429)
        error.exception.close()
        self.request(paths[0] + "/close", b"")
        self.create()

    def test_expired_session_cannot_write(self):
        path = self.create()
        identifier = path.rsplit("/", 1)[1]
        self.http.sessions[identifier].touched -= 181
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request(path + "/write", b"X")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_health_and_absence_of_command_api(self):
        self.assertEqual(self.request("/health"), (200, b"neosoul-ssh-http-transport\n"))
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/exec", b"id")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()


if __name__ == "__main__":
    unittest.main()
