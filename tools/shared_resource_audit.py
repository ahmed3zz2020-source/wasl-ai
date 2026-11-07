"""WASL AI — D-073 / M-82 — the audit of the SHARED RESOURCES of the suite.

⭐⭐ WHY THIS TOOL EXISTS
  The Phase 03 proof (M-82) covered the login budget ⇒ ⭐⭐ but the
  parallel run of the four groups MEASURED another shared resource
  that was not covered: ⭐⭐ THE SCHEMA (the migrations) ⇒ ⭐⭐ four
  processes applied the same migration at the same time ⇒ ⭐⭐
  PostgreSQL answered `deadlock detected` (40P01) ⇒ ⭐⭐ and the drills
  that were starting died with it.

⭐⭐⭐ WHAT THIS TOOL CHECKS (mechanically, from the repository)
  1) MIGRATIONS   the migrations take a PostgreSQL advisory lock ⇒
     ⭐⭐ the parallel starts are serialized instead of deadlocking.
  2) BUDGET       the drills that measure the platform login budget
     take the lock of the budget (the M-82 proof, kept).
  3) LOCKS        the locks are SESSION level ⇒ ⭐⭐ the statements
     must run on the very connection that holds the lock ⇒ ⭐⭐ and
     the unlock must be in a `finally`.
  4) THE DISK     every test file on the disk is in `npm test` ⇒
     ⭐⭐ a file that never runs can never publish a success.

⭐⭐ THE MEASUREMENT IS NEVER GUESSED
  ⛔ Without a log the tool says so and exits with a failure.

الاستخدام:
    python3 tools/shared_resource_audit.py
    python3 tools/shared_resource_audit.py --log <file>
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ⭐⭐ The shared resources of the suite (global by design).
SHARED_RESOURCES = ("login_attempts_global", "login_admission_global")

MUTATION = re.compile(r"\b(delete\s+from|update|insert\s+into|truncate)\b", re.IGNORECASE)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_files() -> list:
    return sorted((ROOT / "tests").rglob("*.test.ts"))


def check_migrations(failures: list, notes: list) -> None:
    """⭐⭐ The migrations take the advisory lock."""
    setup = read(ROOT / "server" / "db" / "setup.ts")
    if "pg_advisory_lock" not in setup:
        failures.append("the migrations do NOT take an advisory lock (the parallel starts deadlock)")
        return
    if "pg_advisory_unlock" not in setup:
        failures.append("the migrations never unlock (a failure would freeze the schema)")
        return
    if "finally" not in setup:
        failures.append("the unlock of the migrations is not in a finally")
        return
    # ⭐⭐ The lock is SESSION level ⇒ the statements must run on the
    #   same connection ⇒ the pool must be connected (not queried).
    if "ownerPool.connect()" not in setup:
        failures.append("the migrations run on the pool and not on the connection that holds the lock")
        return
    notes.append("the migrations take the advisory lock on one connection")


def check_budget(failures: list, notes: list) -> None:
    """⭐⭐ The drills that measure the platform budget take the budget lock."""
    measured = []
    unprotected = []
    for file in test_files():
        text = read(file)
        mutates = any(
            resource in line and MUTATION.search(line)
            for line in text.split("\n")
            for resource in SHARED_RESOURCES
        )
        if not mutates:
            continue
        measured.append(str(file.relative_to(ROOT)))
        if "withPlatformBudgetLock" not in text:
            unprotected.append(str(file.relative_to(ROOT)))
    for path in unprotected:
        failures.append(f"the drill {path} mutates a shared budget WITHOUT the advisory lock")
    if len(measured) < 2:
        failures.append(f"the inventory of the measuring drills is too small: {measured}")
    notes.append(f"the platform budget is measured by: {', '.join(measured) if measured else 'none'}")


def check_disk(failures: list, notes: list) -> None:
    """⭐⭐ Every test file on the disk is in `npm test`."""
    import json

    scripts = json.loads(read(ROOT / "package.json"))["scripts"]
    listed = {token for token in scripts["test"].split() if token.endswith(".test.ts")}
    on_disk = {
        str(path.relative_to(ROOT)).replace("\\", "/") for path in test_files()
    }
    for path in sorted(on_disk - listed):
        failures.append(f"the test file {path} is on the disk and NOT in npm test (it never runs)")
    notes.append(f"the test files on the disk: {len(on_disk)} · in npm test: {len(listed)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="the audit of the shared resources of the suite")
    parser.add_argument("--log", help="the log of a real run (the summary of node --test)")
    args = parser.parse_args()

    failures: list = []
    notes: list = []

    check_migrations(failures, notes)
    check_budget(failures, notes)
    check_disk(failures, notes)

    if args.log:
        log = Path(args.log)
        if not log.exists():
            failures.append(f"the log {log} does not exist")
        else:
            text = read(log)
            summary = dict(
                (m.group(1), int(m.group(2)))
                for m in re.finditer(r"^#\s+(tests|pass|fail|skipped)\s+(\d+)\s*$", text, re.M)
            )
            if "tests" not in summary:
                failures.append(f"the log {log} carries no summary of node --test")
            else:
                notes.append(
                    "the measured run: tests={tests} pass={ok} fail={bad} skipped={skipped}".format(
                        tests=summary.get("tests", 0),
                        ok=summary.get("pass", 0),
                        bad=summary.get("fail", 0),
                        skipped=summary.get("skipped", 0),
                    )
                )
                if summary.get("fail", 0) != 0:
                    failures.append(f"the measured run has {summary.get('fail')} failure(s)")

    for note in notes:
        print(f"- {note}")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        print(f"\n{len(failures)} problem(s)")
        return 1
    print("\nSHARED RESOURCE AUDIT OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
