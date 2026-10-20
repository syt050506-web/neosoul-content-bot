import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "retirement", str(Path(__file__).with_name("retire-other-bots.py"))
)
retirement = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retirement)


class RetirementSafetyTests(unittest.TestCase):
    def test_scope_preserves_dragon_system_units_and_unrelated_apps(self):
        roots = retirement.REMOVE_ROOTS
        records = {
            retirement.KEEP_UNIT: {"WorkingDirectory": str(retirement.KEEP_ROOT)},
            "neosoul-bot.service": {"WorkingDirectory": "/root/NeoSoul-Bot"},
            "neosoul-content-bot.service": {"WorkingDirectory": "/root/neosoul-content-bot/neosoul-content-bot"},
            "guardian.service": {"ExecStart": "{ path=/root/EVOEVO-Guardian/.venv/bin/python; argv[]=python main.py; }"},
            "systemd-tpm2-setup.service": {"ExecStart": "/usr/lib/systemd/systemd-tpm2-setup"},
            "certbot.service": {"ExecStart": "/usr/bin/certbot renew"},
            "certbot-hook.service": {"ExecStart": "{ path=/usr/bin/certbot; argv[]=certbot --deploy-hook /root/NeoSoul-Bot/hook.py; }"},
            "unrelated.service": {"WorkingDirectory": "/root/NeoSoul-Bot-old"},
        }
        self.assertEqual(set(retirement.choose_units(records, roots)), {
            "neosoul-bot.service", "neosoul-content-bot.service", "guardian.service"
        })

    def test_explicit_retirement_cannot_reference_dragon(self):
        with self.assertRaisesRegex(RuntimeError, "retained bot"):
            retirement.choose_units({"neosoul-bot.service": {"WorkingDirectory": str(retirement.KEEP_ROOT)}}, retirement.REMOVE_ROOTS)

    def test_roots_cannot_overlap_dragon_or_follow_a_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            keep.mkdir()
            other = base / "other"
            other.mkdir()
            linked = base / "linked"
            linked.symlink_to(other, target_is_directory=True)
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "overlaps"):
                    retirement.guard_roots((base,))
                with self.assertRaisesRegex(RuntimeError, "symlink"):
                    retirement.guard_roots((linked,))

    def test_relative_database_dependency_blocks_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            keep.mkdir()
            other = base / "content"
            other.mkdir()
            database = other / "activity.sqlite"
            database.write_bytes(b"must retain")
            (keep / ".env").write_text('DATABASE_PATH="../content/activity.sqlite"\n')
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "database"):
                    retirement.guard_keep_dependencies({"WorkingDirectory": str(keep)}, (other,))
            self.assertEqual(database.read_bytes(), b"must retain")

    def test_runtime_environment_overrides_dotenv_database_path(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            keep.mkdir()
            other = base / "growth"
            other.mkdir()
            (keep / ".env").write_text('DATABASE_PATH=data/safe.sqlite\n')
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "database"):
                    retirement.guard_keep_dependencies(
                        {"WorkingDirectory": str(keep)}, (other,),
                        {"DATABASE_PATH": "../growth/activity.sqlite"},
                    )

    def test_unquoted_database_path_with_spaces_is_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            keep.mkdir()
            other = base / "growth"
            other.mkdir()
            (keep / ".env").write_text('DATABASE_PATH=../growth/my database.sqlite # current data\n')
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "database"):
                    retirement.guard_keep_dependencies({"WorkingDirectory": str(keep)}, (other,))

    def test_database_is_resolved_from_project_root_not_service_subdirectory(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            (keep / "src").mkdir(parents=True)
            other = base / "growth"
            other.mkdir()
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "database"):
                    retirement.guard_keep_dependencies(
                        {"WorkingDirectory": str(keep / "src")}, (other,),
                        {"DATABASE_PATH": "../growth/activity.sqlite"},
                    )

    def test_shared_service_config_symlink_blocks_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            keep.mkdir()
            other = base / "content"
            other.mkdir()
            (other / "service").write_text("[Service]\n")
            linked = base / "dragon.service"
            linked.symlink_to(other / "service")
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "configuration links"):
                    retirement.guard_keep_dependencies({"FragmentPath": str(linked)}, (other,))

    def test_shared_virtual_environment_blocks_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            keep.mkdir()
            other = base / "growth"
            (other / ".venv").mkdir(parents=True)
            (keep / ".venv").symlink_to(other / ".venv", target_is_directory=True)
            with patch.object(retirement, "KEEP_ROOT", keep):
                with self.assertRaisesRegex(RuntimeError, "shared dependency"):
                    retirement.guard_keep_dependencies({}, (other,))

    def test_shared_docker_volume_blocks_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            mount = {"Type": "volume", "Name": "shared", "Source": str(source)}
            records = [
                {"id": "remove", "image": "evoevo-guardian", "name": "/guardian", "labels": {}, "mounts": [mount]},
                {"id": "keep", "image": "dragonball", "name": "/dragon", "labels": {}, "mounts": [mount]},
            ]
            def fake_run(command, check=True):
                output = "remove\nkeep\n" if command[1] == "ps" else "\n".join(map(json.dumps, records))
                return subprocess.CompletedProcess(command, 0, output, "")
            with patch.object(retirement.shutil, "which", return_value="/usr/bin/docker"), patch.object(retirement, "run", side_effect=fake_run):
                with self.assertRaisesRegex(RuntimeError, "shared with a retained container"):
                    retirement.inspect_docker(retirement.REMOVE_ROOTS)

    def test_private_backup_preserves_untracked_data_and_does_not_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            project = base / "project"
            project.mkdir()
            (project / "wallets.csv").write_bytes(b"private mapping fixture")
            external = base / "outside"
            external.mkdir()
            (external / "retain.txt").write_text("outside remains")
            (project / "external").symlink_to(external, target_is_directory=True)
            backup = base / "backup"
            backup.mkdir()
            archive, digest = retirement.make_backup([project], backup)
            self.assertEqual(stat.S_IMODE(archive.stat().st_mode), 0o600)
            self.assertEqual(len(digest), 64)
            with tarfile.open(archive) as bundle:
                prefix = str(project.relative_to("/"))
                self.assertEqual(bundle.extractfile(prefix + "/wallets.csv").read(), b"private mapping fixture")
                self.assertTrue(bundle.getmember(prefix + "/external").issym())
                self.assertNotIn(prefix + "/external/retain.txt", bundle.getnames())
            self.assertEqual((external / "retain.txt").read_text(), "outside remains")

    def test_dry_run_never_starts_services_or_deletes_files(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            keep = base / "dragon"
            (keep / "src").mkdir(parents=True)
            (keep / "src/database.py").write_text("# Dragon Ball\n")
            other = base / "content"
            other.mkdir()
            keep_record = {"Id": retirement.KEEP_UNIT, "WorkingDirectory": str(keep)}
            target_record = {"Id": "neosoul-content-bot.service", "WorkingDirectory": str(other)}
            def fake_properties(names, fields):
                if len(names) == 1 and names[0] == retirement.KEEP_UNIT:
                    return {retirement.KEEP_UNIT: keep_record}
                return {retirement.KEEP_UNIT: keep_record, "neosoul-content-bot.service": target_record}
            with patch.object(retirement, "KEEP_ROOT", keep), patch.object(retirement, "REMOVE_ROOTS", (other,)), patch.object(retirement.os, "geteuid", return_value=0), patch.object(retirement, "properties", side_effect=fake_properties), patch.object(retirement, "run", return_value=subprocess.CompletedProcess([], 0, retirement.KEEP_UNIT + " enabled\nneosoul-content-bot.service enabled\n", "")), patch.object(retirement, "inspect_docker", return_value=([], [])), patch.object(retirement, "ensure_keep_ready") as ready, patch.object(retirement, "make_backup") as backup, patch.object(retirement.shutil, "rmtree") as remove, patch("sys.argv", ["retire-other-bots.py", "--dry-run"]), redirect_stdout(io.StringIO()):
                retirement.main()
                ready.assert_not_called()
                backup.assert_not_called()
                remove.assert_not_called()
            self.assertTrue(other.is_dir())


if __name__ == "__main__":
    unittest.main(verbosity=2)
