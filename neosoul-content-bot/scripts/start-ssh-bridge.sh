#!/usr/bin/env bash
# Install a temporary, unprivileged SSH HTTP transport from an exact commit.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run in the root DigitalOcean Console.' >&2; exit 1; }
[[ $# == 2 && $2 =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: start-ssh-bridge.sh REPOSITORY COMMIT' >&2; exit 1; }
repo=$1
commit=$2
unit=neosoul-admin-tunnel.service
if systemctl is-active --quiet "$unit"; then
  systemctl stop "$unit"
  for _ in {1..20}; do
    [[ $(systemctl show -p LoadState --value "$unit" 2>/dev/null || true) == not-found ]] && break
    sleep 0.25
  done
fi
if ss -H -lnt '( sport = :8765 )' | grep -q .; then
  echo 'Port 8765 is already in use; no change made.' >&2
  exit 1
fi
directory=$(mktemp -d /run/neosoul-admin-tunnel.XXXXXXXX)
chmod 755 "$directory"
started=false
cleanup() {
  if [[ "$started" == false ]]; then
    if [[ -f "$directory/ufw-added" ]]; then
      ufw --force delete allow 8765/tcp || true
    fi
    rm -rf -- "$directory"
  fi
}
trap cleanup EXIT
git -C "$repo" show "$commit:neosoul-content-bot/scripts/ssh-http-bridge.py" > "$directory/bridge.py"
chmod 644 "$directory/bridge.py"
cat > "$directory/cleanup.py" <<'PY'
import fcntl
from pathlib import Path
import shutil
import subprocess

directory = Path(__file__).resolve().parent
if directory.parent != Path('/run') or not directory.name.startswith('neosoul-admin-tunnel.'):
    raise SystemExit('Unexpected cleanup directory')
if (directory / 'ufw-added').exists():
    subprocess.run(['/usr/sbin/ufw', '--force', 'delete', 'allow', '8765/tcp'], check=False)
keyfile = Path('/root/.ssh/authorized_keys')
if keyfile.is_file() and not keyfile.is_symlink():
    expected = 'restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO/O0zshjtV6iJC6EZaHOkl8qngl1hFOezLs/SugYs5a codex-neosoul-cleanup'
    with keyfile.open('r+') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        lines = f.readlines()
        remaining = [line for line in lines if line.strip() != expected]
        if lines != remaining:
            f.seek(0)
            f.writelines(remaining)
            f.truncate()
shutil.rmtree(directory)
PY
chmod 600 "$directory/cleanup.py"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  if ! ufw status | grep -Eq '^8765(/tcp)?[[:space:]]'; then
    touch "$directory/ufw-added"
    ufw allow 8765/tcp
  fi
fi
systemctl reset-failed "$unit" 2>/dev/null || true
systemd-run --unit="$unit" --collect \
  --property=RuntimeMaxSec=30min \
  --property=User=nobody --property=Group=nogroup \
  --property=NoNewPrivileges=yes --property=ProtectSystem=strict \
  --property=ProtectHome=yes --property=PrivateTmp=yes \
  --property=PrivateDevices=yes --property=MemoryMax=96M \
  --property=TasksMax=32 \
  --property="ExecStopPost=+/usr/bin/python3 -B $directory/cleanup.py" \
  /usr/bin/python3 -B "$directory/bridge.py"
started=true
for _ in {1..20}; do
  if ss -H -lnt '( sport = :8765 )' | grep -q .; then
    install -d -m 700 /root/.ssh
    touch /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
    key='restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO/O0zshjtV6iJC6EZaHOkl8qngl1hFOezLs/SugYs5a codex-neosoul-cleanup'
    grep -qxF "$key" /root/.ssh/authorized_keys || printf '\n%s\n' "$key" >> /root/.ssh/authorized_keys
    echo 'Temporary SSH HTTP transport ready; expires in 30 minutes.'
    ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
    exit 0
  fi
  sleep 0.25
done
systemctl stop "$unit"
echo 'Transport did not start; temporary changes were reverted.' >&2
exit 1
