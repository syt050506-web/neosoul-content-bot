import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("retirement", Path(__file__).with_name("retire-dragon.py"))
retirement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retirement)


class DragonRetirementTests(unittest.TestCase):
    def test_only_verified_system_tmux_server_is_ignored(self):
        class Process:
            name = "123"
            def __truediv__(self, item):
                class File:
                    def read_text(self): return "tmux: server"
                    def __str__(self): return "/proc/123/" + item
                return File()
        original_iterdir = Path.iterdir
        def processes(path):
            return iter([Process()]) if path == Path("/proc") else original_iterdir(path)
        def target(path):
            return "/usr/bin/tmux" if str(path).endswith("/exe") else str(retirement.ROOT)
        with patch.object(Path, "iterdir", processes), patch.object(retirement.os, "readlink", side_effect=target):
            self.assertEqual(retirement.holders(), [])
        def unrelated(path):
            return "/root/custom-bot" if str(path).endswith("/exe") else str(retirement.ROOT)
        with patch.object(Path, "iterdir", processes), patch.object(retirement.os, "readlink", side_effect=unrelated):
            self.assertEqual(retirement.holders(), [{"pid": 123, "name": "tmux: server"}])

    def test_wrong_source_identity_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src").mkdir()
            (root / "src/database.py").write_text("# unrelated application")
            with patch.object(retirement, "ROOT", root):
                with self.assertRaises(RuntimeError):
                    retirement.verify_root()
            self.assertTrue((root / "src/database.py").exists())

    def test_root_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "bot"
            root.symlink_to(base, target_is_directory=True)
            with patch.object(retirement, "ROOT", root):
                with self.assertRaises(RuntimeError):
                    retirement.verify_root()

    def test_backup_preserves_data_and_does_not_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "dragon"
            root.mkdir()
            (root / ".env").write_bytes(b"synthetic-private-configuration")
            outside = base / "outside"
            outside.mkdir()
            (outside / "keep").write_text("unrelated")
            (root / "linked").symlink_to(outside, target_is_directory=True)
            backup = base / "backup"
            backup.mkdir()
            target, digest = retirement.archive([root], backup)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(digest), 64)
            with tarfile.open(target) as bundle:
                prefix = str(root.relative_to("/"))
                self.assertEqual(bundle.extractfile(prefix + "/.env").read(), b"synthetic-private-configuration")
                self.assertTrue(bundle.getmember(prefix + "/linked").issym())
                self.assertNotIn(prefix + "/linked/keep", bundle.getnames())

    def test_dry_run_does_not_stop_services_or_remove_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src").mkdir()
            (root / "src/database.py").write_text("# Dragon Ball")
            fragment = root / "unit"
            fragment.write_text("service fixture")
            metadata = f"LoadState=loaded\nWorkingDirectory={root}\nFragmentPath={fragment}\nKillMode=control-group\n"
            with patch.object(retirement, "ROOT", root), patch.object(retirement, "FRAGMENT", fragment), patch.object(retirement.os, "geteuid", return_value=0), patch.object(retirement, "run", return_value=subprocess.CompletedProcess([], 0, metadata, "")) as execute, patch.object(retirement, "archive") as backup, patch.object(retirement.shutil, "rmtree") as remove, patch("sys.argv", ["retire-dragon.py", "--dry-run"]), redirect_stdout(io.StringIO()):
                retirement.main()
                self.assertEqual(execute.call_count, 1)
                backup.assert_not_called()
                remove.assert_not_called()
            self.assertTrue(fragment.exists())

    def test_unmanaged_process_prevents_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src").mkdir()
            (root / "src/database.py").write_text("# Dragon Ball")
            metadata = f"LoadState=loaded\nWorkingDirectory={root}\nFragmentPath={retirement.FRAGMENT}\nKillMode=control-group\n"
            replies = [subprocess.CompletedProcess([], 0, metadata, ""), subprocess.CompletedProcess([], 0, "", ""), subprocess.CompletedProcess([], 3, "", "")]
            with patch.object(retirement, "ROOT", root), patch.object(retirement.os, "geteuid", return_value=0), patch.object(retirement, "run", side_effect=replies), patch.object(retirement, "holders", return_value=[{"pid": 123, "name": "python"}]), patch.object(retirement, "archive") as backup, patch.object(retirement.shutil, "rmtree") as remove, patch("sys.argv", ["retire-dragon.py"]), redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):
                    retirement.main()
                backup.assert_not_called()
                remove.assert_not_called()
            self.assertTrue(root.exists())


if __name__ == "__main__":
    unittest.main()
