"""Package the public Deepmine source ZIP with an authenticated Windows x64 runtime."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

import release

NODE = "node-v24.22.3-win-x64"
DIGEST = "e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f"
# Extracted from the pinned official ZIP. Recheck both on the draft runner,
# which receives the tested portable bundle without downloading Node again.
RUNTIME_HASHES = {"node.exe": "86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6",
                  "LICENSE": "ed34dd8e3f0a78dbaf00d0444ce8e285b015b765379c2e17880455f70370f8e9"}
NODE_URL = f"https://nodejs.org/dist/v24.22.3/{NODE}.zip"
ENTRY = "Open Deepmine.cmd"
LAUNCHER = """@echo off
setlocal DisableDelayedExpansion
if defined DEEPMINE_DATA_DIR goto launch
if exist "%~dp0.deepmine\\config.json" goto oldroot
if exist "%~dp0Deepmine\\.deepmine\\config.json" goto oldapp
if defined LOCALAPPDATA goto local
set "DEEPMINE_DATA_DIR=%USERPROFILE%\\AppData\\Local\\Deepmine"
goto launch
:local
set "DEEPMINE_DATA_DIR=%LOCALAPPDATA%\\Deepmine"
goto launch
:oldroot
set "DEEPMINE_DATA_DIR=%~dp0.deepmine"
goto launch
:oldapp
set "DEEPMINE_DATA_DIR=%~dp0Deepmine\\.deepmine"
:launch
"%~dp0Deepmine\\runtime\\node.exe" "%~dp0Deepmine\\scripts\\open-mine.cjs" %*
if errorlevel 1 (
  pause
  exit /b 1
)
""".replace("\n", "\r\n").encode("ascii")


def write_file(archive, name, stream, mode=0o100644):
    info = zipfile.ZipInfo(name, (2025, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = mode << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    with archive.open(info, "w") as out:
        if isinstance(stream, bytes):
            out.write(stream)
        else:
            shutil.copyfileobj(stream, out)


def build(source, node, candidate, scratch):
    # Source inventory, offline model digests, Unix permissions and exact
    # source bytes must match the checked-out tag before embedding anything.
    count = release.verify_archive(source, scratch)
    with node.open("rb") as runtime:
        release.require(release.sha256(runtime) == DIGEST, "Unexpected Node archive SHA-256")
    with zipfile.ZipFile(source) as app, zipfile.ZipFile(node) as runtime, zipfile.ZipFile(candidate, "w") as target:
        write_file(target, ENTRY, LAUNCHER)
        for info in app.infolist():
            with app.open(info) as stream:
                write_file(target, "Deepmine/" + info.filename, stream, info.external_attr >> 16)
        for name in ("node.exe", "LICENSE"):
            with runtime.open(NODE + "/" + name) as stream:
                write_file(target, "Deepmine/runtime/" + name, stream)
    with zipfile.ZipFile(candidate) as package, zipfile.ZipFile(source) as app, zipfile.ZipFile(node) as runtime:
        expected = {ENTRY, "Deepmine/runtime/node.exe", "Deepmine/runtime/LICENSE"}
        expected.update("Deepmine/" + name for name in app.namelist())
        release.require(len(package.infolist()) == count+3 and set(package.namelist()) == expected,
                        "Unexpected Windows package contents")
        release.require(package.read(ENTRY) == LAUNCHER, "Windows launcher content changed")
        for name in ("node.exe", "LICENSE"):
            with runtime.open(NODE + "/" + name) as original, package.open("Deepmine/runtime/" + name) as embedded:
                release.require(release.sha256(original) == release.sha256(embedded), "Runtime copy mismatch: " + name)
        release.require(package.testzip() is None, "Windows package CRC check failed")


def start_cmd(install, env):
    cmd = Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"
    # Child PATH is deliberately empty of any system Node/Git installation.
    return subprocess.Popen([str(cmd), "/d", "/c", "call", ENTRY, "--no-open", "--port", "0"],
                            cwd=install, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, encoding="utf-8", errors="replace")


def stop_cmd(process):
    if process.poll() is None:
        # Terminate only this fixture's cmd.exe and the bundled Node it owns.
        taskkill = Path(os.environ["SystemRoot"]) / "System32" / "taskkill.exe"
        subprocess.run([str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        process.wait(timeout=10)
    process.stdout.close()


def post(url, endpoint, client, data):
    req = urllib.request.Request(url+endpoint, data=json.dumps(data).encode(),
                                 headers={"Origin": url, "X-Deepmine-Client": client, "Content-Type": "application/json"})
    with release.OPENER.open(req, timeout=20) as response:
        return json.load(response)


def verify_windows(candidate, temp):
    release.require(sys.platform == "win32", "--verify requires Windows x64 or Windows with x64 emulation")
    home = temp / "隔离用户"
    project = home / "Coast notes"
    project.mkdir(parents=True)
    session_dir = home / ".codex" / "sessions"
    session_dir.mkdir(parents=True)
    at = dt.datetime.now(dt.timezone.utc).isoformat()
    usage = dict(input_tokens=100, output_tokens=20, total_tokens=120, cached_input_tokens=0, reasoning_output_tokens=0)
    logs = [dict(timestamp=at, type="session_meta", payload=dict(id="win-test", source="cli", cwd=str(project))),
            dict(timestamp=at, type="event_msg", payload=dict(type="token_count", info=dict(total_token_usage=usage,
                                                                                            last_token_usage=usage)))]
    (session_dir / "work.jsonl").write_text("\n".join(map(json.dumps, logs))+"\n", encoding="utf-8")
    (project / "work.md").write_text("# 海岸记录\n今天在海边观测潮位。", encoding="utf-8")
    empty_path = home / "empty-path"
    empty_path.mkdir()
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith(("CODEX_", "CLAUDE_", "DEEPMINE_", "GIT_", "NODE_"))
           and k.upper() not in ("PORT", "PATH", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOMEDRIVE", "HOMEPATH")}
    env.update(PATH=str(empty_path), HOME=str(home), USERPROFILE=str(home), LOCALAPPDATA=str(home/"Local"),
               APPDATA=str(home/"Roaming"), HOMEDRIVE=home.drive, HOMEPATH=str(home)[len(home.drive):])
    data = home / "Local" / "Deepmine"
    with zipfile.ZipFile(candidate) as archive:
        first = temp / "首次解压 First"
        second = temp / "重新解压 Other install"
        archive.extractall(first)
        process = start_cmd(first, env)
        try:
            welcome = release.read_listen_url(process)
            choices = release.get(welcome, "/api/projects")["projects"]
            release.require(len(choices) == 1 and Path(choices[0]["path"]) == project, "Wrong first-run project")
            url = post(welcome, "/api/connect", "welcome", {"id":choices[0]["id"], "memories":False})["url"].rstrip("/")
            snapshot = release.get(url, "/api/snapshot")
            release.require(sum(d["usage"]["totalTokens"] or 0 for d in snapshot["days"]) == 120, "Wrong isolated usage")
            release.require(len(snapshot["outputs"]) == 1, "Missing isolated work")
            post(url, "/api/mining", "mining", {"action":"start"})
            progress = post(url, "/api/mining", "mining", {"action":"progress","depth":5})
            release.require(progress["mining"]["excavatedDepth"] == 5, "Fixture did not save its five metres")
            release.require((data/"config.json").is_file(), "Portable edition did not use the user data directory")
        finally:
            stop_cmd(process)
        archive.extractall(second)
        process = start_cmd(second, env)
        try:
            url = release.read_listen_url(process)
            snapshot = release.get(url, "/api/snapshot")
            release.require(snapshot["mining"]["excavatedDepth"] == 5 and
                            Path(json.loads((data/"config.json").read_text(encoding="utf-8"))["projectPath"]) == project,
                            "A new extraction lost the saved project or depth")
            release.require(not (first/"Deepmine"/".deepmine").exists() and not (second/"Deepmine"/".deepmine").exists(),
                            "The clean Windows edition stored state inside its installation")
        finally:
            stop_cmd(process)
        # Existing source installs may keep their saves next to the entry
        # file or inside the application directory. An explicit override wins.
        precedence = [(second/"Deepmine"/".deepmine", "Legacy inner", env),
                      (second/".deepmine", "Legacy root", env),
                      (home/"User selected data", "Custom override", {**env, "DEEPMINE_DATA_DIR":str(home/"User selected data")})]
        for old_data, label, launch_env in precedence:
            old_project = home / label
            old_project.mkdir()
            old_data.mkdir()
            (old_data/"config.json").write_text(json.dumps({"projectPath":str(old_project)}), encoding="utf-8")
            process = start_cmd(second, launch_env)
            try:
                url = release.read_listen_url(process)
                observed = release.get(url, "/api/snapshot")
                release.require(observed["project"]["label"] == label, "Wrong data precedence for " + label)
            finally:
                stop_cmd(process)
    print("Windows root launcher passed with an empty PATH: picked a project, read 120 tokens and one file, "
          "saved 5m and resumed from a new install directory. Both legacy locations and a data override passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Verified source ZIP produced by scripts/release.py")
    parser.add_argument("--node-archive", type=Path, help="Official pinned Node ZIP; downloaded from nodejs.org if omitted")
    parser.add_argument("--output", type=Path, required=True, help="Output and staging directory")
    parser.add_argument("--verify", action="store_true", help="Exercise the root .cmd on Windows, without Node on PATH")
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    name = release.asset_name("windows-x64")
    with tempfile.TemporaryDirectory(prefix="deepmine-win-build-", dir=out) as staging:
        temp = Path(staging)
        node = args.node_archive
        if node is None:
            node = temp / (NODE+".zip")
            with urllib.request.urlopen(NODE_URL, timeout=60) as online, node.open("wb") as local:
                shutil.copyfileobj(online, local)
        candidate = temp / name
        build(args.source, node, candidate, temp/"source-check")
        if args.verify:
            verify_windows(candidate, temp)
        release.publish(candidate, out/name)
    with (out/name).open("rb") as stream:
        print(f"{name}  SHA-256 {release.sha256(stream)}")


if __name__ == "__main__":
    main()
