"""Stop the last NeoSoul bot and open temporary SSH transport for cleanup."""

import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK2GN9zxpT0Xi4R7xbt0RV7h8p6BXTChgU9uoIVFi+Jj codex-neosoul-community-cleanup"
BRIDGE_URL = "https://raw.githubusercontent.com/syt050506-web/neosoul-content-bot/b4a7e56af1fd8d3f0cddf288423e19b737a061a6/neosoul-content-bot/scripts/ssh-http-bridge.py"
BRIDGE_SHA256 = "da35e10526d02589ea5c44ceda64690fe727f7ff514bcaa165331b484b0714df"
UNIT = "neosoul-admin-tunnel.service"
BOT_UNIT = "neosoul-discord-bot.service"
BOT_ROOT = Path("/root/NeoSoul-Discord-Bot")


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
    if directory.parent != Path("/run") or not directory.name.startswith("neosoul-admin-tunnel."):
        raise RuntimeError("Unexpected cleanup path")
    if (directory / "ufw-added").exists():
        run(["/usr/sbin/ufw", "--force", "delete", "allow", "8765/tcp"], check=False)
    key_update(False)
    shutil.rmtree(directory, ignore_errors=True)


def stop_dragon():
    state = run(["systemctl", "show", "--property=LoadState", "--value", BOT_UNIT]).stdout.strip()
    if state == "not-found":
        print("Dragon Ball deployment is already absent.", flush=True)
        return
    working = run(["systemctl", "show", "--property=WorkingDirectory", "--value", BOT_UNIT]).stdout.strip()
    marker = BOT_ROOT / "src/database.py"
    if working != str(BOT_ROOT) or not marker.is_file() or "Dragon Ball" not in marker.read_text():
        raise RuntimeError("The remaining bot's identity needs inspection")
    run(["systemctl", "disable", "--now", BOT_UNIT])
    if run(["systemctl", "is-active", "--quiet", BOT_UNIT], check=False).returncode == 0:
        raise RuntimeError("The bot did not stop")
    print("Dragon Ball stopped and disabled; its data remains intact for backup.", flush=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Run in the root DigitalOcean Console")
    if len(sys.argv) == 3 and sys.argv[1] == "--close":
        close(sys.argv[2])
        return
    stop_dragon()
    with urllib.request.urlopen(BRIDGE_URL, timeout=20) as response:
        source = response.read(65537)
    if hashlib.sha256(source).hexdigest() != BRIDGE_SHA256:
        raise RuntimeError("Transport source checksum failed; no access opened")
    if run(["systemctl", "is-active", "--quiet", UNIT], check=False).returncode == 0:
        run(["systemctl", "stop", UNIT])
        for _ in range(20):
            if run(["systemctl", "show", "--property=LoadState", "--value", UNIT], check=False).stdout.strip() == "not-found":
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
            if rules.startswith("Status: active") and not any(line.startswith(("8765 ", "8765/tcp ")) for line in rules.splitlines()):
                (directory / "ufw-added").touch()
                run(["ufw", "allow", "8765/tcp"])
        run(["systemctl", "reset-failed", UNIT], check=False)
        properties = ["RuntimeMaxSec=30min", "User=nobody", "Group=nogroup", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes", "PrivateTmp=yes", "PrivateDevices=yes", "MemoryMax=96M", "TasksMax=32", f"ExecStopPost=+/usr/bin/python3 -B {directory}/cleanup.py --close {directory}"]
        run(["systemd-run", "--unit=" + UNIT, "--collect", *("--property=" + value for value in properties), "/usr/bin/python3", "-B", str(directory / "bridge.py")])
        started = True
        for _ in range(20):
            if run(["ss", "-H", "-lnt", "( sport = :8765 )"]).stdout.strip():
                key_update(True)
                print("Temporary cleanup access ready; expires in 30 minutes.", flush=True)
                print(run(["ssh-keygen", "-lf", "/etc/ssh/ssh_host_ed25519_key.pub"]).stdout.strip(), flush=True)
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
    except Exception as error:
        if isinstance(error, subprocess.CalledProcessError):
            print("Cleanup access stopped: a required system command failed.", flush=True)
        else:
            print("Cleanup access stopped:", str(error), flush=True)
        raise SystemExit(1)
