#!/usr/bin/env python3
"""Write the `latest.json` that Tauri's updater polls.

The updater reads one static JSON file:

    { "version", "notes", "pub_date",
      "platforms": { "linux-x86_64": {"signature", "url"}, ... } }

`signature` is the *content* of the `.sig` file Tauri wrote next to the bundle
(a path or URL is rejected), and every platform entry must be complete — the
plugin validates the whole document before it compares versions.

Usage (from the repo root, after the bundles were downloaded):

    scripts/make-latest-json.py --tag v1.5.7 --repo OWNER/REPO \
        --artifacts artifacts --out artifacts/latest.json [--notes-file NOTES]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

# (platform key, glob for the signed artifact). Order matters only for output.
PLATFORMS = [
    ("linux-x86_64", "*_amd64.AppImage"),
    ("windows-x86_64", "*_x64-setup.exe"),
]


def find(artifacts: pathlib.Path, pattern: str) -> pathlib.Path | None:
    matches = sorted(artifacts.rglob(pattern))
    return matches[0] if matches else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Tauri's latest.json")
    parser.add_argument("--tag", required=True, help="release tag, e.g. v1.5.7")
    parser.add_argument("--repo", required=True, help="OWNER/REPO")
    parser.add_argument("--artifacts", required=True, help="directory with the bundles")
    parser.add_argument("--out", required=True, help="path to write latest.json")
    parser.add_argument("--notes-file", help="release notes (markdown)")
    parser.add_argument(
        "--pub-date",
        default=None,
        help="RFC 3339 timestamp; defaults to now (UTC)",
    )
    args = parser.parse_args()

    artifacts = pathlib.Path(args.artifacts)
    version = args.tag.lstrip("v")
    platforms: dict[str, dict[str, str]] = {}
    for key, pattern in PLATFORMS:
        bundle = find(artifacts, pattern)
        if bundle is None:
            print(f"no {pattern} in {artifacts}", file=sys.stderr)
            return 1
        signature_file = bundle.with_name(bundle.name + ".sig")
        if not signature_file.is_file():
            print(f"missing signature for {bundle.name}", file=sys.stderr)
            return 1
        signature = signature_file.read_text().strip()
        if not signature:
            print(f"empty signature for {bundle.name}", file=sys.stderr)
            return 1
        url = f"https://github.com/{args.repo}/releases/download/{args.tag}/{bundle.name}"
        platforms[key] = {"signature": signature, "url": url}
        print(f"{key}: {bundle.name} ({len(signature)} byte signature)")

    notes = ""
    if args.notes_file:
        notes = pathlib.Path(args.notes_file).read_text(encoding="utf-8").strip()

    pub_date = args.pub_date or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "version": version,
        "notes": notes,
        "pub_date": pub_date,
        "platforms": platforms,
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} for {args.tag} ({len(platforms)} platforms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())