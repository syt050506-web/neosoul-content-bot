#!/usr/bin/env python3
"""Self-contained language-only update for the existing production Pulse service.

Build with build_pulse_english_update.py. Credentials stay on the server.
"""

from __future__ import annotations

import base64
import fcntl
import gzip
import hashlib
import json
import os
import re
import shlex
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

APP = Path("/opt/dna-pulse")
DATABASE = Path("/var/lib/dna-pulse/pulse.sqlite3")
ENVIRONMENT = Path("/etc/dna-pulse.env")
UNIT = "dna-pulse.service"
APP_ID = "1529862783976341556"
GUILD_ID = "1482307119498920012"
FILES = frozenset({"pulse/bot.py", "pulse/rules.py", "pulse/store.py"})
COMMANDS = frozenset(
    {
        "pulse",
        "pulse-export",
        "pulse-backfill",
        "pulse-channel",
        "pulse-role",
        "pulse-status",
    }
)
PAYLOAD_B64 = "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"
PAYLOAD_SHA256 = "1dc2deccab38b4dcefb7ac8495f8da5a2ef8d44989bb2fef31eee5f5f76d9c28"


class UpdateError(Exception):
    pass


def load_payload(encoded: str, digest: str) -> dict:
    try:
        compressed = base64.b64decode(encoded, validate=True)
        if hashlib.sha256(compressed).hexdigest() != digest:
            raise UpdateError("Release checksum mismatch; no files were changed.")
        data = json.loads(gzip.decompress(compressed))
        if set(data) != FILES:
            raise UpdateError("Unexpected release paths; no files were changed.")
        for name, entry in data.items():
            content = base64.b64decode(entry["content"], validate=True)
            if hashlib.sha256(content).hexdigest() != entry["sha256"]:
                raise UpdateError("Source checksum mismatch.")
            if not re.fullmatch(r"[0-9a-f]{64}", entry["previous_sha256"]):
                raise UpdateError("Missing known production version checksum.")
            source = content.decode("utf-8")
            if re.search(r"[\u3400-\u9fff]", source):
                raise UpdateError("Release still contains untranslated Pulse UI text.")
            compile(source, name, "exec")
            entry["bytes"] = content
        return data
    except (KeyError, ValueError, TypeError, OSError, SyntaxError):
        raise UpdateError("Invalid embedded release; no files were changed.") from None


def run(*args: str) -> str:
    try:
        result = subprocess.run(
            args, check=False, capture_output=True, text=True, timeout=45
        )
    except (OSError, subprocess.TimeoutExpired):
        raise UpdateError(f"{Path(args[0]).name} could not complete.") from None
    if result.returncode:
        raise UpdateError(f"{Path(args[0]).name} failed (exit {result.returncode}).")
    return result.stdout.strip()


def check_paths(payload: dict) -> dict:
    originals = {}
    for name in FILES:
        path = APP / name
        if (
            any(parent.is_symlink() for parent in (path, *path.parents))
            or not path.is_file()
        ):
            raise UpdateError(f"Unexpected installed source path: {name}.")
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest not in (payload[name]["previous_sha256"], payload[name]["sha256"]):
            raise UpdateError(
                f"Installed {name} differs from the supported release; no files were changed."
            )
        info = path.stat()
        originals[name] = {
            "bytes": raw,
            "mode": stat.S_IMODE(info.st_mode),
            "uid": info.st_uid,
            "gid": info.st_gid,
        }
    if DATABASE.is_symlink() or not DATABASE.is_file() or ENVIRONMENT.is_symlink():
        raise UpdateError(
            "The existing Pulse database or configuration is missing or is a symbolic link."
        )
    return originals


