#!/usr/bin/env python3
"""Static consistency checks for the GitHub Pages project."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def require(path: str) -> Path:
    target = ROOT / path
    if not target.is_file():
        raise FileNotFoundError(path)
    return target


def main() -> int:
    required = [
        "index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest",
        "assets/icon.svg", "assets/icon-192.png", "assets/icon-512.png",
        "data/catalog.json", "data/packs/training-sample.dmap",
    ]
    for item in required:
        require(item)

    manifest = json.loads(require("manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["start_url"] == "./"
    assert manifest["scope"] == "./"
    for icon in manifest["icons"]:
        require(icon["src"].removeprefix("./"))

    catalog = json.loads(require("data/catalog.json").read_text(encoding="utf-8"))
    for pack in catalog.get("packs", []):
        require(pack["url"].removeprefix("./"))
        if pack.get("fallbackUrl"):
            require(pack["fallbackUrl"].removeprefix("./"))

    app = require("app.js").read_text(encoding="utf-8")
    sw = require("sw.js").read_text(encoding="utf-8")
    app_version = re.search(r"const APP_VERSION = '([^']+)'", app).group(1)
    sw_version = re.search(r"const APP_VERSION = '([^']+)'", sw).group(1)
    if app_version != sw_version:
        raise AssertionError(f"Version mismatch: app={app_version}, sw={sw_version}")

    html = require("index.html").read_text(encoding="utf-8")
    for ref in ["./app.js", "./styles.css", "./manifest.webmanifest", "./assets/icon.svg"]:
        if ref not in html:
            raise AssertionError(f"Missing HTML reference: {ref}")

    print(f"OK project ver {app_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
