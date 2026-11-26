#!/usr/bin/env python3
"""WASL AI — compare a CI run with the published baseline.

The baseline is READ FROM the published run log ⇒ the number and its
proof stay together. Any difference stops the build.

Usage:
    python3 .github/workflows/scripts/compare-baseline.py \
        --live <the log of this run> --baseline <the published log>
"""
import argparse
import re
import sys
from pathlib import Path

KEYS = ("tests", "pass", "fail", "skipped")


def summary(text: str) -> dict:
    out = {}
    for key in KEYS:
        found = re.findall(rf"^# {key} (\d+)$", text, re.M)
        out[key] = int(found[-1]) if found else None
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", required=True)
    parser.add_argument("--baseline", required=True)
    args = parser.parse_args()

    live_path = Path(args.live)
    base_path = Path(args.baseline)
    for path in (live_path, base_path):
        if not path.is_file():
            print(f"the file is missing: {path}", file=sys.stderr)
            return 1

    live = summary(live_path.read_text(encoding="utf-8", errors="replace"))
    base = summary(base_path.read_text(encoding="utf-8", errors="replace"))
    print(f"the published baseline: {base}")
    print(f"the run of this CI: {live}")

    problems = []
    for key in KEYS:
        if live[key] is None:
            problems.append(f"the summary of the run has no '{key}' line")
        elif base[key] is not None and live[key] != base[key]:
            problems.append(
                f"'{key}': the run says {live[key]}, the published log says {base[key]}"
            )

    if problems:
        print("", file=sys.stderr)
        print("CI BASELINE MISMATCH", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "a new round publishes a new log and updates CURRENT-STATE.md and\n"
            "docs/TEST-MATRIX.md, then the four audit tools must pass.",
            file=sys.stderr,
        )
        return 1

    print("CI BASELINE OK: the run equals the published baseline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