def read_credentials() -> str:
    info = ENVIRONMENT.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise UpdateError(
            "The existing environment file must be a private root-owned regular file."
        )
    values = {}
    for line in ENVIRONMENT.read_text().splitlines():
        name, separator, value = line.strip().partition("=")
        if separator and name in ("DISCORD_TOKEN", "PULSE_GUILD_ID"):
            parts = shlex.split(value, comments=True)
            if len(parts) != 1:
                raise UpdateError("Unsupported existing environment configuration.")
            values[name] = parts[0]
    token = values.get("DISCORD_TOKEN", "")
    if values.get("PULSE_GUILD_ID") != GUILD_ID or not re.fullmatch(
        r"[A-Za-z0-9._-]{30,256}", token
    ):
        raise UpdateError(
            "Existing Pulse configuration does not match the configured community."
        )
    return token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class Discord:
    def __init__(self, token: str):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, path: str):
        if not re.fullmatch(r"/[A-Za-z0-9/@_-]+", path):
            raise UpdateError("Invalid API path.")
        request = urllib.request.Request(
            "https://discord.com/api/v10" + path,
            headers={
                "Authorization": "Bot " + self.token,
                "User-Agent": "DiscordBot (https://github.com/syt050506-web/Discord-NeoSoul-Bot, 1.0)",
            },
        )
        try:
            with self.opener.open(request, timeout=15) as response:
                return json.loads(response.read(2_000_000))
        except urllib.error.HTTPError as error:
            raise UpdateError(
                f"Discord verification returned HTTP {error.code}."
            ) from None
        except (OSError, ValueError):
            raise UpdateError("Discord verification could not complete.") from None


def verify_identity(api: Discord) -> None:
    identity = api.get("/users/@me")
    if str(identity.get("id")) != APP_ID or identity.get("bot") is not True:
        raise UpdateError(
            "The configured token does not belong to NeoSoul Pulse; update aborted."
        )


def command_text_is_english(commands: list) -> bool:
    if {item["name"] for item in commands} != COMMANDS:
        return False

    def english(item):
        text = item.get("description", "")
        return (
            bool(text)
            and not re.search(r"[\u3400-\u9fff]", text)
            and all(english(option) for option in item.get("options", []))
        )

    return all(english(item) for item in commands)


def database_fingerprint() -> str:
    connection = sqlite3.connect(DATABASE.as_uri() + "?mode=ro", uri=True, timeout=10)
    try:
        connection.execute("BEGIN")
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if (
            not {
                "pulse_meta",
                "pulse_users",
                "pulse_days",
                "pulse_messages",
                "pulse_channels",
                "pulse_roles",
            }
            <= tables
        ):
            raise UpdateError(
                "The configured database is not the existing Pulse database."
            )
        guilds = {
            str(row[0])
            for row in connection.execute(
                "SELECT guild_id FROM pulse_users UNION SELECT guild_id FROM pulse_channels UNION SELECT guild_id FROM pulse_roles"
            )
        }
        if guilds - {GUILD_ID}:
            raise UpdateError(
                "The existing database contains another community's records."
            )
        digest = hashlib.sha256()
        for line in connection.iterdump():
            digest.update(line.encode())
            digest.update(b"\n")
        return digest.hexdigest()
    finally:
        connection.close()


def backup_database(destination: Path) -> None:
    source = sqlite3.connect(DATABASE.as_uri() + "?mode=ro", uri=True, timeout=10)
    copy = sqlite3.connect(destination)
    try:
        source.backup(copy)
        if copy.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise UpdateError("Pre-update backup failed integrity verification.")
    finally:
        copy.close()
        source.close()
    destination.chmod(0o600)


