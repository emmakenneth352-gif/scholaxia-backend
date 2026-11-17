"""Publish the built Scholaxia desktop installer to a GitHub release.

Usage (PowerShell / Git Bash):
    GITHUB_TOKEN=ghp_xxx ./.venv/Scripts/python.exe scripts/publish_desktop_release.py 1.0.13

The token needs `repo` (classic) or Contents: read & write (fine-grained) on
emmakenneth352-gif/scholaxia-websit. The token is only read from the
environment; it is never written to disk or printed.
"""

from __future__ import annotations

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
API = "https://api.github.com"


def token() -> str:
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if not tok.strip():
        sys.exit("GITHUB_TOKEN is not set. Create a token with repo access and re-run.")
    return tok.strip()


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


def main() -> None:
    version = sys.argv[1] if len(sys.argv) > 1 else _version_from_package()
    tag = f"desktop-v{version}"
    setup = DIST / f"Scholaxia-Student-Setup-{version}.exe"
    portable = DIST / f"Scholaxia-Student-Portable-{version}.exe" if "--portable" in sys.argv else None
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
                "name": f"Scholaxia Desktop {version}",
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

    # Keep the in-app tag in the local git copy of the website in step.
    subprocess.run(["git", "-C", str(ROOT), "tag", "-f", tag], check=False)
    print("Done. Update APP_LATEST_DESKTOP_VERSION / APP_DESKTOP_URL in app/core/config.py"
          " and the download links, then redeploy the backend and the site.")


def _version_from_package() -> str:
    pkg = json.loads((ROOT / "scholaxia-desktop" / "package.json").read_text(encoding="utf-8"))
    return str(pkg["version"])


if __name__ == "__main__":
    main()
