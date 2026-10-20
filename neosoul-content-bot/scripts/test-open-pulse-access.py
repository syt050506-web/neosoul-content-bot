import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("open-pulse-access.py")
spec = importlib.util.spec_from_file_location("pulse_deploy_access", MODULE_PATH)
access = importlib.util.module_from_spec(spec)
spec.loader.exec_module(access)


class DeploymentAccessTests(unittest.TestCase):
    def test_embedded_bridge_is_complete_and_has_verified_checksum(self):
        source = access.BRIDGE_SOURCE.encode("utf-8")
        self.assertEqual(
            access.hashlib.sha256(source).hexdigest(), access.BRIDGE_SHA256
        )
        compile(source, "<embedded-ssh-transport>", "exec")
        self.assertNotIn("BRIDGE_URL", vars(access))
        self.assertNotIn("urllib", vars(access))

    def test_add_and_revoke_preserve_owner_keys_and_are_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / ".ssh"
            directory.mkdir()
            keys = directory / "authorized_keys"
            keys.write_text("# owner\nssh-ed25519 AAAA-owner owner")
            access.key_update(True, directory)
            access.key_update(True, directory)
            self.assertEqual(keys.read_text().count(access.KEY), 1)
            self.assertIn("restrict " + access.KEY, keys.read_text())
            self.assertEqual(keys.stat().st_mode & 0o777, 0o600)
            access.key_update(False, directory)
            self.assertEqual(
                keys.read_text(), "# owner\nssh-ed25519 AAAA-owner owner\n"
            )

    def test_symlink_file_or_directory_cannot_modify_other_authorizations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "owner"
            outside.write_text("owner access")
            directory = root / ".ssh"
            directory.mkdir()
            (directory / "authorized_keys").symlink_to(outside)
            with self.assertRaises(RuntimeError):
                access.key_update(True, directory)
            linked = root / "linked"
            linked.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                access.key_update(True, linked)
            self.assertEqual(outside.read_text(), "owner access")

    def test_cleanup_cannot_delete_deployment_or_backup_directories(self):
        with (
            patch.object(access, "key_update") as change_keys,
            patch.object(access.shutil, "rmtree") as remove,
        ):
            for directory in (
                "/opt/dna-pulse",
                "/root/retired-dragon-bb30_ixz",
                "/run/unrelated",
            ):
                with self.assertRaises(RuntimeError):
                    access.close(directory)
            change_keys.assert_not_called()
            remove.assert_not_called()

    def test_nonroot_cannot_open_access(self):
        with (
            patch.object(access.os, "geteuid", return_value=1000),
            patch.object(access, "run") as run,
        ):
            with self.assertRaises(RuntimeError):
                access.main()
            run.assert_not_called()

    def test_corrupt_transport_never_authorizes_a_key_or_starts_tunnel(self):
        with (
            patch.object(access.os, "geteuid", return_value=0),
            patch.object(access.sys, "argv", [str(MODULE_PATH)]),
            patch.object(access, "BRIDGE_SOURCE", "unexpected transport code"),
            patch.object(access, "run") as run,
            patch.object(access, "key_update") as change_keys,
        ):
            with self.assertRaisesRegex(RuntimeError, "checksum"):
                access.main()
            change_keys.assert_not_called()
            run.assert_called_once_with(["systemctl", "start", "ssh"])

    def test_successful_transport_expires_and_never_starts_or_stops_a_bot(self):
        bridge = b"synthetic transport"
        responses = []

        def run(arguments, check=True):
            responses.append(arguments)
            text = ""
            code = 0
            if arguments[:3] == ["systemctl", "is-active", "--quiet"]:
                code = 3
            if arguments[0] == "ss" and sum(cmd[0] == "ss" for cmd in responses) > 1:
                text = "LISTEN 8765\n"
            if arguments[0] == "ssh-keygen":
                text = "synthetic-host-fingerprint\n"
            return subprocess.CompletedProcess(arguments, code, text, "")

        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(access.os, "geteuid", return_value=0),
            patch.object(access.sys, "argv", [str(MODULE_PATH)]),
            patch.object(access, "BRIDGE_SOURCE", bridge.decode()),
            patch.object(
                access, "BRIDGE_SHA256", access.hashlib.sha256(bridge).hexdigest()
            ),
            patch.object(access.tempfile, "mkdtemp", return_value=temporary),
            patch.object(access.shutil, "which", return_value=None),
            patch.object(access, "run", side_effect=run),
            patch.object(access, "key_update") as change_keys,
            patch("sys.stdout", new=io.StringIO()),
        ):
            access.main()
            change_keys.assert_called_once_with(True)
        launch = next(cmd for cmd in responses if cmd[0] == "systemd-run")
        self.assertIn("--property=RuntimeMaxSec=30min", launch)
        self.assertIn("--property=User=nobody", launch)
        self.assertTrue(
            any("ExecStopPost=" in arg and "--close" in arg for arg in launch)
        )
        self.assertFalse(
            any(
                "dna-pulse.service" in arg or "neosoul-discord-bot.service" in arg
                for cmd in responses
                for arg in cmd
            )
        )


if __name__ == "__main__":
    unittest.main()
