#!/usr/bin/env bash
# Update the existing DigitalOcean service while preserving its configuration and data.
set -euo pipefail

repo=/root/neosoul-content-bot
project="$repo/neosoul-content-bot"
unit=neosoul-content-bot.service
release=adc560ad5aa19af4ddfbf8d2579565bec0aa9798

if [[ $(id -u) != 0 ]]; then
  printf '%s\n' 'Run this deployment from the Droplet Console as root.' >&2
  exit 1
fi
cd "$project"
git -C "$repo" diff --quiet
git -C "$repo" diff --cached --quiet
git -C "$repo" cat-file -e "$release^{commit}"
command -v pnpm >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
systemctl is-active --quiet "$unit"
kill_mode=$(systemctl show "$unit" --property=KillMode --value)
if [[ "$kill_mode" != control-group && "$kill_mode" != mixed ]]; then
  printf 'Service KillMode=%s needs inspection before updating its child processes.\n' "$kill_mode" >&2
  exit 1
fi

previous_commit=$(git -C "$repo" rev-parse HEAD)
previous_branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD || true)
main_pid=$(systemctl show "$unit" --property=MainPID --value)

# The service's inherited DATABASE_PATH takes precedence over the local dotenv
# setting, matching the application's dotenv behavior. Never print credentials.
database_path=$(node --input-type=module - "$main_pid" <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
const runtime = readFileSync(`/proc/${process.argv[2]}/environ`, 'utf8').split('\0');
const databaseEntry = runtime.find((entry) => entry.startsWith('DATABASE_PATH='));
const local = existsSync('.env') ? parse(readFileSync('.env')) : {};
const configured = databaseEntry === undefined
  ? local.DATABASE_PATH ?? './data/neosoul.sqlite'
  : databaseEntry.slice('DATABASE_PATH='.length);
if (configured === ':memory:') throw new Error('A persistent database is required for deployment.');
const filename = path.resolve(configured);
if (!existsSync(filename)) throw new Error('The configured database does not exist; stop and verify its path.');
console.log(filename);
NODE
)
python3 - "$project" "$database_path" <<'PY'
import shutil
import sys
from pathlib import Path
if shutil.disk_usage(sys.argv[1]).free < 1024 ** 3 + 2 * Path(sys.argv[2]).stat().st_size:
    raise SystemExit('Not enough free disk space for a protected deployment backup.')
PY

backup_dir=$(mktemp -d /root/neosoul-content-bot-backup.XXXXXXXX)
printf '%s\n' "$previous_commit" > "$backup_dir/previous-commit"
printf '%s\n' "$database_path" > "$backup_dir/database-path"
# Copy instead of hard-linking: install scripts can rewrite native modules.
if [[ -d node_modules && ! -L node_modules ]]; then
  cp -a node_modules "$backup_dir/node_modules"
else
  printf '%s\n' 'The existing dependency directory needs manual inspection.' >&2
  exit 1
fi
if [[ -d dist && ! -L dist ]]; then
  cp -a dist "$backup_dir/dist"
elif [[ -e dist ]]; then
  printf '%s\n' 'The existing build directory needs manual inspection.' >&2
  exit 1
fi

complete=false
stopped=false
changed=false
rollback() {
  result=$?
  trap - EXIT
  if [[ "$complete" == true ]]; then return; fi
  set +e
  printf 'Deployment failed; backup: %s\n' "$backup_dir" >&2
  if [[ "$stopped" == true ]]; then
    systemctl stop "$unit"
    if [[ "$changed" == true ]]; then
      if [[ -n "$previous_branch" ]]; then
        git -C "$repo" checkout "$previous_branch"
      else
        git -C "$repo" checkout --detach "$previous_commit"
      fi
    fi
    if [[ -e node_modules ]]; then mv node_modules "$backup_dir/failed-node_modules"; fi
    mv "$backup_dir/node_modules" node_modules
    if [[ -e dist ]]; then mv dist "$backup_dir/failed-dist"; fi
    if [[ -d "$backup_dir/dist" ]]; then mv "$backup_dir/dist" dist; fi
    # Do not overwrite the live database: the additive table is backwards
    # compatible, and users might already have submitted new wallet records.
    if systemctl start "$unit"; then
      printf '%s\n' 'Original service restarted. Inspect its journal to confirm readiness.' >&2
    else
      printf '%s\n' 'Original service could not restart; inspect its journal and the backup.' >&2
    fi
  fi
  if [[ $result == 0 ]]; then result=1; fi
  exit "$result"
}
trap rollback EXIT

stopped=true
systemctl stop "$unit"
python3 - "$database_path" "$backup_dir/database.sqlite" <<'PY'
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote
source_path = Path(sys.argv[1])
with sqlite3.connect('file:' + quote(str(source_path)) + '?mode=ro', uri=True) as source:
    if source.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise SystemExit('Database integrity check failed.')
    with sqlite3.connect(sys.argv[2]) as destination:
        source.backup(destination)
Path(sys.argv[2]).chmod(0o600)
print('SQLite backup completed.')
PY

changed=true
git -C "$repo" checkout --detach "$release"
CI=true pnpm install --frozen-lockfile --prod=false
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=384" pnpm run build
# Run serially to fit the Droplet's 1 GiB RAM. The real database stays untouched.
DISCORD_TOKEN=test DISCORD_CLIENT_ID=test DATABASE_PATH=:memory: \
  node --import tsx --test --test-concurrency=1 tests/*.test.ts

started_at=$(date '+%Y-%m-%d %H:%M:%S')
systemctl start "$unit"
ready=false
for _ in $(seq 1 45); do
  journal=$(journalctl -u "$unit" --since "$started_at" --no-pager -n 100)
  if [[ "$journal" == *'Discord client ready as '* && "$journal" == *'global slash commands.'* ]] \
    && systemctl is-active --quiet "$unit"; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  printf '%s\n' 'Updated service did not reach authenticated Discord readiness.' >&2
  exit 1
fi
complete=true
printf 'Deployment connected to Discord. Backup: %s\n' "$backup_dir"
printf '%s\n' "$journal" | grep -E 'Registered [0-9]+ global slash commands|Discord client ready as'
printf '%s\n' 'Next: test /bind-wallet, /my-wallet and administrator /export-wallets in Discord.'
