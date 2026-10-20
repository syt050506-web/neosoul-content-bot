import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cleanup", Path(__file__).with_name("open-cleanup-access.py"))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class AccessSafetyTests(unittest.TestCase):
    def test_authorization_and_revocation_preserve_other_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / ".ssh"
            directory.mkdir()
            keys = directory / "authorized_keys"
            original = "# existing owner access\nssh-ed25519 AAAA-owner-key owner"
            keys.write_text(original)
            cleanup.key_update(True, directory)
            cleanup.key_update(True, directory)
            self.assertEqual(keys.read_text().count(cleanup.KEY), 1)
            self.assertTrue(keys.read_text().startswith(original + "\n"))
            self.assertEqual(keys.stat().st_mode & 0o777, 0o600)
            cleanup.key_update(False, directory)
            self.assertEqual(keys.read_text(), original + "\n")

    def test_symlink_authorization_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            external = directory / "outside"
            external.write_text("owner key")
            (directory / "authorized_keys").symlink_to(external)
            with self.assertRaises(RuntimeError):
                cleanup.key_update(True, directory)
            self.assertEqual(external.read_text(), "owner key")

    def test_wrong_bot_identity_cannot_stop_services(self):
        replies = [subprocess.CompletedProcess([], 0, "loaded\n", ""), subprocess.CompletedProcess([], 0, "/unrelated\n", "")]
        with patch.object(cleanup, "run", side_effect=replies) as execute:
            with self.assertRaises(RuntimeError):
                cleanup.stop_dragon()
            self.assertEqual(execute.call_count, 2)

    def test_verified_bot_is_stopped_without_deleting_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src").mkdir()
            marker = root / "src/database.py"
            marker.write_text("# Dragon Ball\n")
            replies = [subprocess.CompletedProcess([], 0, "loaded\n", ""), subprocess.CompletedProcess([], 0, str(root) + "\n", ""), subprocess.CompletedProcess([], 0, "", ""), subprocess.CompletedProcess([], 3, "", "")]
            with patch.object(cleanup, "BOT_ROOT", root), patch.object(cleanup, "run", side_effect=replies) as execute:
                cleanup.stop_dragon()
                self.assertEqual(execute.call_args_list[2].args[0], ["systemctl", "disable", "--now", cleanup.BOT_UNIT])
            self.assertTrue(marker.is_file())

    def test_cleanup_rejects_unrelated_directory(self):
        with self.assertRaises(RuntimeError), patch.object(cleanup, "key_update") as keys:
            cleanup.close("/root/NeoSoul-Discord-Bot")
        keys.assert_not_called()

    def test_nonroot_does_not_change_services(self):
        with patch.object(cleanup.os, "geteuid", return_value=1000), patch.object(cleanup, "stop_dragon") as stop:
            with self.assertRaises(RuntimeError):
                cleanup.main()
            stop.assert_not_called()


if __name__ == "__main__":
    unittest.main()
