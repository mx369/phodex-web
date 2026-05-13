#!/usr/bin/env python3
"""Capture a desktop screenshot and print the output path."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import platform
import subprocess
import sys
from pathlib import Path


def macos_default_dir() -> Path:
    try:
        result = subprocess.run(
            ["defaults", "read", "com.apple.screencapture", "location"],
            check=False,
            capture_output=True,
            text=True,
        )
        location = result.stdout.strip()
        if result.returncode == 0 and location:
            return Path(os.path.expanduser(location))
    except OSError:
        pass
    return Path.home() / "Desktop"


def default_output_path() -> Path:
    timestamp = dt.datetime.now().strftime("%Y-%m-%d at %H.%M.%S")
    return macos_default_dir() / f"Screen Shot {timestamp}.png"


def capture_macos(path: Path, region: str | None) -> None:
    cmd = ["screencapture", "-x"]
    if region:
        cmd.append(f"-R{region}")
    cmd.append(str(path))
    subprocess.run(cmd, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", help="Explicit output PNG path.")
    parser.add_argument(
        "--region",
        help="Optional pixel region as x,y,w,h. Supported on macOS via screencapture.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = Path(args.path).expanduser() if args.path else default_output_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    if platform.system() != "Darwin":
        print("capture_desktop.py currently supports macOS only.", file=sys.stderr)
        return 2

    try:
        capture_macos(path, args.region)
    except subprocess.CalledProcessError as exc:
        print(f"screencapture failed with exit code {exc.returncode}", file=sys.stderr)
        return exc.returncode or 1
    except FileNotFoundError:
        print("screencapture command not found.", file=sys.stderr)
        return 127

    if not path.is_file() or path.stat().st_size == 0:
        print(f"Screenshot was not created or is empty: {path}", file=sys.stderr)
        return 1

    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
