#!/usr/bin/env python3
"""Validate a .dmap or .dmap.json pack using only Python stdlib."""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any


def load_container(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if raw.startswith(b"\x1f\x8b"):
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def validate(path: Path) -> list[str]:
    container = load_container(path)
    if container.get("format") != "disaster-map-pack-container" or container.get("formatVersion") != 1:
        raise ValueError("Unsupported container format")
    manifest = container.get("manifest") or {}
    if manifest.get("format") != "disaster-map-pack" or manifest.get("formatVersion") != 1:
        raise ValueError("Unsupported manifest format")
    payloads = container.get("files") or {}
    validated: list[str] = []
    for definition in manifest.get("files") or []:
        name = str(definition.get("path") or "")
        posix = PurePosixPath(name)
        if not name or posix.is_absolute() or ".." in posix.parts or "\\" in name:
            raise ValueError(f"Unsafe path: {name}")
        payload = payloads.get(name)
        if not isinstance(payload, dict):
            raise ValueError(f"Missing payload: {name}")
        encoding = payload.get("encoding")
        if encoding == "utf8":
            raw = str(payload.get("data", "")).encode("utf-8")
        elif encoding == "base64":
            raw = base64.b64decode(str(payload.get("data", "")), validate=True)
        else:
            raise ValueError(f"Unknown encoding: {name}")
        if len(raw) != int(definition.get("bytes", -1)):
            raise ValueError(f"Size mismatch: {name}")
        if hashlib.sha256(raw).hexdigest() != str(definition.get("sha256", "")).lower():
            raise ValueError(f"SHA-256 mismatch: {name}")
        if "json" in str(definition.get("mediaType", "")):
            parsed = json.loads(raw.decode("utf-8"))
            if "geo+json" in str(definition.get("mediaType", "")):
                if parsed.get("type") != "FeatureCollection" or not isinstance(parsed.get("features"), list):
                    raise ValueError(f"Not a GeoJSON FeatureCollection: {name}")
        validated.append(name)
    if not validated:
        raise ValueError("No files in pack")
    return validated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packs", nargs="+", type=Path)
    args = parser.parse_args()
    for path in args.packs:
        files = validate(path)
        print(f"OK {path}: {len(files)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
