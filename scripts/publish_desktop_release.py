"""Publish the built Scholaxia desktop installer to a GitHub release.

Usage (PowerShell / Git Bash):
    GITHUB_TOKEN=ghp_xxx ./.venv/Scripts/python.exe scripts/publish_desktop_release.py 1.0.13
    ./.venv/Scripts/python.exe scripts/publish_desktop_release.py --tag desktop15 --dist D:/tmp/scholaxia-release

The token needs `repo` (classic) or Contents: read & write (fine-grained) on
emmakenneth352-gif/scholaxia-websit. It is read from GITHUB_TOKEN / GH_TOKEN,
or from scripts/_gh_token.txt (git-ignored) when those are not set, and it is
never written to disk or printed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "emmakenneth352-gif/scholaxia-websit"
ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "scholaxia-desktop" / "dist"
TOKEN_FILE = ROOT / "scripts" / "_gh_token.txt"
API = "https://api.github.com"


def token() -> str:
    tok = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
    if not tok and TOKEN_FILE.exists():
        tok = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not tok:
        sys.exit(
            "No GitHub token. Set GITHUB_TOKEN, or write one to "
            f"{TOKEN_FILE} (repo access), then re-run."
        )
    return tok


def call(method: str, url: str, tok: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {tok}")
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read()
    return json.loads(body) if body else {}


def upload_asset(upload_url: str, tok: str, path: Path) -> dict:
    url = upload_url.split("{")[0] + f"?name={path.name}"
    size = path.stat().st_size
    with path.open("rb") as fh:
        req = urllib.request.Request(url, data=fh, method="POST")
        req.add_header("Authorization", f"token {tok}")
        req.add_header("Content-Type", "application/octet-stream")
        req.add_header("Content-Length", str(size))
        with urllib.request.urlopen(req, timeout=1800) as resp:
            return json.loads(resp.read())


def _args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Publish the Scholaxia desktop installer to a GitHub release.")
    p.add_argument("version", nargs="?", default=None, help="version to publish (default: package.json)")
    p.add_argument("--tag", default=None, help="release tag (default: desktop-v<version>)")
    p.add_argument("--name", default=None, help="release title (default: Scholaxia Desktop <version>)")
    p.add_argument("--dist", default=None, help="folder with the installers (default: scholaxia-desktop/dist)")
    p.add_argument("--portable", action="store_true", help="also upload the portable build")
    return p.parse_args(argv)


def main() -> None:
    args = _args(sys.argv[1:])
    version = args.version or _version_from_package()
    tag = args.tag or f"desktop-v{version}"
    title = args.name or f"Scholaxia Desktop {version}"
    dist = Path(args.dist) if args.dist else DIST
    setup = dist / f"Scholaxia-Student-Setup-{version}.exe"
    portable = dist / f"Scholaxia-Student-Portable-{version}.exe" if args.portable else None
    if not setup.exists():
        sys.exit(f"Missing installer: {setup}\nBuild it first with: cd scholaxia-desktop && npm run build")

    tok = token()
    try:
        release = call("GET", f"{API}/repos/{REPO}/releases/tags/{tag}", tok)
        print(f"Release {tag} already exists.")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        release = call(
            "POST",
            f"{API}/repos/{REPO}/releases",
            tok,
            {
                "tag_name": tag,
                "name": title,
                "body": (
                    f"Scholaxia desktop student app {version}.\n\n"
                    "- Updates downloaded inside the app now install themselves.\n"
                    "- Download **Scholaxia-Student-Setup-%s.exe** below and run it.\n" % version
                ),
                "draft": False,
                "prerelease": False,
            },
        )
        print(f"Created release {tag}.")

    existing = {a["name"]: a for a in release.get("assets", [])}
    for path in (setup, portable):
        if path is None or not path.exists():
            continue
        if path.name in existing:
            call("DELETE", f"{API}/repos/{REPO}/releases/assets/{existing[path.name]['id']}", tok)
            print(f"Replaced previous asset {path.name}.")
        asset = upload_asset(release["upload_url"], tok, path)
        print(f"Uploaded {asset['name']} ({asset['size']} bytes)")
        print(asset["browser_download_url"])

    # Keep the release tag in the local git copy of the website in step.
    subprocess.run(["git", "-C", str(ROOT), "tag", "-f", tag], check=False)
    print(f"Done: {tag}")
    print(f"Download URL: https://github.com/{REPO}/releases/download/{tag}/{setup.name}")
    print("Next: update APP_LATEST_DESKTOP_VERSION / APP_DESKTOP_URL in app/core/config.py"
          " and the download links, then redeploy the backend and the site.")


def _version_from_package() -> str:
    pkg = json.loads((ROOT / "scholaxia-desktop" / "package.json").read_text(encoding="utf-8"))
    return str(pkg["version"])


if __name__ == "__main__":
    main()
