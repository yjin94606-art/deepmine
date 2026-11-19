# Releasing Deepmine

The GitHub landing page, release body and press materials are in English. The game downloads come from the same source revision. The press kit is a separate collection of screenshots and copy for review and sharing. [Release notes](launch/release-en.md) · [Community copy](launch/community.md)

## Choose a download

| File | Contents |
| --- | --- |
| `deepmine-v1.1.0-windows-x64-setup.exe` | Offline per-user Windows installer with the complete verified portable payload |
| `deepmine-v1.1.0-windows-x64.zip` | Windows x64 launcher, game and bundled Node.js runtime |
| `deepmine-v1.1.0-source.zip` | Source, launchers, offline model and license notices. Requires Node.js 20 or newer. |
| `SHA256SUMS.txt` | SHA-256 digest for each of the game downloads |

The [quick start](QUICKSTART.md) covers installation, the first dig, project selection and upgrading an existing mine.

## Build and verify

Use Node.js 20 or newer and Python 3 for the release scripts. Run these commands in the repository root. Pick a fresh output directory for each candidate.

```sh
npm run check
npm test
python scripts/release.py --output ../release-v1.1.0 --verify
```

Build and test the portable launcher on Windows x64. The bundler verifies the official runtime digest. Use its `--node-archive` option to supply a previously downloaded archive.

```sh
python scripts/windows_bundle.py --source ../release-v1.1.0/deepmine-v1.1.0-source.zip --output ../release-v1.1.0 --verify
python scripts/windows_setup.py --output ../release-v1.1.0 --verify
python scripts/release.py --output ../release-v1.1.0 --checksums
```

The verification scripts launch the extracted downloads and check that saved progress survives a move to another installation directory. To check a downloaded ZIP yourself, use `Get-FileHash -Algorithm SHA256` on Windows, `shasum -a 256` on macOS or `sha256sum` on Linux. Compare the result with the entry for that filename in `SHA256SUMS.txt`.

## Stage the GitHub release

After the maintainer approves publication, mark the verified source commit with the tag matching `package.json`, such as `v1.1.0`. Pushing the tag triggers the release workflow. It runs checks, builds both archives and the offline installer, and attaches the downloads and their checksums to a draft. Open the draft, review the English body and its attachments, then publish when ready. [Workflow](../.github/workflows/verify.yml)
