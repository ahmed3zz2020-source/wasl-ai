#!/usr/bin/env python3
"""WASL AI — D-072 / M-81 — the single source of truth of the test numbers.

⭐ WHY THIS TOOL EXISTS
  The contradiction of M-81 was REAL: `CURRENT-STATE.md` published one
  partition of the groups and `docs/TEST-MATRIX.md` published another,
  and NEITHER of them was checked against the run. A number that is
  written by hand drifts ⇒ ⭐⭐ this tool derives the numbers from the
  REAL artifacts and compares them with what the documents publish.

⭐ WHAT IT CHECKS
  1) PARTITION  the four groups are a PARTITION of the files of `npm
     test`: every file is in exactly ONE group, and no file is in two.
     ⭐ The groups OVERLAP is the defect of M-81: a file counted twice
     makes the sum bigger than the real total.
  2) COVERAGE   every file of `npm test` belongs to one of the groups.
  3) NUMBERS    the numbers published by the documents are the numbers
     of the LAST MEASURED RUN (read from a run log), not a guess.
  4) FILES      the number of files of every group is counted from the
     real `package.json` scripts, not written in the document.

⭐ THE MEASUREMENT IS NOT GUESSED
  `node --test` prints its own summary (`# tests`, `# pass`, `# fail`,
  `# skipped`) ⇒ ⭐⭐ the tool reads that summary from a real run log.
  ⛔ Without a log the tool says so and exits with a failure: it never
  invents a number.

الاستخدام:
    python3 tools/test_count_audit.py                     # the structure
    python3 tools/test_count_audit.py --log <file>        # + the numbers of a run
    python3 tools/test_count_audit.py --docs              # + the documents
    python3 tools/test_count_audit.py --log <f> --docs \\
        --group-log unit=<f> --group-log integration=<f> \\
        --group-log security=<f> --group-log recovery=<f>
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

GROUPS = ("unit", "integration", "security", "recovery")

# ⭐⭐ The documents write the numbers in TWO systems: the Latin digits
#   and the Arabic-Indic ones ⇒ ⭐ the tool reads BOTH, otherwise the
#   contradiction of M-81 stays invisible to it.
DIGITS = {chr(0x0660 + i): str(i) for i in range(10)}
DIGITS.update({str(i): str(i) for i in range(10)})

# ⭐ The patterns of the summary that `node --test` prints.
SUMMARY = re.compile(r"^#\s+(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)\s*$", re.M)

# ⭐ The published partition: four numbers and their sum.
PARTITION = re.compile(r"(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)")


def latin(text: str) -> str:
    """⭐ The Arabic-Indic digits become Latin ones."""
    return "".join(DIGITS.get(char, char) for char in text)


def read_scripts() -> dict:
    """⭐ The scripts of the package, read from the file itself."""
    with open(ROOT / "package.json", encoding="utf-8") as handle:
        return json.load(handle)["scripts"]


def files_of(command: str) -> list:
    """⭐ The test files of a command, in the order of the command."""
    return [token for token in command.split() if token.endswith(".test.ts")]


def summary_of(path: Path) -> dict:
    """⭐ The summary that `node --test` printed, read from a real log."""
    text = path.read_text(encoding="utf-8", errors="replace")
    values = {}
    for key, value in SUMMARY.findall(text):
        values[key] = int(value)
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", help="the log of a real run (the summary of node --test)")
    parser.add_argument("--docs", action="store_true", help="compare the published documents")
    parser.add_argument(
        "--group-log",
        action="append",
        default=[],
        metavar="GROUP=FILE",
        help="the log of a real run of one group (repeatable)",
    )
    args = parser.parse_args()

    scripts = read_scripts()
    failures = []
    notes = []

    # ------------------------------------------------------------
    # 1) the partition of the FILES
    # ------------------------------------------------------------
    owner = {}
    overlaps = []
    for group in GROUPS:
        script = f"test:{group}"
        if script not in scripts:
            failures.append(f"the script {script} does not exist")
            continue
        for path in files_of(scripts[script]):
            if path in owner and owner[path] != group:
                overlaps.append((path, owner[path], group))
            owner[path] = group

    for path, first, second in overlaps:
        failures.append(f"the file {path} is in the groups {first} and {second}")

    # ------------------------------------------------------------
    # 2) the coverage of `npm test`
    # ------------------------------------------------------------
    all_files = files_of(scripts.get("test", ""))
    if not all_files:
        failures.append("the script test does not exist")
    else:
        for path in all_files:
            if path not in owner:
                failures.append(f"the file {path} is in no group")
        for path in owner:
            if path not in all_files:
                failures.append(f"the file {path} is in a group and not in npm test")

        counts = {group: len(files_of(scripts[f"test:{group}"])) for group in GROUPS}
        notes.append(f"the files of npm test: {len(all_files)}")
        for group in GROUPS:
            notes.append(f"  the group {group}: {counts[group]} file(s)")
        notes.append(f"  the sum of the groups: {sum(counts.values())}")

        # ⭐⭐ The partition is exact ⇐ the sum of the groups is the
        #   number of the files of `npm test` ⇐ no file is counted twice.
        if sum(counts.values()) != len(all_files):
            failures.append(
                f"the groups are not a partition: {sum(counts.values())} != {len(all_files)}"
            )

    # ------------------------------------------------------------
    # 3) the numbers of a real run
    # ------------------------------------------------------------
    measured = None
    if args.log:
        path = Path(args.log)
        if not path.exists():
            failures.append(f"the log {path} does not exist")
        else:
            values = summary_of(path)
            if "tests" not in values:
                failures.append(f"the log {path} carries no summary of node --test")
            else:
                measured = values
                notes.append(
                    f"the measured run: tests={values.get('tests')} pass={values.get('pass')} "
                    f"fail={values.get('fail')} skipped={values.get('skipped')}"
                )
                if values.get("fail", 0) != 0:
                    failures.append(f"the measured run has {values.get('fail')} failure(s)")

    # ------------------------------------------------------------
    # 3b) the measured partition (one log per group)
    # ------------------------------------------------------------
    measured_groups = None
    group_logs = {}
    for item in args.group_log:
        if "=" not in item:
            failures.append(f"the group log {item} has no GROUP=FILE shape")
            continue
        name, value = item.split("=", 1)
        group_logs[name] = value

    if group_logs:
        per_group = {}
        for group in GROUPS:
            if group not in group_logs:
                failures.append(f"the group {group} has no log")
                continue
            path = Path(group_logs[group])
            if not path.exists():
                failures.append(f"the log {path} does not exist")
                continue
            values = summary_of(path)
            if "tests" not in values:
                failures.append(f"the log {path} carries no summary of node --test")
                continue
            per_group[group] = values["tests"]
            notes.append(f"the measured group {group}: {values['tests']} test(s)")
        if len(per_group) == len(GROUPS):
            measured_groups = tuple(per_group[group] for group in GROUPS)
            notes.append(f"the measured partition: {' + '.join(str(v) for v in measured_groups)}")
            if measured is not None and sum(measured_groups) != measured.get("tests"):
                failures.append(
                    f"the measured groups sum to {sum(measured_groups)} but npm test has "
                    f"{measured.get('tests')}"
                )

    # ------------------------------------------------------------
    # 4) the published documents
    # ------------------------------------------------------------
    if args.docs:
        state = (ROOT / "CURRENT-STATE.md").read_text(encoding="utf-8")
        matrix = (ROOT / "docs" / "TEST-MATRIX.md").read_text(encoding="utf-8")

        published = {}
        for name, text in (("CURRENT-STATE.md", state), ("docs/TEST-MATRIX.md", matrix)):
            for parts in PARTITION.findall(latin(text)):
                published.setdefault(name, set()).add(tuple(int(p) for p in parts))

        if not published:
            failures.append("no published partition was found in the documents")

        for name, entries in published.items():
            for entry in sorted(entries):
                left = sum(entry[:4])
                right = entry[4]
                # ⭐⭐ EVERY published partition must be arithmetically right:
                #   a wrong sum is a defect whatever its age.
                if left != right:
                    failures.append(f"{name} publishes {left} != {right} (the sum is wrong)")
                else:
                    notes.append(f"{name} publishes {left} == {right} (the sum is right)")

            # ⭐⭐ The CURRENT partition (the newest one) must be the
            #   MEASURED one ⇒ ⭐ the older rows are a history and are
            #   left alone, but the newest one may not drift.
            if measured_groups is not None and entries:
                current = max(entries, key=lambda entry: entry[4])
                if current[:4] != measured_groups:
                    failures.append(
                        f"{name} publishes the current groups {current[:4]} but the measured "
                        f"ones are {measured_groups}"
                    )
                else:
                    notes.append(
                        f"{name} publishes the measured current groups {current[:4]} "
                        f"(the partition matches)"
                    )

        # ⭐⭐ The published total must be the measured one (when a log is given).
        if measured and published:
            totals = {entry[4] for entries in published.values() for entry in entries}
            if len(totals) > 1:
                failures.append(f"the documents publish different totals: {sorted(totals)}")
            for total in totals:
                if total != measured.get("tests"):
                    failures.append(
                        f"the documents publish {total} tests but the measured run has "
                        f"{measured.get('tests')}"
                    )

    # ------------------------------------------------------------
    # the report
    # ------------------------------------------------------------
    for note in notes:
        print(f"- {note}")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        print(f"\n{len(failures)} problem(s)")
        return 1
    print("\nTEST COUNT AUDIT OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
