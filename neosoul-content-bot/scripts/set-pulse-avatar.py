"""Update only the deployed Pulse bot's avatar, using its local secure config.

Run with /opt/dna-pulse/.venv/bin/python. No service restart or SSH setup needed.
"""

import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

BOT_ID = "1529862783976341556"
ASSET_URL = (
    "https://raw.githubusercontent.com/syt050506-web/neosoul-content-bot/"
    "codex/retire-other-bots/neosoul-content-bot/assets/dna-pulse-avatar.png"
)
ASSET_SHA256 = "d621c5387426cba974a8aebd20e5e3ba10ce74519b13f9708b7b0472935c6d8c"
API_URL = "https://discord.com/api/v10/users/@me"
MAX_IMAGE_BYTES = 4 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError("Refusing to redirect an authenticated Discord request.")


def main():
    from dotenv import dotenv_values

    os.umask(0o077)
    config_path = Path("/etc/dna-pulse.env")
    state = Path("/var/lib/dna-pulse")
    if not config_path.is_file() or not state.is_dir():
        raise RuntimeError("DNA Pulse deployment not found; nothing was changed.")
    token = dotenv_values(config_path, interpolate=False).get("DISCORD_TOKEN")
    if not token:
        raise RuntimeError("The server's secure config has no Discord token.")
    opener = urllib.request.build_opener(NoRedirect())

    def discord_api(payload=None):
        request = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={
                "Authorization": "Bot " + token,
                "Content-Type": "application/json",
                "User-Agent": "NeoSoulPulseAvatar/1.0",
            },
            method="PATCH" if payload is not None else "GET",
        )
        with opener.open(request, timeout=30) as response:
            result = json.load(response)
        if str(result.get("id")) != BOT_ID or not result.get("bot"):
            raise RuntimeError("Unexpected bot identity; refusing further changes.")
        return result

    before = discord_api()
    with urllib.request.urlopen(ASSET_URL, timeout=30) as response:
        avatar = response.read(MAX_IMAGE_BYTES + 1)
    if len(avatar) > MAX_IMAGE_BYTES:
        raise RuntimeError("Avatar download exceeded the size limit.")
    if hashlib.sha256(avatar).hexdigest() != ASSET_SHA256:
        raise RuntimeError("Avatar checksum mismatch; nothing was changed.")
    if not avatar.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("Avatar is not the expected PNG image.")

    history = state / "avatar-history"
    history.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    record = {
        "bot_id": BOT_ID,
        "old_avatar": before.get("avatar"),
        "requested_sha256": ASSET_SHA256,
    }
    record_path = history / f"{stamp}.json"
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    (history / "dna-pulse-avatar.png").write_bytes(avatar)

    encoded = "data:image/png;base64," + base64.b64encode(avatar).decode("ascii")
    updated = discord_api({"avatar": encoded})
    verified = discord_api()
    if not updated.get("avatar") or verified.get("avatar") != updated["avatar"]:
        raise RuntimeError("Avatar update could not be verified; rerun to check.")
    record["new_avatar"] = verified["avatar"]
    record["verified_at"] = datetime.now(UTC).isoformat()
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    print("NeoSoul Pulse avatar updated and verified. No restart was needed.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        print(f"Discord/image request failed (HTTP {error.code}).", file=sys.stderr)
        sys.exit(1)
    except (OSError, RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