def atomic_source(name: str, data: bytes, previous: dict) -> None:
    target = APP / name
    fd, temporary = tempfile.mkstemp(prefix=".pulse-language-", dir=target.parent)
    try:
        os.fchmod(fd, previous["mode"])
        os.fchown(fd, previous["uid"], previous["gid"])
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def wait_ready(api: Discord, since: str) -> None:
    for _ in range(35):
        active = (
            subprocess.run(
                ["systemctl", "is-active", "--quiet", UNIT],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode
            == 0
        )
        journal = run(
            "journalctl", "-u", UNIT, "--since", since, "--no-pager", "-o", "cat"
        )
        if active and f"DNA Pulse ready in guild {GUILD_ID}" in journal:
            commands = api.get(f"/applications/{APP_ID}/guilds/{GUILD_ID}/commands")
            if command_text_is_english(commands):
                return
        time.sleep(1)
    raise UpdateError(
        "The service did not pass the Discord readiness and English command checks."
    )


def apply_update(
    payload: dict, originals: dict, api: Discord, backup_dir: Path
) -> None:
    for name, previous in originals.items():
        destination = backup_dir / Path(name).name
        destination.write_bytes(previous["bytes"])
        destination.chmod(0o600)
    stopped = False
    changed = False
    try:
        stopped = True
        run("systemctl", "stop", UNIT)
        before = database_fingerprint()
        backup_database(backup_dir / "pulse.sqlite3")
        for name in sorted(FILES):
            changed = True
            atomic_source(name, payload[name]["bytes"], originals[name])
        if database_fingerprint() != before:
            raise UpdateError("Database changed unexpectedly during the code update.")
        since = "@" + str(int(time.time()))
        run("systemctl", "start", UNIT)
        wait_ready(api, since)
    except BaseException:
        if stopped:
            if changed:
                run("systemctl", "stop", UNIT)
                for name, previous in originals.items():
                    atomic_source(name, previous["bytes"], previous)
            # Restore only code. Never overwrite the live database on rollback.
            run("systemctl", "start", UNIT)
        raise


def main() -> None:
    os.umask(0o077)
    if os.geteuid() != 0:
        raise UpdateError("Run this in the DigitalOcean Ubuntu root console.")
    payload = load_payload(PAYLOAD_B64, PAYLOAD_SHA256)
    originals = check_paths(payload)
    if run(
        "systemctl", "show", UNIT, "--property=User", "--value"
    ) != "dna-pulse" or run(
        "systemctl", "show", UNIT, "--property=WorkingDirectory", "--value"
    ) != str(APP):
        raise UpdateError(
            "The installed service does not match the dedicated Pulse deployment."
        )
    if run("systemctl", "is-active", UNIT) != "active":
        raise UpdateError(
            "Pulse is not currently active. Diagnose the existing service before updating."
        )
    api = Discord(read_credentials())
    verify_identity(api)
    database_fingerprint()
    if all(originals[name]["bytes"] == payload[name]["bytes"] for name in FILES):
        commands = api.get(f"/applications/{APP_ID}/guilds/{GUILD_ID}/commands")
        if command_text_is_english(commands):
            print("DNA Pulse is already running this English release.")
            return
    backup_dir = Path(tempfile.mkdtemp(prefix="dna-pulse-english-backup-", dir="/root"))
    print("Backing up Pulse and updating its English interface...", flush=True)
    print(f"Backup: {backup_dir}", flush=True)
    apply_update(payload, originals, api, backup_dir)
    print(
        "✅ DNA Pulse English update verified: service connected to Discord and all six command roots have English descriptions."
    )
    print(
        "Member/admin replies, completion DMs and CSV headers now use English. Existing progress, channel/role configuration and credentials are retained."
    )
    print("Use /pulse in the community to view the updated interface.")


if __name__ == "__main__":
    lock = None
    try:
        if os.geteuid() != 0:
            raise UpdateError("Run this in the DigitalOcean Ubuntu root console.")
        lock = os.open(
            "/run/lock/dna-pulse-english-update.lock",
            os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
            0o600,
        )
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        main()
    except BlockingIOError:
        print("Another Pulse English update is already running.", file=sys.stderr)
        sys.exit(1)
    except UpdateError as error:
        print(f"English update did not complete: {error}", file=sys.stderr)
        print(
            "Records were retained. Keep the backup path shown above for diagnosis.",
            file=sys.stderr,
        )
        sys.exit(1)
    except (OSError, sqlite3.Error, ValueError):
        # Never print raw configuration, credential values or request headers.
        print(
            "English update did not complete. Existing records were retained. Any changed code was rolled back where possible; keep the backup path shown above for diagnosis.",
            file=sys.stderr,
        )
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print("Update cancelled; the existing records were retained.", file=sys.stderr)
        sys.exit(1)
    finally:
        if lock is not None:
            os.close(lock)
