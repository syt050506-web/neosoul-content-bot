"""Retire other bot deployments on the identified DigitalOcean Droplet."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import time

KEEP_UNIT = "neosoul-discord-bot.service"
KEEP_ROOT = Path("/root/NeoSoul-Discord-Bot")
REMOVE_UNITS = {"neosoul-bot.service", "neosoul-content-bot.service"}
REMOVE_ROOTS = (
    Path("/root/NeoSoul-Bot"),
    Path("/root/neosoul-content-bot"),
    Path("/root/EVOEVO-Guardian"),
    Path("/root/neosoul-content-bot-backup.bX5YiqFe"),
)


def run(arguments, check=True):
    return subprocess.run(arguments, text=True, capture_output=True, check=check)


def within(path, parent):
    return path == parent or parent in path.parents


def references(text, roots):
    return any(
        re.search(re.escape(str(root)) + r"(?=/|[:\s;}\]\"']|$)", text)
        for root in roots
    )


def properties(units, fields):
    output = run(
        ["systemctl", "show", "--no-pager", "--property=" + ",".join(fields), *units]
    ).stdout
    result = {}
    for block in output.strip().split("\n\n"):
        values = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        if values.get("Id"):
            result[values["Id"]] = values
    return result


def choose_units(records, roots):
    result = {}
    for name, record in records.items():
        if name == KEEP_UNIT:
            continue
        working = record.get("WorkingDirectory", "")
        execution = record.get("ExecStart", "")
        executables = re.findall(r"\bpath=([^ ;]+)", execution)
        runtime = any(
            Path(value).name in {"python", "python3", "node", "nodejs", "npm", "pnpm", "docker", "docker-compose", "bash", "sh", "env"}
            or Path(value).name.startswith("python3.")
            or references(value, roots)
            for value in executables
        )
        owned = references(working, roots) or (runtime and references(execution, roots))
        if name not in REMOVE_UNITS and not owned:
            continue
        if references(
            record.get("WorkingDirectory", "") + " " + record.get("ExecStart", ""),
            (KEEP_ROOT,),
        ):
            raise RuntimeError("A removal candidate also references the retained bot: " + name)
        result[name] = record
    return result


def guard_roots(roots):
    for root in roots:
        if root.is_symlink() or root.resolve() != root:
            raise RuntimeError("A removal directory is a symlink or alias: " + str(root))
        if within(root, KEEP_ROOT) or within(KEEP_ROOT, root):
            raise RuntimeError("Removal overlaps the retained bot: " + str(root))
        if not root.is_dir():
            raise RuntimeError("A removal path is not a directory: " + str(root))
        if (root / ".git").is_file():
            raise RuntimeError("Linked Git metadata needs a separate backup: " + str(root))
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        mount = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), line.split()[4])
        if any(within(Path(mount), root) for root in roots):
            raise RuntimeError("A removal directory contains a mount: " + mount)


def guard_keep_dependencies(record, roots, runtime_environment=None):
    if references("\n".join(record.values()), roots):
        raise RuntimeError("The retained service references another bot's files; migrate that dependency first.")
    config_paths = [record.get("FragmentPath", "")]
    config_paths.extend(part for part in shlex.split(record.get("EnvironmentFiles", "")) if part.startswith("/"))
    for value in config_paths:
        if value and any(within(Path(value).resolve(), root) for root in roots):
            raise RuntimeError("The retained service configuration links to a removal directory.")
    for directory, folders, files in os.walk(KEEP_ROOT, followlinks=False):
        folders[:] = [name for name in folders if name != ".git"]
        for name in folders + files:
            candidate = Path(directory) / name
            if candidate.is_symlink() and any(within(candidate.resolve(), root) for root in roots):
                raise RuntimeError("The retained bot has a shared dependency: " + str(candidate))
    # Check the one data-path setting, without logging any credential values.
    inherited = {}
    for item in shlex.split(record.get("Environment", "")):
        if "=" in item:
            key, value = item.split("=", 1)
            inherited[key] = value
    inherited.update(runtime_environment or {})
    dependency_values = " ".join(inherited.get(key, "") for key in ("PYTHONPATH", "VIRTUAL_ENV", "PATH"))
    if references(dependency_values, roots):
        raise RuntimeError("Dragon Ball's runtime depends on another bot's environment.")
    configured = inherited.get("DATABASE_PATH")
    env_file = KEEP_ROOT / ".env"
    if configured is None and env_file.is_file():
        for line in env_file.read_text().splitlines():
            match = re.match(r"\s*(?:export\s+)?DATABASE_PATH\s*=\s*(.*)", line)
            if match:
                value = match[1].strip()
                if value.startswith(("'", '"')):
                    parts = shlex.split(value, comments=True)
                    if len(parts) != 1:
                        raise RuntimeError("The retained database path needs inspection before deletion.")
                    configured = parts[0]
                else:
                    configured = re.sub(r"\s+#.*", "", value).rstrip()
    if configured:
        if "$" in configured:
            raise RuntimeError("The retained database path uses interpolation; inspect its resolved path first.")
        # This application's config resolves relative database paths from PROJECT_ROOT.
        location = (KEEP_ROOT / configured).resolve()
        if any(within(location, root) for root in roots):
            raise RuntimeError("The retained database is inside a removal directory.")


def processes_in(roots):
    found = []
    for process in Path("/proc").iterdir():
        if not process.name.isdigit() or int(process.name) == os.getpid():
            continue
        try:
            name = (process / "comm").read_text().strip()
            if name in {"bash", "sh", "dash", "zsh", "fish", "ssh"}:
                continue
            cwd = Path(os.readlink(process / "cwd").removesuffix(" (deleted)"))
            if any(within(cwd, root) for root in roots):
                found.append({"pid": int(process.name), "name": name, "cwd": str(cwd)})
        except (OSError, ProcessLookupError):
            pass
    return found


def ensure_keep_ready():
    run(["systemctl", "enable", KEEP_UNIT])
    run(["systemctl", "start", KEEP_UNIT])
    for _ in range(60):
        record = properties([KEEP_UNIT], ["Id", "ActiveState", "InvocationID"])[KEEP_UNIT]
        invocation = record.get("InvocationID")
        if invocation and record.get("ActiveState") == "active":
            journal = run(
                ["journalctl", "-u", KEEP_UNIT, "_SYSTEMD_INVOCATION_ID=" + invocation,
                 "--no-pager", "-o", "cat", "--grep=Logged in as", "-n", "3"],
                check=False,
            ).stdout
            if "Logged in as " in journal:
                print("Dragon Ball connected to Discord.", flush=True)
                return
        time.sleep(1)
    raise RuntimeError("Dragon Ball has not confirmed a Discord login. No other bots were deleted.")


def inspect_docker(roots):
    if not shutil.which("docker"):
        return [], []
    listing = run(["docker", "ps", "-aq"], check=False)
    if listing.returncode:
        raise RuntimeError("Docker is installed but its container inventory is unavailable; inspect it before deletion.")
    if not listing.stdout.strip():
        return [], []
    template = '{"id":{{json .Id}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"name":{{json .Name}},"state":{{json .State}},"restart":{{json .HostConfig.RestartPolicy}}}'
    output = run(["docker", "inspect", "--format", template, *listing.stdout.split()]).stdout
    records = [json.loads(line) for line in output.splitlines()]
    targets = []
    patterns = ("evoevo", "neosoul-content", "neosoul-growth", "neosoul-bsc", "bsc-bot")
    for record in records:
        labels = record.get("labels") or {}
        workdir = labels.get("com.docker.compose.project.working_dir", "")
        sources = [mount.get("Source", "") for mount in record.get("mounts", [])]
        identity = " ".join([record["name"], record["image"], labels.get("com.docker.compose.project", "")]).lower()
        if not references(" ".join([workdir, *sources]), roots) and not any(word in identity for word in patterns):
            continue
        if references(" ".join([workdir, *sources]), (KEEP_ROOT,)):
            raise RuntimeError("A Docker container shares Dragon Ball files; inspect it first.")
        if labels.get("com.docker.swarm.service.name"):
            raise RuntimeError("A retired bot uses Docker Swarm; inspect its service before deletion.")
        targets.append(record)
    selected_ids = {record["id"] for record in targets}
    volumes = {}
    for record in targets:
        for mount in record["mounts"]:
            if mount.get("Type") != "volume":
                continue
            name = mount["Name"]
            for other in records:
                if other["id"] not in selected_ids and any(m.get("Name") == name for m in other["mounts"]):
                    raise RuntimeError("A Docker volume is shared with a retained container: " + name)
            source = Path(mount["Source"]).resolve(strict=True)
            if not source.is_dir():
                raise RuntimeError("A Docker volume data directory could not be verified: " + name)
            volumes[name] = source
    return targets, list(volumes.items())


def make_backup(paths, destination):
    archive = destination / "bots.tar.gz"
    descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        with tarfile.open(fileobj=output, mode="w:gz", compresslevel=1, dereference=False) as bundle:
            for path in paths:
                bundle.add(path, arcname=str(path.relative_to("/")))
    with gzip.open(archive, "rb") as check:
        while check.read(1024 * 1024):
            pass
    with tarfile.open(archive, "r:gz") as bundle:
        for path in paths:
            bundle.getmember(str(path.relative_to("/")))
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    return archive, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Inspect the plan without changing services or files.")
    arguments = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run from the Droplet Console as root.")
    if not KEEP_ROOT.is_dir() or KEEP_ROOT.is_symlink():
        raise RuntimeError("The retained Dragon Ball directory could not be verified.")
    marker = KEEP_ROOT / "src/database.py"
    if not marker.is_file() or not any(word in marker.read_text() for word in ("Dragon Ball", "1-Star Ball", "龙珠")):
        raise RuntimeError("Dragon Ball source identity needs inspection before deletion.")
    roots = tuple(root for root in REMOVE_ROOTS if root.exists() or root.is_symlink())
    guard_roots(roots)
    listing = run(["systemctl", "list-unit-files", "--type=service", "--no-legend", "--no-pager"]).stdout
    names = sorted({line.split()[0] for line in listing.splitlines() if line.strip()})
    records = properties(names, ["Id", "LoadState", "WorkingDirectory", "ExecStart", "FragmentPath", "DropInPaths", "ActiveState", "UnitFileState", "KillMode"])
    keep = properties([KEEP_UNIT], ["Id", "WorkingDirectory", "ExecStart", "ExecStartPre", "ExecStartPost", "ExecStop", "ExecReload", "EnvironmentFiles", "Environment", "FragmentPath", "RootDirectory", "BindPaths", "BindReadOnlyPaths", "Requires", "Requisite", "Wants", "BindsTo", "PartOf", "Upholds"])[KEEP_UNIT]
    if keep.get("WorkingDirectory") and not within(Path(keep["WorkingDirectory"]).resolve(), KEEP_ROOT):
        raise RuntimeError("Dragon Ball's service working directory does not match the retained project.")
    guard_keep_dependencies(keep, roots)
    containers, volumes = inspect_docker(roots)
    guard_keep_dependencies(keep, (*roots, *(source for _, source in volumes)))
    targets = choose_units(records, roots)
    dependencies = set()
    for key in ("Requires", "Requisite", "Wants", "BindsTo", "PartOf", "Upholds"):
        dependencies.update(keep.get(key, "").split())
    if dependencies.intersection(set(targets) | REMOVE_UNITS):
        raise RuntimeError("Dragon Ball has a systemd dependency on another bot; adjust that dependency first.")
    unit_files = set()
    for name, record in targets.items():
        if record.get("ActiveState") == "active" and record.get("KillMode") not in {"control-group", "mixed"}:
            raise RuntimeError("A removal service cannot safely stop all child processes: " + name)
        fragment = Path(record.get("FragmentPath") or "/nonexistent")
        if fragment.exists() or fragment.is_symlink():
            if fragment.resolve() == Path(keep.get("FragmentPath") or "/nonexistent").resolve():
                raise RuntimeError("A removal unit shares Dragon Ball's service file.")
            if not within(fragment, Path("/etc/systemd/system")):
                raise RuntimeError("A removal unit is outside the custom service directory: " + name)
            unit_files.add(fragment)
        override = Path("/etc/systemd/system") / (name + ".d")
        if override.exists() or override.is_symlink():
            unit_files.add(override)
    print("KEEP:", KEEP_UNIT, str(KEEP_ROOT), flush=True)
    print("REMOVE SERVICES:", ", ".join(sorted(targets)) or "none", flush=True)
    print("REMOVE DIRECTORIES:", ", ".join(map(str, roots)) or "none", flush=True)
    print("REMOVE CONTAINERS:", ", ".join(record["name"] for record in containers) or "none", flush=True)
    if arguments.dry_run:
        return
    print("Starting retained Dragon Ball service; waiting for its Discord login...", flush=True)
    ensure_keep_ready()
    live = properties([KEEP_UNIT], ["Id", "MainPID", "WorkingDirectory", "ExecStart", "EnvironmentFiles", "Environment", "FragmentPath"])[KEEP_UNIT]
    raw_environment = (Path("/proc") / live["MainPID"] / "environ").read_bytes()
    runtime_environment = {}
    for entry in raw_environment.split(b"\0"):
        key, separator, value = entry.partition(b"=")
        if separator and key in {b"DATABASE_PATH", b"PYTHONPATH", b"VIRTUAL_ENV", b"PATH"}:
            runtime_environment[key.decode()] = value.decode()
    guard_keep_dependencies(live, (*roots, *(source for _, source in volumes)), runtime_environment)
    paths = sorted({*roots, *unit_files, *(source for _, source in volumes)}, key=str)
    required = 256 * 1024 * 1024
    for path in paths:
        if path.is_dir() and not path.is_symlink():
            for directory, _, files in os.walk(path, followlinks=False):
                required += sum((Path(directory) / name).lstat().st_size for name in files)
        else:
            required += path.lstat().st_size
    if shutil.disk_usage("/root").free < required:
        raise RuntimeError("Insufficient space for a complete protected backup; deletion cancelled.")
    destination = Path(tempfile.mkdtemp(prefix="retired-bots-", dir="/root"))
    if containers:
        configuration = destination / "container-config.json"
        configuration.write_text(run(["docker", "inspect", *(record["id"] for record in containers)]).stdout)
        configuration.chmod(0o600)
        paths.append(configuration)
    deletion_started = False
    try:
        for name in targets:
            run(["systemctl", "disable", "--now", name])
        for record in containers:
            run(["docker", "update", "--restart=no", record["id"]])
            if record["state"].get("Running"):
                run(["docker", "stop", "--time=30", record["id"]])
        remaining = processes_in(roots)
        if remaining:
            raise RuntimeError("Unmanaged processes still use removal directories: " + json.dumps(remaining))
        archive, digest = make_backup(paths, destination)
        manifest = {"keep": KEEP_UNIT, "removed_roots": list(map(str, roots)),
                    "units": {name: {key: value for key, value in record.items() if key in {"Id", "ActiveState", "UnitFileState", "FragmentPath"}} for name, record in targets.items()},
                    "containers": [record["id"] for record in containers],
                    "volumes": [name for name, _ in volumes],
                    "archive": str(archive), "sha256": digest}
        manifest_path = destination / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2))
        manifest_path.chmod(0o600)
        print("Verified private backup:", str(archive), flush=True)
        if run(["systemctl", "is-active", "--quiet", KEEP_UNIT], check=False).returncode:
            raise RuntimeError("Dragon Ball stopped during backup; deletion cancelled.")
        deletion_started = True
        for record in containers:
            run(["docker", "rm", record["id"]])
        for name, _ in volumes:
            run(["docker", "volume", "rm", name])
        for path in sorted(unit_files, key=str):
            if path.is_symlink() or path.is_file():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
        for root in roots:
            shutil.rmtree(root)
        run(["systemctl", "daemon-reload"])
        for name in targets:
            run(["systemctl", "reset-failed", name], check=False)
        if processes_in(roots):
            raise RuntimeError("A retired process is still running; inspect the process list.")
        run(["systemctl", "is-active", "--quiet", KEEP_UNIT])
        print("Cleanup complete. Dragon Ball remains active.", flush=True)
        print("Backup:", str(archive), flush=True)
        print(run(["free", "-h"]).stdout, flush=True)
    except BaseException:
        if not deletion_started:
            for name, record in targets.items():
                if record.get("UnitFileState") in {"enabled", "enabled-runtime"}:
                    options = ["systemctl", "enable"]
                    if record["UnitFileState"] == "enabled-runtime":
                        options.append("--runtime")
                    run([*options, name], check=False)
                if record.get("ActiveState") == "active":
                    run(["systemctl", "start", name], check=False)
            for record in containers:
                policy = record["restart"].get("Name") or "no"
                if policy == "on-failure" and record["restart"].get("MaximumRetryCount"):
                    policy += ":" + str(record["restart"]["MaximumRetryCount"])
                run(["docker", "update", "--restart=" + policy, record["id"]], check=False)
                if record["state"].get("Running"):
                    run(["docker", "start", record["id"]], check=False)
        print("Backup/status directory:", str(destination), flush=True)
        raise


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        # Never dump a command's captured output: it could include credentials.
        if isinstance(error, subprocess.CalledProcessError):
            print("Cleanup stopped: command failed: " + shlex.join(error.cmd), flush=True)
        else:
            print("Cleanup stopped:", str(error), flush=True)
        raise SystemExit(1)
