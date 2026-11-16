"""로컬 확인용 정적 서버. HTML/CSS 저장 시 version.json 빌드 번호를 자동으로 올린다."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 5173
ROOT = Path(__file__).resolve().parent
STATE_PATH = ROOT / ".pwa-build-state.json"
VERSION_PATH = ROOT / "version.json"
CONFIG_PATH = ROOT / "pwa.config.json"


def cache_prefix() -> str:
    if CONFIG_PATH.is_file():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            return str(data.get("cachePrefix") or "pwa-starter")
        except (json.JSONDecodeError, OSError):
            pass
    return "pwa-starter"


def shell_fingerprint() -> str:
    parts: list[bytes] = []
    for name in ("index.html", "offline.html"):
        path = ROOT / name
        if path.is_file():
            parts.append(path.read_bytes())
    css_dir = ROOT / "css"
    if css_dir.is_dir():
        for path in sorted(css_dir.glob("*.css")):
            parts.append(path.read_bytes())
    for name in ("sw.js", "sw.config.js"):
        path = ROOT / name
        if path.is_file():
            parts.append(path.read_bytes())
    js_dir = ROOT / "js"
    if js_dir.is_dir():
        for path in sorted(js_dir.glob("*.js")):
            parts.append(path.read_bytes())
    return hashlib.sha256(b"".join(parts)).hexdigest()


def sync_shell_version() -> None:
    fingerprint = shell_fingerprint()
    state = {"build": 1, "fingerprint": ""}
    if STATE_PATH.is_file():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))

    if fingerprint == state.get("fingerprint", ""):
        return

    if not state.get("fingerprint"):
        build = 1
    else:
        build = int(state["build"]) + 1

    prefix = cache_prefix()
    state = {"build": build, "fingerprint": fingerprint}
    version = {
        "build": build,
        "cacheName": f"{prefix}-{build}",
        "label": f"빌드 {build}",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    VERSION_PATH.write_text(
        json.dumps(version, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".json": "application/json",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        sync_shell_version()
        super().do_GET()


if __name__ == "__main__":
    sync_shell_version()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"http://127.0.0.1:{PORT}")
    server.serve_forever()