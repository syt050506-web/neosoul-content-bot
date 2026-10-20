#!/usr/bin/env python3
"""Root-console installer template; build_wallet_installer.py embeds the release.

No production credentials belong in this file or its generated release.
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import io
import json
import os
import pwd
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

APP_ID = "1562040739838435328"
GUILD_ID = "1482307119498920012"
INVITE = (
    f"https://discord.com/oauth2/authorize?client_id={APP_ID}"
    f"&permissions=117760&scope=bot%20applications.commands&guild_id={GUILD_ID}"
    "&disable_guild_select=true"
)
APP = Path("/opt/neosoul-wallet")
STATE = Path("/var/lib/neosoul-wallet")
ENV = Path("/etc/neosoul-wallet.env")
UNITS = Path("/etc/systemd/system")
ACCOUNT = "neosoul-wallet"
UNIT_NAMES = (
    "neosoul-wallet.service",
    "neosoul-wallet-backup.service",
    "neosoul-wallet-backup.timer",
)
COMMANDS = {
    "wallet",
    "wallet-panel",
    "wallet-export",
    "wallet-open",
    "wallet-alerts",
    "wallet-reset",
    "wallet-status",
}
PAYLOAD_B64 = "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"
PAYLOAD_SHA256 = "dd7ec5d25ccd00b41993832a6f0286e64ffc4cd2b16f92efdfd4aa8d0632c1f4"
MAX_ARCHIVE_BYTES = 2_000_000
MARKER = ".wallet-install.json"


class InstallError(Exception):
    pass


def validate_token(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{30,256}", value):
        raise InstallError("Token 格式不正确。请使用新应用 Bot 页面的 Token。")
    return value


def verify_identity(identity: dict) -> None:
    if str(identity.get("id")) != APP_ID or identity.get("bot") is not True:
        raise InstallError("Token 不属于新建的 NeoSoul Wallet，未执行安装。")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class Discord:
    def __init__(self, token: str):
        self.token = validate_token(token)
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method: str, path: str, body=None):
        if not re.fullmatch(r"/[A-Za-z0-9/@_-]+", path):
            raise InstallError("无效的 Discord API 路径。")
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            "https://discord.com/api/v10" + path,
            data=data,
            headers={
                "Authorization": "Bot " + self.token,
                "Content-Type": "application/json",
                "User-Agent": "DiscordBot (https://github.com/syt050506-web/Discord-NeoSoul-Bot, 1.0)",
            },
            method=method,
        )
        for attempt in range(3):
            try:
                with self.opener.open(request, timeout=20) as response:
                    raw = response.read(2_000_000)
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 2:
                    try:
                        delay = float(json.loads(error.read(4096))["retry_after"])
                    except (ValueError, KeyError, TypeError):
                        delay = 2
                    time.sleep(min(max(delay, 1), 10))
                    continue
                # Never include request headers, body or a raw exception with secrets.
                raise InstallError(
                    f"Discord {method} {path} 返回 HTTP {error.code}。"
                ) from None
            except (OSError, ValueError):
                raise InstallError("连接 Discord 失败，请稍后重试安装命令。") from None
        raise InstallError("Discord 请求暂时受限，请稍后重试。")


def unpack_release(encoded: str, digest: str) -> dict[str, bytes]:
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError:
        raise InstallError("安装包编码无效。") from None
    if not digest or hashlib.sha256(raw).hexdigest() != digest:
        raise InstallError("安装包校验失败，未写入系统。")
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            allowed = (
                len(path.parts) == 2
                and path.parts[0] == "wallet_collector"
                and path.suffix == ".py"
            ) or member.name in {
                "requirements-wallet.txt",
                ".env.wallet.example",
                "docs/wallet-collector.zh-CN.md",
                "tests/test_wallet_bot.py",
                "tests/test_wallet_store.py",
                *("deploy/" + name for name in UNIT_NAMES),
            }
            if (
                not member.isfile()
                or path.is_absolute()
                or ".." in path.parts
                or not allowed
                or member.name in files
                or member.size > MAX_ARCHIVE_BYTES
            ):
                raise InstallError("安装包包含不允许的路径或文件类型。")
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                raise InstallError("安装包超过预期大小。")
            stream = archive.extractfile(member)
            if stream is None:
                raise InstallError("安装包缺少文件内容。")
            files[member.name] = stream.read()
    required = {
        "wallet_collector/__main__.py",
        "wallet_collector/store.py",
        "wallet_collector/presentation.py",
        "requirements-wallet.txt",
        *("deploy/" + name for name in UNIT_NAMES),
    }
    if not required <= files.keys():
        raise InstallError("安装包缺少运行文件。")
    return files


def assert_safe_path(path: Path) -> None:
    for part in (path, *path.parents):
        if part.is_symlink():
            raise InstallError(f"拒绝符号链接路径：{path}")
        if part.exists():
            info = part.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise InstallError(f"路径非 root 专用或可被其他用户改写：{part}")


def read_marker(app: Path, digest: str) -> dict | None:
    assert_safe_path(app)
    if not app.exists():
        return None
    marker = app / MARKER
    assert_safe_path(marker)
    if not marker.is_file():
        raise InstallError("目标目录已存在且不是此安装向导创建的，已保留原内容。")
    try:
        data = json.loads(marker.read_text())
    except (ValueError, OSError):
        raise InstallError("安装标记损坏，已停止。") from None
    if data.get("application_id") != APP_ID or data.get("package_sha256") != digest:
        raise InstallError("目标目录属于其他应用或版本，已停止。")
    return data


def atomic_write(path: Path, data: bytes, mode: int) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".wallet-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def save_marker(data: dict) -> None:
    atomic_write(APP / MARKER, json.dumps(data, indent=2).encode(), 0o600)


def environment(token: str) -> bytes:
    token = validate_token(token)
    return (
        f"WALLET_DISCORD_TOKEN={token}\nWALLET_GUILD_ID={GUILD_ID}\n"
        f"WALLET_APPLICATION_ID={APP_ID}\n"
        f"WALLET_DATABASE_PATH={STATE}/wallets.sqlite3\nLOG_LEVEL=INFO\n"
    ).encode()


def permissions(channel: dict, guild: dict, roles: list, member: dict) -> int:
    role_ids = set(member["roles"]) | {GUILD_ID}
    result = 0
    for role in roles:
        if role["id"] in role_ids:
            result |= int(role["permissions"])
    if result & 8 or guild.get("owner_id") == APP_ID:
        return (1 << 53) - 1
    overwrites = channel.get("permission_overwrites", [])
    for overwrite in overwrites:
        if overwrite["id"] == GUILD_ID and overwrite["type"] == 0:
            result = (result & ~int(overwrite["deny"])) | int(overwrite["allow"])
    allow = deny = 0
    for overwrite in overwrites:
        if overwrite["type"] == 0 and overwrite["id"] in role_ids - {GUILD_ID}:
            deny |= int(overwrite["deny"])
            allow |= int(overwrite["allow"])
    result = (result & ~deny) | allow
    for overwrite in overwrites:
        if overwrite["type"] == 1 and overwrite["id"] == APP_ID:
            result = (result & ~int(overwrite["deny"])) | int(overwrite["allow"])
    return result


def select_channel(channels: list[dict], choice: str) -> dict:
    choice = choice.strip().strip("<#>")
    if choice.isdecimal() and 1 <= int(choice) <= len(channels):
        return channels[int(choice) - 1]
    matches = [
        item for item in channels if item["id"] == choice or item["name"] == choice
    ]
    if len(matches) != 1:
        raise InstallError("未选中唯一有效的活动频道，请重跑并选择列表编号或频道 ID。")
    return matches[0]


def run(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if result.returncode:
        # Only executable name and code: subprocess output can contain env/config.
        raise InstallError(f"{Path(args[0]).name} 执行失败（{result.returncode}）。")
    return result.stdout


def preflight(files: dict, marker: dict | None) -> None:
    for path in (ENV, UNITS):
        assert_safe_path(path)
    if ENV.exists() and marker is None:
        raise InstallError("钱包配置已经存在，未覆盖。")
    for name in UNIT_NAMES:
        path = UNITS / name
        assert_safe_path(path)
        if path.exists() and (
            marker is None or path.read_bytes() != files["deploy/" + name]
        ):
            raise InstallError(f"已有不同的 {name}，未覆盖。")
    # The dedicated state directory can be service-owned only on our own resume.
    assert_safe_path(STATE.parent)
    if STATE.is_symlink() or (STATE.exists() and marker is None):
        raise InstallError("钱包数据目录已存在或为链接，未更改。")
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        account = None
    if account is not None and (
        marker is None
        or account.pw_uid == 0
        or account.pw_dir != str(STATE)
        or not account.pw_shell.endswith("/nologin")
    ):
        raise InstallError("同名系统用户已存在且不能确认归属，已停止。")
    if STATE.exists():
        info = STATE.stat()
        if (
            not STATE.is_dir()
            or info.st_uid not in (0, account.pw_uid if account else 0)
            or info.st_mode & 0o077
        ):
            raise InstallError("数据目录权限或归属异常，已停止。")


def publish_panel(api: Discord, store, channel_id: str, marker: dict, payload: dict):
    current = store.settings()
    channel_id = str(current["channel_id"] or channel_id)
    message_id = current["message_id"] or marker.get("message_id")
    if message_id:
        message = api.request("GET", f"/channels/{channel_id}/messages/{message_id}")
        if message.get("author", {}).get("id") != APP_ID:
            raise InstallError("已记录的面板不属于本机器人，已停止。")
    else:
        # A stable nonce prevents immediate duplicate creates if the HTTP reply is lost.
        payload = dict(payload, nonce=str(int(APP_ID) + 1), enforce_nonce=True)
        message = api.request("POST", f"/channels/{channel_id}/messages", payload)
        message_id = message["id"]
        marker.update(channel_id=channel_id, message_id=message_id)
        save_marker(marker)
    try:
        store.set_panel(int(channel_id), int(message_id))
    except (sqlite3.Error, OSError, ValueError):
        # Retain the saved message ID for an idempotent resume, without deleting data.
        raise InstallError("面板已创建但数据库保存失败，请重跑安装命令恢复。") from None
    return channel_id, str(message_id)


def check_ready(api: Discord, since: str) -> None:
    for _ in range(40):
        active = (
            subprocess.run(
                ["systemctl", "is-active", "--quiet", UNIT_NAMES[0]],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode
            == 0
        )
        journal = run(
            "journalctl",
            "-u",
            UNIT_NAMES[0],
            "--since",
            since,
            "--no-pager",
            "-o",
            "cat",
        )
        if active and "Wallet collector ready in guild" in journal:
            names = {
                command["name"]
                for command in api.request(
                    "GET", f"/applications/{APP_ID}/guilds/{GUILD_ID}/commands"
                )
            }
            if COMMANDS <= names:
                return
        time.sleep(1)
    raise InstallError("服务未通过 Discord 就绪检查；配置和数据已保留，请重跑检查。")


def main() -> None:
    os.umask(0o077)
    if os.geteuid() != 0 or not shutil.which("systemctl"):
        raise InstallError(
            "请在 DigitalOcean 的 Ubuntu root 控制台运行，不是在 Mac 终端。"
        )
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise InstallError("需要交互式服务器控制台，Token 将隐藏输入。")
    files = unpack_release(PAYLOAD_B64, PAYLOAD_SHA256)
    marker = read_marker(APP, PAYLOAD_SHA256)
    preflight(files, marker)
    if marker and marker.get("complete"):
        print("此版本已安装；未覆盖配置、数据或面板。")
        print("运行状态：" + run("systemctl", "is-active", UNIT_NAMES[0]).strip())
        print(
            f"面板：https://discord.com/channels/{GUILD_ID}/{marker['channel_id']}/{marker['message_id']}"
        )
        return
    print(f"NeoSoul Wallet 安装向导 · 应用 {APP_ID}", flush=True)
    api = Discord(getpass.getpass("粘贴新应用的 Bot Token（隐藏输入，不会显示）："))
    verify_identity(api.request("GET", "/users/@me"))
    try:
        guild = api.request("GET", f"/guilds/{GUILD_ID}")
    except InstallError:
        raise InstallError(
            "新机器人尚未加入目标社区，或访问失败。先完成邀请后重跑：\n" + INVITE
        ) from None
    channels = api.request("GET", f"/guilds/{GUILD_ID}/channels")
    roles = api.request("GET", f"/guilds/{GUILD_ID}/roles")
    member = api.request("GET", f"/guilds/{GUILD_ID}/members/{APP_ID}")
    channels = [
        item
        for item in channels
        if item["type"] in (0, 5)
        and permissions(item, guild, roles, member) & 117760 == 117760
    ]
    channels.sort(key=lambda item: (item.get("position", 0), item["name"]))
    if marker and marker.get("channel_id"):
        channel = select_channel(channels, marker["channel_id"])
    else:
        if not channels:
            raise InstallError(
                "没有可用文字频道；请允许机器人查看、发送消息、嵌入链接、附件及读取历史。"
            )
        print("选择发布 Submit Wallet 按钮的活动频道：", flush=True)
        for index, channel in enumerate(channels, 1):
            print(f"  {index}. #{channel['name']} ({channel['id']})")
        channel = select_channel(channels, input("输入列表编号或频道 ID："))
    if marker is None:
        APP.mkdir(mode=0o755)
        APP.chmod(0o755)
        marker = {
            "application_id": APP_ID,
            "package_sha256": PAYLOAD_SHA256,
            "complete": False,
        }
    marker["channel_id"] = channel["id"]
    save_marker(marker)
    if (
        subprocess.run(
            ["systemctl", "is-active", "--quiet", UNIT_NAMES[0]],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    ):
        # Stop only an incomplete instance owned by this exact installer.
        run("systemctl", "stop", UNIT_NAMES[0])
    for name, content in files.items():
        destination = APP / name
        assert_safe_path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        destination.parent.chmod(0o755)
        atomic_write(destination, content, 0o644)
    print("安装独立 Python 环境和依赖……", flush=True)
    private_umask = os.umask(0o022)
    try:
        if not (APP / ".venv/bin/python").exists():
            run("python3", "-m", "venv", str(APP / ".venv"))
        python = str(APP / ".venv/bin/python")
        run(
            python,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(APP / "requirements-wallet.txt"),
        )
    finally:
        os.umask(private_umask)
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        run(
            "useradd",
            "--system",
            "--user-group",
            "--home-dir",
            str(STATE),
            "--shell",
            "/usr/sbin/nologin",
            ACCOUNT,
        )
        account = pwd.getpwnam(ACCOUNT)
    STATE.mkdir(mode=0o700, exist_ok=True)
    if STATE.is_symlink():
        raise InstallError("拒绝链接数据目录。")
    STATE.chmod(0o700)
    backups = STATE / "backups"
    if backups.is_symlink():
        raise InstallError("拒绝链接备份目录。")
    backups.mkdir(mode=0o700, exist_ok=True)
    backups.chmod(0o700)
    sys.path.insert(0, str(APP))
    from wallet_collector.presentation import panel_message
    from wallet_collector.store import Store

    database = STATE / "wallets.sqlite3"
    for suffix in ("", "-wal", "-shm"):
        if Path(str(database) + suffix).is_symlink():
            raise InstallError("拒绝链接数据库。")
    store = Store(database, int(GUILD_ID))
    store.initialize()
    atomic_write(ENV, environment(api.token), 0o600)
    for name in UNIT_NAMES:
        atomic_write(UNITS / name, files["deploy/" + name], 0o644)
    run("systemctl", "daemon-reload")
    channel_id, message_id = publish_panel(
        api, store, channel["id"], marker, panel_message()
    )
    for path in (
        STATE,
        backups,
        database,
        Path(str(database) + "-wal"),
        Path(str(database) + "-shm"),
    ):
        if path.exists():
            os.chown(path, account.pw_uid, account.pw_gid)
    print("连接 Discord 并检查指令、持久化及备份……", flush=True)
    since = str(int(time.time()))
    # Journal accepts @epoch; use a fresh invocation timestamp, not earlier ready lines.
    run("systemctl", "enable", "--now", UNIT_NAMES[0])
    check_ready(api, "@" + since)
    run("systemctl", "start", UNIT_NAMES[1])
    run("systemctl", "enable", "--now", UNIT_NAMES[2])
    if run("systemctl", "is-active", UNIT_NAMES[2]).strip() != "active":
        raise InstallError("备份定时器未激活。")
    api.request("GET", f"/channels/{channel_id}/messages/{message_id}")
    marker.update(complete=True, channel_id=channel_id, message_id=message_id)
    save_marker(marker)
    print(
        "✅ NeoSoul Wallet 已连接 Discord，7 条指令就绪，活动按钮已发布，独立持久化和每日备份已启用。"
    )
    print(
        f"活动面板：https://discord.com/channels/{GUILD_ID}/{channel_id}/{message_id}"
    )
    print(
        "管理员使用 /wallet-status 检查状态，/wallet-export 导出。请用自己的账号试提交一条地址。"
    )


if __name__ == "__main__":
    try:
        main()
    except (InstallError, OSError, ValueError, tarfile.TarError) as error:
        # Expected errors above contain no request headers or credential values.
        print(f"安装未完成：{error}", file=sys.stderr, flush=True)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print("已取消；已有数据保留。", file=sys.stderr)
        sys.exit(1)
