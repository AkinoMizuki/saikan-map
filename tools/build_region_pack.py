#!/usr/bin/env python3
"""Build a deterministic .dmap regional data pack using only Python stdlib."""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

FORMAT = "disaster-map-pack-container"
FORMAT_VERSION = 1


def safe_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or not value:
        raise ValueError(f"Unsafe path: {value}")
    return str(path)


def json_bytes(value: Any, pretty: bool = False) -> bytes:
    if pretty:
        text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    return text.encode("utf-8")


def build(source_dir: Path) -> dict[str, Any]:
    template_path = source_dir / "manifest.template.json"
    if not template_path.exists():
        raise FileNotFoundError(f"Missing {template_path}")
    manifest = json.loads(template_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "disaster-map-pack" or manifest.get("formatVersion") != 1:
        raise ValueError("manifest.template.json must use disaster-map-pack formatVersion 1")
    definitions = manifest.get("files")
    if not isinstance(definitions, list) or not definitions:
        raise ValueError("manifest.files must be a non-empty list")

    payloads: dict[str, dict[str, str]] = {}
    built_files: list[dict[str, Any]] = []
    for definition in definitions:
        path = safe_relative_path(str(definition["path"]))
        file_path = source_dir / path
        if not file_path.is_file():
            raise FileNotFoundError(f"Missing pack file: {file_path}")
        raw = file_path.read_bytes()
        media_type = str(definition.get("mediaType") or "application/octet-stream")
        try:
            text = raw.decode("utf-8")
            use_text = media_type.startswith("text/") or "json" in media_type or media_type.endswith("+xml")
        except UnicodeDecodeError:
            text = ""
            use_text = False
        payloads[path] = {
            "encoding": "utf8" if use_text else "base64",
            "data": text if use_text else base64.b64encode(raw).decode("ascii"),
        }
        built = dict(definition)
        built["path"] = path
        built["bytes"] = len(raw)
        built["sha256"] = hashlib.sha256(raw).hexdigest()
        built_files.append(built)

    manifest["files"] = built_files
    return {
        "format": FORMAT,
        "formatVersion": FORMAT_VERSION,
        "manifest": manifest,
        "files": payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--write-json", action="store_true", help="Also write an uncompressed .json fallback")
    args = parser.parse_args()

    container = build(args.source_dir.resolve())
    raw = json_bytes(container, pretty=False)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as file_obj:
        with gzip.GzipFile(filename="", mode="wb", fileobj=file_obj, compresslevel=9, mtime=0) as gz:
            gz.write(raw)
    if args.write_json:
        fallback = args.output.with_suffix(args.output.suffix + ".json")
        fallback.write_bytes(json_bytes(container, pretty=False))
    print(f"Built {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
