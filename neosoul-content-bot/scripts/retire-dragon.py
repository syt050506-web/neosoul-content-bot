"""Back up and remove the last Dragon Ball deployment without restarting bots."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path("/root/NeoSoul-Discord-Bot")
UNIT = "neosoul-discord-bot.service"
FRAGMENT = Path("/etc/systemd/system/neosoul-discord-bot.service")
OVERRIDES = Path("/etc/systemd/system/neosoul-discord-bot.service.d")


def run(arguments, check=True):
    return subprocess.run(arguments, text=True, capture_output=True, check=check)


def within(path, parent):
    return path == parent or parent in path.parents


def verify_root():
    if not ROOT.exists() and not ROOT.is_symlink():
        return
    if ROOT.is_symlink() or ROOT.resolve() != ROOT or not ROOT.is_dir():
        raise RuntimeError("Unexpected bot directory; deletion stopped")
    marker = ROOT / "src/database.py"
    if not marker.is_file() or "Dragon Ball" not in marker.read_text():
        raise RuntimeError("Dragon Ball source identity could not be verified")
    if (ROOT / ".git").is_file():
        raise RuntimeError("Linked Git metadata requires a separate backup")
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        path = Path(line.split()[4])
        if within(path, ROOT):
            raise RuntimeError("A mounted filesystem needs separate inspection")


def holders():
    result = []
    for process in Path("/proc").iterdir():
        if not process.name.isdigit() or int(process.name) == os.getpid():
            continue
        try:
            name = (process / "comm").read_text().strip()
            if name in {"bash", "sh", "dash", "zsh", "fish", "ssh"}:
                continue
            if name == "tmux: server" and os.readlink(process / "exe").removesuffix(" (deleted)") in {"/usr/bin/tmux", "/bin/tmux"}:
                # A terminal server can retain an inert working directory.
                # Its actual pane processes are inspected independently below.
                continue
            working = Path(os.readlink(process / "cwd").removesuffix(" (deleted)"))
            if within(working, ROOT):
                result.append({"pid": int(process.name), "name": name})
        except OSError:
            pass
    return result


def archive(paths, destination):
    target = destination / "dragon-ball.tar.gz"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        with tarfile.open(fileobj=output, mode="w:gz", compresslevel=1, dereference=False) as bundle:
            for path in paths:
                bundle.add(path, arcname=str(path.relative_to("/")))
    with gzip.open(target, "rb") as check:
        while check.read(1024 * 1024):
            pass
    with tarfile.open(target, "r:gz") as bundle:
        for path in paths:
            bundle.getmember(str(path.relative_to("/")))
    with target.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    return target, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run as root on the authorized Droplet")
    verify_root()
    raw = run(["systemctl", "show", "--property=LoadState,ActiveState,WorkingDirectory,FragmentPath,KillMode", UNIT]).stdout
    record = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    exists = record.get("LoadState") != "not-found"
    if exists and (record.get("WorkingDirectory") != str(ROOT) or record.get("FragmentPath") != str(FRAGMENT)):
        raise RuntimeError("The service identity differs; no deletion performed")
    if exists and record.get("KillMode") not in {"control-group", "mixed"}:
        raise RuntimeError("The service cannot safely stop its child processes")
    paths = [path for path in (ROOT, FRAGMENT, OVERRIDES) if path.exists() or path.is_symlink()]
    for path in paths:
        if path.is_symlink() or path.resolve() != path:
            raise RuntimeError("A deployment path is a symlink or alias")
    print("REMOVE DEPLOYMENT:", UNIT, ROOT, flush=True)
    if arguments.dry_run:
        return
    if exists:
        run(["systemctl", "disable", "--now", UNIT])
    if run(["systemctl", "is-active", "--quiet", UNIT], check=False).returncode == 0:
        raise RuntimeError("The bot is still active; no deletion performed")
    remaining = holders()
    if remaining:
        raise RuntimeError("Processes still use the bot directory: " + json.dumps(remaining))
    if not paths:
        print("Dragon Ball deployment is already absent.", flush=True)
        return
    required = 256 * 1024 * 1024
    for path in paths:
        if path.is_dir():
            for parent, _, files in os.walk(path, followlinks=False):
                required += sum((Path(parent) / name).lstat().st_size for name in files)
        else:
            required += path.stat().st_size
    if shutil.disk_usage("/root").free < required:
        raise RuntimeError("Insufficient free space for a complete backup; bot remains stopped")
    destination = Path(tempfile.mkdtemp(prefix="retired-dragon-", dir="/root"))
    try:
        backup, digest = archive(paths, destination)
        manifest = destination / "manifest.json"
        manifest.write_text(json.dumps({"unit": UNIT, "paths": list(map(str, paths)), "archive": str(backup), "sha256": digest}, indent=2))
        manifest.chmod(0o600)
        print("Verified private backup:", backup, flush=True)
        for path in reversed(paths):
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "reset-failed", UNIT], check=False)
        assert not ROOT.exists() and not FRAGMENT.exists() and not OVERRIDES.exists()
        assert not holders()
        print("Dragon Ball deployment removed; no bot was restarted.", flush=True)
        print("Backup:", backup, flush=True)
    except BaseException:
        print("Recovery/status directory:", destination, flush=True)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if isinstance(error, subprocess.CalledProcessError):
            print("Retirement stopped: a required system command failed.", flush=True)
        else:
            print("Retirement stopped:", str(error), flush=True)
        raise SystemExit(1)
