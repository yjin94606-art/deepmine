"""Build a public Deepmine source ZIP and optionally exercise it under two new homes."""
import argparse
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
LAUNCHERS = ("Open Deepmine.cmd", "Open Deepmine.command", "open-deepmine.sh")
EXECUTABLES = frozenset(LAUNCHERS[1:])
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def require(value, message):
    if not value:
        raise ValueError(message)


def sources():
    names = (ROOT / "scripts/release-files.txt").read_text(encoding="utf-8").splitlines()
    require(names == sorted(names) and len({n.casefold() for n in names}) == len(names),
            "Release inventory must contain unique, sorted portable paths")
    files = []
    for name in names:
        parts = name.split("/")
        require(not re.search(r"[\\:\x00-\x1f]", name) and all(p not in ("", ".", "..") for p in parts),
                "Invalid inventory entry: " + name)
        path = ROOT.joinpath(*parts)
        require(path.resolve() == path and path.is_file(), "Missing or linked release file: " + name)
        files.append(path)
    return files


def sha256(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def pack(candidate):
    with zipfile.ZipFile(candidate, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for path in sources():
            name = path.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(name, (2025, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100755 if name in EXECUTABLES else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with path.open("rb") as src, archive.open(info, "w") as dst:
                shutil.copyfileobj(src, dst)


def publish(candidate, target):
    if target.exists():
        with candidate.open("rb") as a, target.open("rb") as b:
            require(sha256(a) == sha256(b), "A different artifact already exists here. Use an empty output directory.")
        return
    try:
        os.link(candidate, target)
    except OSError as error:
        if error.errno not in (errno.EPERM, errno.ENOTSUP, errno.EACCES):
            raise
        # On removable drives without hard links, reserve the target exclusively.
        with target.open("xb"):
            pass
        try:
            os.replace(candidate, target)
        except OSError:
            target.unlink()
            raise


def verify_archive(filename, unpacked):
    with zipfile.ZipFile(filename) as archive:
        entries = {p.relative_to(ROOT).as_posix(): p for p in sources()}
        require(len(archive.infolist()) == len(entries) and set(archive.namelist()) == set(entries),
                "Release inventory does not match the application's public payload")
        for name, path in entries.items():
            mode = archive.getinfo(name).external_attr >> 16
            require(mode == (0o100755 if name in EXECUTABLES else 0o100644), "Wrong packaged permissions for " + name)
            if name in EXECUTABLES:
                script = archive.read(name)
                require(script.startswith(b"#!/") and b"\r" not in script, "Unix launcher needs an LF shebang: " + name)
            with archive.open(name) as packaged, path.open("rb") as working:
                require(sha256(packaged) == sha256(working), "Wrong packaged bytes for " + name)
        license_files = ("vision/CLIP-LICENSE.txt", "vision/ORT-LICENSE.txt", "vision/ORT-ThirdPartyNotices.txt")
        verify_files = (*license_files, *LAUNCHERS, "vision/subjects.f32", "scripts/connect-codex.cjs",
                        "scripts/open-mine.cjs", "scripts/welcome.cjs", "dist/welcome.html", "dist/welcome.js", "dist/item-story.js",
                        "scripts/data-directory.cjs", "scripts/work-imprint.cjs", "dist/work-imprints.js",
                        "dist/work-sprites.js", "dist/image-decode.mjs", "dist/daily-depth.js", "dist/treasure.js",
                        "dist/gallery-ui.js", "scripts/work-usage.cjs", "scripts/personal-survey.cjs")
        require(all(name in entries for name in verify_files), "Incomplete offline application")
        digest_list = (ROOT / "vision/README.md").read_text(encoding="utf-8")
        hashes = re.findall(r"^\| `([^`]+)` \| `([a-f0-9]{64})` \|", digest_list, re.M)
        require(any(name == "clip-vision.onnx" for name, _ in hashes), "Missing offline model digest")
        for name, digest in hashes:
            with archive.open("vision/" + name) as data:
                require(sha256(data) == digest, "Incorrect offline asset " + name)
        archive.extractall(unpacked)
        # Python's extractall ignores stored Unix modes. Reapply the two
        # validated executable modes as a desktop archive tool would do.
        if os.name == "posix":
            for name in EXECUTABLES:
                (unpacked / name).chmod(0o755)
        return len(entries)


def get(url, path, as_json=True):
    with OPENER.open(url + path, timeout=30) as response:
        return json.load(response) if as_json else response.read()


def read_listen_url(proc):
    result = queue.Queue()

    def read():
        for line in proc.stdout:
            match = re.fullmatch(r"Deepmine: (http://127\.0\.0\.1:\d+)/?", line.strip())
            if match:
                result.put(match.group(1))
                return
        result.put(None)

    threading.Thread(target=read, daemon=True).start()
    try:
        url = result.get(timeout=30)
    except queue.Empty:
        url = None
    require(url, "The packaged launcher did not report a local address")
    return url


def spawn_launcher(install, home, env):
    if sys.platform == "win32":
        # Use the foreground process directly so Windows can terminate it and
        # test recovery from an interrupted desktop session.
        command = ["node", str(install / "scripts" / "open-mine.cjs")]
    else:
        launcher = "Open Deepmine.command" if sys.platform == "darwin" else "open-deepmine.sh"
        command = [str(install / launcher)]
    return subprocess.Popen([*command, "--no-open", "--port", "0"],
                            cwd=home, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, encoding="utf-8", errors="replace")


def stop_launcher(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    proc.stdout.close()


def check_reopen(install, home, env, expected):
    again = spawn_launcher(install, home, env)
    try:
        require(read_listen_url(again) == expected, "Second launch opened a different service")
        require(again.wait(timeout=10) == 0, "Second launch failed to reuse the active instance")
    finally:
        stop_launcher(again)


def simulate(install, temp, second):
    home = temp / ("Home B" if second else "用户 A")
    codex = (home / "custom codex logs") if second else (home / ".codex")
    directory = codex / ("archived_sessions" if second else "sessions")
    directory.mkdir(parents=True)
    project = home / ("Kitchen notes" if second else "海岸笔记")
    project.mkdir()
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(("CODEX_", "DEEPMINE_", "CLAUDE_")) or key in ("PORT", "NODE_OPTIONS", "GIT_DIR", "GIT_WORK_TREE"):
            del env[key]
    if second:
        data = home / "game data"
    elif sys.platform == "win32":
        data = home / "Local" / "Deepmine"
    elif sys.platform == "darwin":
        data = home / "Library" / "Application Support" / "Deepmine"
    else:
        data = home / "xdg data" / "deepmine"
    require(not data.exists(), "A first-run check must start without game configuration")
    env.update(HOME=str(home), USERPROFILE=str(home),
               LOCALAPPDATA=str(home / "Local"), XDG_CONFIG_HOME=str(home / "config"),
               XDG_DATA_HOME=str(home / "xdg data"), LANG="C.UTF-8")
    if second:
        env["CODEX_HOME"] = str(codex)
        env["DEEPMINE_DATA_DIR"] = str(data)
    title, summary = (("春天的菜园", "每周记录香草发芽的日期。") if second else ("海边的观察日记", "清晨记录白鹭从浅滩起飞的时刻。"))
    body = f"# {title}\n{summary}\n"
    prompt = "写下这次菜园观察。" if second else "整理这次河口观鸟的记录。"
    note = project / "001.md"
    note.write_bytes(body.encode())
    instant = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=2)
    at = instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    os.utime(note, (instant.timestamp(), instant.timestamp()))
    total = 1701 if second else 216
    usage = dict(input_tokens=total-16, output_tokens=16, cached_input_tokens=0, reasoning_output_tokens=0)
    if not second:
        usage["cache_write_input_tokens"] = 0
    usage["total_tokens"] = total

    def event(kind, **fields):
        return dict(timestamp=at, type="event_msg", payload=dict(type=kind, **fields))

    rows = [
        dict(timestamp=at, type="session_meta", payload=dict(id="main", source="cli", cwd=str(project))),
        event("task_started", turn_id="turn"),
        dict(timestamp=at, type="response_item", payload=dict(type="message", role="user", content=[dict(type="input_text", text=prompt)])),
        event("item_completed", thread_id="main", turn_id="turn", item=dict(type="FileChange", id="add",
              status="completed", changes={"001.md": dict(type="add", content=body)})),
        event("token_count", info=dict(last_token_usage=usage, total_token_usage=usage))
    ]
    session = directory / "session.jsonl"
    session.write_text("\n".join(map(json.dumps, rows))+"\n", encoding="utf-8")
    # Enter through the desktop launcher's public HTTP flow. Both profiles
    # start from an unrelated working directory with their own Codex home.
    proc = spawn_launcher(install, home, env)
    try:
        welcome = read_listen_url(proc)
        require(b"welcome.js" in get(welcome, "/", False), "First opening did not offer project selection")
        projects = get(welcome, "/api/projects")["projects"]
        require(len(projects) == 1 and Path(projects[0]["path"]) == project,
                "First opening did not find the user's own project")
        if not second:
            check_reopen(install, home, env, welcome)
        connect = urllib.request.Request(welcome + "/api/connect",
            data=json.dumps({"id": projects[0]["id"], "memories": not second}).encode(),
            headers={"Origin": welcome, "Content-Type": "application/json", "X-Deepmine-Client": "welcome"})
        with OPENER.open(connect, timeout=30) as response:
            url = json.load(response)["url"].rstrip("/")
        require(re.fullmatch(r"http://127\.0\.0\.1:\d+", url), "First opening did not return a local mine URL")
        snapshot = get(url, "/api/snapshot")
        source = next((s for s in snapshot["usageSources"] if s["id"] == "codex"), None)
        expected = "partial" if second else "connected"
        require(snapshot.get("mode") != "demo" and source and source["status"] == expected,
                "Expected a new live Codex connection")
        observed = sum(day["usage"]["totalTokens"] or 0 for day in snapshot["days"])
        require(observed == total and len(snapshot["outputs"]) == 1, "Usage or work leaked across profiles")
        item = snapshot["outputs"][0]
        require(item["title"] == title and summary in item["summary"] and item["files"] == ["001.md"],
                "The real document title and contents were not recognized")
        traces = [t for t in item.get("traces", []) if t.get("sourceId") == "codex"]
        require(traces and (not second or not any(t.get("request") for t in traces)),
                "Missing Codex receipt or an original request appeared without opting in")
        if not second:
            require(any(t.get("request") == prompt for t in traces), "Missing opted-in request for the exact version")
        require(b"expedition-app.js" in get(url, "/", False), "The playable mine page is absent")
        require(get(url, "/vision/subjects.json")[0]["id"] == "anime", "Offline classifier metadata unavailable")
        conf = json.loads((data / "config.json").read_text(encoding="utf-8"))
        require(Path(conf["projectPath"]) == project, "First run selected the wrong workspace")
        if not second:
            # A live session grows after startup. The second call's 30 tokens
            # must become visible exactly once without reconnecting the client.
            delta = dict(usage, input_tokens=24, output_tokens=6, total_tokens=30)
            cumulative = {key: usage[key]+delta[key] for key in usage}
            extra = event("token_count", info=dict(last_token_usage=delta, total_token_usage=cumulative))
            extra["timestamp"] = (instant+dt.timedelta(seconds=10)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            (project / "002.md").write_bytes("# 归巢时间\n傍晚在巢边记下第二次观察。".encode())
            with session.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(extra)+"\n")
            deadline = time.monotonic()+30
            while time.monotonic() < deadline:
                updated = get(url, "/api/snapshot")
                updated_total = sum(d["usage"]["totalTokens"] or 0 for d in updated["days"])
                if updated_total == total+30 and any(o["title"] == "归巢时间" for o in updated["outputs"]):
                    break
                time.sleep(0.7)
            else:
                raise ValueError("Appended Codex usage and new work did not sync on the running server")
            check_reopen(install, home, env, url)
        saved_id = snapshot["project"]["id"]
        saved_depth = snapshot["mining"]["excavatedDepth"]
    finally:
        stop_launcher(proc)
    require(not (install / ".deepmine").exists(), "First launch wrote personal state into the installation")
    if not second:
        install = Path(shutil.copytree(install, temp / "新版 Deepmine"))
    returning = spawn_launcher(install, home, env)
    try:
        url = read_listen_url(returning)
        require(b"expedition-app.js" in get(url, "/", False), "Returning user was sent to setup again")
        snapshot = get(url, "/api/snapshot")
        require(snapshot["project"]["id"] == saved_id and snapshot["mining"]["excavatedDepth"] == saved_depth,
                "Reopening lost the saved project or mining position")
        expected_total = total if second else total + 30
        require(sum(day["usage"]["totalTokens"] or 0 for day in snapshot["days"]) == expected_total,
                "Reopening double-counted the previous session")
        require(len(snapshot["outputs"]) == (1 if second else 2), "Reopening changed the saved work")
        return saved_id
    finally:
        stop_launcher(returning)


def asset_name(kind):
    return f"deepmine-v{VERSION}-{kind}.zip"


def write_checksums(output):
    import windows_bundle
    source, windows = (output / asset_name(kind) for kind in ("source", "windows-x64"))
    names = {p.relative_to(ROOT).as_posix() for p in sources()}
    with zipfile.ZipFile(source) as app, zipfile.ZipFile(windows) as portable:
        expected = {"Deepmine/" + name for name in names}
        expected.update({"Open Deepmine.cmd", "Deepmine/runtime/node.exe", "Deepmine/runtime/LICENSE"})
        require(len(names) == len(app.infolist()) and names == set(app.namelist()), "Unexpected source inventory")
        require(len(expected) == len(portable.infolist()) and expected == set(portable.namelist()),
                "Unexpected Windows inventory")
        require(json.loads(app.read("package.json"))["version"] == VERSION, "Incorrect package version")
        for name in sorted(names):
            with app.open(name) as a, portable.open("Deepmine/" + name) as b, (ROOT / name).open("rb") as original:
                packaged = sha256(a)
                require(packaged == sha256(b), "The two packages contain different copies of " + name)
                require(packaged == sha256(original), "Packaged file differs from checkout: " + name)
        require(portable.read("Open Deepmine.cmd") == windows_bundle.LAUNCHER, "Unexpected Windows launcher")
        for name, expected_hash in windows_bundle.RUNTIME_HASHES.items():
            with portable.open("Deepmine/runtime/" + name) as runtime_file:
                require(sha256(runtime_file) == expected_hash, "Incorrect Node runtime file: " + name)
    lines = []
    for filename in (source, windows):
        with filename.open("rb") as stream:
            lines.append(f"{sha256(stream)}  {filename.name}\n")
    with tempfile.TemporaryDirectory(dir=output) as temp:
        candidate = Path(temp) / "checksums"
        candidate.write_bytes("".join(lines).encode("ascii"))
        publish(candidate, output / "SHA256SUMS.txt")
    print("".join(lines), end="")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Directory for artifacts and temporary verification files")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--verify", action="store_true", help="Extract the ZIP and exercise two fresh Codex profiles")
    mode.add_argument("--checksums", action="store_true", help="Verify the source/Windows pair and write SHA256SUMS.txt")
    parser.add_argument("--tag", help="Require this exact Git tag to match package.json, e.g. v1.0.0")
    args = parser.parse_args()
    if args.tag is not None:
        require(args.tag == "v" + VERSION, "Tag must match the package version v" + VERSION)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.checksums:
        write_checksums(output)
        return
    target = output / asset_name("source")
    with tempfile.TemporaryDirectory(prefix="deepmine-build-", dir=output) as tmp:
        temp = Path(tmp)
        candidate = temp / "candidate.zip"
        pack(candidate)
        if args.verify:
            with tempfile.TemporaryDirectory(prefix="first install ", dir=temp) as first:
                count = verify_archive(candidate, Path(first))
                a = simulate(Path(first), temp, False)
            with tempfile.TemporaryDirectory(prefix="第二台机器 ", dir=temp) as second:
                verify_archive(candidate, Path(second))
                b = simulate(Path(second), temp, True)
                require(a != b and not (Path(second) / ".deepmine").exists(), "Project state crossed the install boundary")
            print(f"Verified {count} files and pinned offline assets. Two clean launches, browser project selection, "
                  "repeat launch, save/restart, consent, isolated usage and live updates passed.")
        publish(candidate, target)
    with target.open("rb") as stream:
        print(f"{target.name}  SHA-256 {sha256(stream)}")


if __name__ == "__main__":
    main()
