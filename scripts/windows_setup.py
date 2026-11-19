"""Build the offline, current-user Windows installer using the built-in .NET Framework compiler."""
import argparse
import mmap
import os
from pathlib import Path
import subprocess
import tempfile

import release


def name():
    return f"deepmine-v{release.VERSION}-windows-x64-setup.exe"


def verify_payload(installer, portable):
    # A managed manifest resource contains the entire original ZIP as contiguous bytes.
    with portable.open("rb") as archive, installer.open("rb") as exe:
        with mmap.mmap(exe.fileno(), 0, access=mmap.ACCESS_READ) as data:
            signature = archive.read(64)
            start = data.find(signature)
            release.require(data[:2] == b"MZ" and start > 0, "Setup is missing its portable payload")
            archive.seek(0)
            for chunk in iter(lambda: archive.read(1024 * 1024), b""):
                release.require(data[start:start+len(chunk)] == chunk, "Setup differs from the verified portable ZIP")
                start += len(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    portable = output / release.asset_name("windows-x64")
    compiler = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    with tempfile.TemporaryDirectory(dir=output, prefix="setup-") as tmp:
        build = Path(tmp)
        target = build / name()
        with portable.open("rb") as archive:
            digest = release.sha256(archive)
        info = build / "BuildInfo.cs"
        info.write_text('internal static class BuildInfo { public const string Version = "%s"; '
                        'public const string Sha256 = "%s"; }\n' % (release.VERSION, digest), encoding="utf8")
        subprocess.run([str(compiler), "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/codepage:65001",
                        "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll",
                        f"/win32icon:{release.ROOT / 'dist/mine-icon.ico'}",
                        f"/resource:{portable},Portable.zip", f"/out:{target}", str(info),
                        str(release.ROOT / "scripts/DeepmineSetup.cs")], check=True)
        verify_payload(target, portable)
        if args.verify:
            isolated = build / "Fresh user 用户 🌱"
            for _ in range(2):
                result = subprocess.run([str(target), "--verify-install", str(isolated)], capture_output=True, timeout=120)
                if result.returncode:
                    log = isolated / "verify-install-error.txt"
                    diagnostic = log.read_text(encoding="utf8") if log.is_file() else result.stderr.decode("utf8", errors="replace")
                    raise RuntimeError(f"Isolated install exited {result.returncode}: {diagnostic or 'no process diagnostic'}")
            release.require((isolated / "Menu/Deepmine.lnk").is_file(), "Missing Start menu shortcut")
            app = isolated / "Programs/Deepmine" / release.VERSION
            # Verification reopens the .lnk through the Unicode Shell link interface.
            node, script, cwd = (isolated / "verified-shortcut.txt").read_text(encoding="utf8").splitlines()
            release.require(Path(node) == app / "Deepmine/runtime/node.exe" and
                            script == '"' + str(app / "Deepmine/scripts/open-mine.cjs") + '"' and Path(cwd) == app,
                            "Start menu shortcut does not point to the installed launcher")
            home = isolated / "Empty home"
            home.mkdir()
            env = {k:v for k,v in os.environ.items() if not k.startswith(("CODEX_", "CLAUDE_", "DEEPMINE_"))}
            env.update(USERPROFILE=str(home), HOME=str(home), LOCALAPPDATA=str(home/"Local"),
                       APPDATA=str(home/"Roaming"), DEEPMINE_DATA_DIR=str(home/"mine"), PATH="")
            process = subprocess.Popen([node, script.strip('"'), "--no-open", "--port", "0"], cwd=cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       encoding="utf8", errors="replace")
            try:
                url = release.read_listen_url(process)
                release.require(b"welcome.js" in release.get(url, "/", False) and
                                b"expedition-app.js" in release.get(url, "/try", False),
                                "Installed launcher did not serve first-run and sample pages")
            finally:
                release.stop_launcher(process)
            print("Verified offline first install, repeat install, Start menu target, empty-home launch and sample.")
        release.publish(target, output / name())


if __name__ == "__main__":
    main()
