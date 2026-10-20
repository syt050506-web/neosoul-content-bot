import copy
import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("cleanup", Path(__file__).with_name("clear-discord-bots.py"))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class FakeAPI:
    def __init__(self, permission=2, actor_position=100):
        self.changes = []
        self.guild_name = cleanup.GUILD_NAME
        self.roles = [
            {"id": cleanup.GUILD, "position": 0, "permissions": "0"},
            {"id": "10", "position": actor_position, "permissions": str(permission), "tags": {"bot_id": cleanup.ACTOR}},
            {"id": "20", "position": 20, "permissions": "8", "tags": {"bot_id": "200"}},
            {"id": "30", "position": 10, "permissions": "0", "tags": {"bot_id": "300"}},
        ]
        self.members = {
            cleanup.ACTOR: {"user": {"id": cleanup.ACTOR, "bot": True, "username": "Cleanup Bot"}, "roles": ["10"]},
            "200": {"user": {"id": "200", "bot": True, "username": "Third Party Bot"}, "roles": ["20"]},
            "300": {"user": {"id": "300", "bot": False, "username": "Human"}, "roles": ["30"]},
        }
        self.add_concurrent_bot = False

    def __call__(self, path, method="GET"):
        if method == "DELETE":
            self.changes.append(path)
            if path == "/users/@me/guilds/" + cleanup.GUILD:
                self.members.pop(cleanup.ACTOR)
                return
            identifier = path.rsplit("/", 1)[1]
            self.members.pop(identifier)
            if self.add_concurrent_bot:
                self.roles.append({"id": "40", "position": 5, "permissions": "0", "tags": {"bot_id": "400"}})
                self.members["400"] = {"user": {"id": "400", "bot": True, "username": "New Bot"}, "roles": ["40"]}
            return
        if path == "/users/@me":
            return copy.deepcopy(self.members[cleanup.ACTOR]["user"])
        if path == "/guilds/" + cleanup.GUILD:
            return {"id": cleanup.GUILD, "name": self.guild_name}
        if path.endswith("/roles"):
            return copy.deepcopy(self.roles)
        identifier = path.rsplit("/", 1)[1]
        if identifier not in self.members:
            raise cleanup.APIError(404)
        return copy.deepcopy(self.members[identifier])


class CommunityCleanupTests(unittest.TestCase):
    def test_only_bot_accounts_are_removed_and_actor_leaves_last(self):
        api = FakeAPI()
        with redirect_stdout(io.StringIO()):
            result = cleanup.cleanup(api, apply=True)
        self.assertTrue(result["complete"])
        self.assertEqual(api.changes, ["/guilds/" + cleanup.GUILD + "/members/200", "/users/@me/guilds/" + cleanup.GUILD])
        self.assertIn("300", api.members)

    def test_no_kick_permission_preserves_actor_and_targets(self):
        api = FakeAPI(permission=0)
        result = cleanup.cleanup(api, apply=True)
        self.assertFalse(result["complete"])
        self.assertEqual(api.changes, [])
        self.assertIn(cleanup.ACTOR, api.members)

    def test_administrator_cannot_bypass_role_hierarchy(self):
        api = FakeAPI(permission=8, actor_position=1)
        result = cleanup.cleanup(api, apply=True)
        self.assertFalse(result["complete"])
        self.assertEqual(api.changes, [])

    def test_wrong_community_identity_stops_all_mutation(self):
        api = FakeAPI()
        api.guild_name = "Different Community"
        with self.assertRaises(RuntimeError):
            cleanup.cleanup(api, apply=True)
        self.assertEqual(api.changes, [])

    def test_preview_never_removes_members(self):
        api = FakeAPI()
        result = cleanup.cleanup(api)
        self.assertFalse(result["applied"])
        self.assertEqual(api.changes, [])

    def test_new_bot_detected_before_final_leave(self):
        api = FakeAPI()
        api.add_concurrent_bot = True
        with redirect_stdout(io.StringIO()):
            result = cleanup.cleanup(api, apply=True)
        self.assertFalse(result["complete"])
        self.assertIn(cleanup.ACTOR, api.members)
        self.assertEqual(result["remaining_bots"], [{"id": "400", "name": "New Bot"}])


if __name__ == "__main__":
    unittest.main()
