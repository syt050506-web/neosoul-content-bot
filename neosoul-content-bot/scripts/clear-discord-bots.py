"""Remove bot accounts from the explicitly identified NeoSoul community only."""

import argparse
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

GUILD = "1482307119498920012"
GUILD_NAME = "NeoSoul_Official"
ACTOR = "1526358869046198513"


class APIError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__("Discord API returned HTTP " + str(status))


class API:
    def __init__(self, token):
        self.token = token

    def __call__(self, path, method="GET"):
        for attempt in range(6):
            request = urllib.request.Request(
                "https://discord.com/api/v10" + path,
                method=method,
                headers={
                    "Authorization": "Bot " + self.token,
                    "User-Agent": "DiscordBot (https://github.com/syt050506-web/neosoul-content-bot, 1.0)",
                    "X-Audit-Log-Reason": urllib.parse.quote("Community bot cleanup requested by the community administrator"),
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    return json.load(response) if response.status != 204 else None
            except urllib.error.HTTPError as error:
                if error.code != 429:
                    raise APIError(error.code) from None
                try:
                    wait = float(json.load(error).get("retry_after", 2))
                except (ValueError, TypeError):
                    wait = 2
                if not 0 <= wait <= 60:
                    raise RuntimeError("Discord requested a longer rate-limit wait")
                print("Respecting Discord rate limit; waiting seconds:", round(wait + 0.2, 2), flush=True)
                time.sleep(wait + 0.2)
        raise RuntimeError("Discord remained rate limited")


def snapshot(api):
    roles = {role["id"]: role for role in api("/guilds/" + GUILD + "/roles")}
    identifiers = {role.get("tags", {}).get("bot_id") for role in roles.values()}
    bots = {}
    for identifier in sorted(value for value in identifiers if value):
        try:
            member = api("/guilds/" + GUILD + "/members/" + identifier)
        except APIError as error:
            if error.status == 404:
                continue
            raise
        if member.get("user", {}).get("bot") is True and member["user"]["id"] == identifier:
            bots[identifier] = member
    return roles, bots


def rank(member, roles):
    return max((roles[key]["position"], -int(key)) for key in [GUILD, *member["roles"]] if key in roles)


def can_kick(member, roles):
    permissions = 0
    for key in [GUILD, *member["roles"]]:
        permissions |= int(roles.get(key, {}).get("permissions", "0"))
    return bool(permissions & (2 | 8))


def cleanup(api, apply=False, save=lambda report: None):
    own = api("/users/@me")
    guild = api("/guilds/" + GUILD)
    if own.get("id") != ACTOR or own.get("bot") is not True:
        raise RuntimeError("The cleanup account identity differs; no removal performed")
    if guild.get("id") != GUILD or guild.get("name") != GUILD_NAME:
        raise RuntimeError("The target community identity differs; no removal performed")
    roles, bots = snapshot(api)
    if ACTOR not in bots:
        raise RuntimeError("The cleanup bot is not a community member")
    targets = {key: member for key, member in bots.items() if key != ACTOR}
    permission = can_kick(bots[ACTOR], roles)
    report = {"guild_id": GUILD, "guild_name": GUILD_NAME, "actor_id": ACTOR,
              "can_kick": permission, "removed": [], "blocked": [], "complete": False,
              "initial_bot_count": len(bots), "applied": apply}
    for identifier, member in targets.items():
        if not permission or rank(bots[ACTOR], roles) <= rank(member, roles):
            report["blocked"].append({"id": identifier, "name": member["user"]["username"], "reason": "missing kick permission or role hierarchy"})
            continue
        if not apply:
            continue
        try:
            # Revalidate the actual account immediately before removal. Human
            # members are never selected or passed to the removal endpoint.
            current = api("/guilds/" + GUILD + "/members/" + identifier)
            if current.get("user", {}).get("bot") is not True or current["user"]["id"] != identifier:
                raise RuntimeError("Target account identity changed")
            api("/guilds/" + GUILD + "/members/" + identifier, "DELETE")
            report["removed"].append({"id": identifier, "name": member["user"]["username"]})
            save(report)
            print("Removed bot:", member["user"]["username"], flush=True)
        except APIError as error:
            if error.status == 404:
                continue
            report["blocked"].append({"id": identifier, "name": member["user"]["username"], "http_status": error.status})
    if not apply:
        return report
    _, remaining = snapshot(api)
    others = [key for key in remaining if key != ACTOR]
    if others:
        report["remaining_bots"] = [{"id": key, "name": remaining[key]["user"]["username"]} for key in others]
        save(report)
        return report
    report["verified_other_bot_count_before_final_leave"] = 0
    save(report)
    api("/users/@me/guilds/" + GUILD, "DELETE")
    report["actor_left"] = True
    report["complete"] = True
    save(report)
    print("All other bot accounts verified absent; cleanup bot left last.", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    entries = json.loads(Path(arguments.credentials).read_text())
    actor = next(entry for entry in entries if entry.get("bot_id") == ACTOR)
    destination = Path(arguments.report)

    def save(report):
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)

    result = cleanup(API(actor["token"]), arguments.apply, save)
    save(result)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Community cleanup stopped:", str(error), flush=True)
        raise SystemExit(1)
