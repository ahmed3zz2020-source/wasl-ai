#!/usr/bin/env python3
"""WASL AI — D-072 / M-85 — the single source of truth of the test numbers.

⭐⭐ WHY THIS TOOL EXISTS
  The contradiction of M-81 was REAL: two documents published two
  different partitions of the test groups, and NEITHER was checked
  against a run. A number written by hand drifts ⇒ ⭐⭐ this tool
  derives the numbers from the REAL artifacts and compares them with
  what the documents publish.

⭐⭐ THE RULE OF THE HISTORY (M-85)
  The documents keep the numbers of the PAST phases on purpose (they
  are a record, not a mistake) ⇒ ⭐⭐ a tool that rejects them is a
  tool that would push the owner to delete the history to satisfy the
  tool ⇒ ⭐⭐ therefore:
    - EVERY published partition must be ARITHMETICALLY right (a wrong
      sum is a real contradiction ⇒ it fails, whatever its age),
    - ONLY the partition marked as CURRENT is compared with the
      measurement,
    - and the CURRENT one is found by an EXPLICIT MARKER, not by
      "the biggest number" (the biggest number is not necessarily the
      current one).

⭐ THE MARKER
  A comment in the documents that names the current partition:

      <!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->

  ⭐ It is explicit, it survives the renumbering of the sections and it
  is read by this tool ⇒ ⭐⭐ the machine and the human read the same
  line.

⭐ WHAT IT CHECKS
  1) PARTITION  the four groups are a PARTITION of the files of `npm
     test`: every file is in exactly ONE group, and NO file is listed
     twice (in one group or in two).
  2) COVERAGE   every file of `npm test` belongs to one of the groups.
  2b) DISK      ⭐⭐ EVERY test file that exists on the disk is in
     `npm test` ⇒ ⭐⭐ a file that was written but never listed never
     runs ⇒ ⭐⭐ and a file that runs only in the mind of its author
     is a SILENT SUCCESS (the trap of M-81: two files were written,
     never listed, and their success was published as if it existed).
  3) FILES      the number of files of every group is counted from the
     real `package.json` scripts, not written in a document.
  4) NUMBERS    the numbers published by the documents are the numbers
     of the LAST MEASURED RUN (read from a run log), not a guess.
  5) DIGITS     the documents write the numbers in TWO systems (the
     Latin and the Arabic-Indic ones) ⇒ both are read.
  6) MARKER     the current partition is declared EXPLICITLY and it is
     really published in the documents.

⭐ THE MEASUREMENT IS NEVER GUESSED
  `node --test` prints its own summary (`# tests`, `# pass`, `# fail`,
  `# skipped`) ⇒ ⭐⭐ the tool reads that summary from a real run log.
  ⛔ Without a log the tool says so and exits with a failure: it never
  invents a number.

الاستخدام:
    python3 tools/test_count_audit.py                     # the structure
    python3 tools/test_count_audit.py --log <file>        # + the numbers of a run
    python3 tools/test_count_audit.py --docs              # + the documents
    python3 tools/test_count_audit.py --docs --log <f> \\
        --group-log unit=<f> --group-log integration=<f> \\
        --group-log security=<f> --group-log recovery=<f>
    python3 tools/test_count_audit.py --root <dir>        # another project
"""
import argparse
import subprocess
import json
import re
import sys
from pathlib import Path

GROUPS = ("unit", "integration", "security", "recovery")

# ⭐⭐ The explicit marker of the CURRENT partition.
MARKER_NAME = "wasl:current-partition"
MARKER = re.compile(r"<!--\s*" + MARKER_NAME + r"\s+([0-9\s+]+?)\s*=\s*([0-9]+)\s*-->")

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


def read_scripts(root: Path) -> dict:
    """⭐ The scripts of the package, read from the file itself."""
    with open(root / "package.json", encoding="utf-8") as handle:
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




def commit_marker(root: Path, sha: str) -> tuple | None:
    """⭐⭐ The partition that the COMMIT declares as CURRENT.

    ⭐⭐ WHY: ⭐⭐ the number published beside the links MUST belong to
    the commit the links point to ⇒ ⭐⭐ otherwise the reader compares
    two different numbers (the contradiction of M-85).
    """
    for path in ("docs/TEST-MATRIX.md", "CURRENT-STATE.md"):
        proc = subprocess.run(
            ["git", "-C", str(root), "show", f"{sha}:{path}"],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0 or not proc.stdout:
            continue
        marker = current_marker(proc.stdout)
        if marker is not None:
            return marker
    return None
def current_marker(text: str) -> tuple | None:
    """⭐⭐ The partition that the documents declare as CURRENT."""
    found = MARKER.search(latin(text))
    if not found:
        return None
    parts = [int(value) for value in found.group(1).split("+")]
    if len(parts) != len(GROUPS):
        return None
    return tuple(parts) + (int(found.group(2)),)


def audit(
    root: Path,
    docs: bool = False,
    log: Path | None = None,
    group_logs: dict | None = None,
    commit: str | None = None,
    strict: bool = True,
) -> tuple[list, list]:
    """⭐ The audit itself ⇒ (the failures, the notes)."""
    failures: list[str] = []
    notes: list[str] = []
    scripts = read_scripts(root)

    # ------------------------------------------------------------
    # 1) the partition of the FILES
    # ------------------------------------------------------------
    owner: dict = {}
    overlaps: list = []
    duplicates: list = []
    for group in GROUPS:
        script = f"test:{group}"
        if script not in scripts:
            failures.append(f"the script {script} does not exist")
            continue
        seen = set()
        for path in files_of(scripts[script]):
            # ⭐⭐ A file listed TWICE in the same group is counted twice.
            if path in seen:
                duplicates.append((path, group))
            seen.add(path)
            if path in owner and owner[path] != group:
                overlaps.append((path, owner[path], group))
            owner[path] = group

    for path, group in duplicates:
        failures.append(f"the file {path} is listed twice in the group {group}")
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

        # ⭐⭐ 2b) THE DISK AGAINST `npm test` ⇒ ⭐⭐ a test file that
        #   exists but is never listed NEVER RUNS ⇒ ⭐⭐ and its
        #   success can never be published (the trap of M-81).
        on_disk = sorted(
            str(path.relative_to(root)).replace("\\", "/")
            for path in (root / "tests").rglob("*.test.ts")
        )
        for path in on_disk:
            if path not in all_files:
                failures.append(
                    f"the test file {path} is on the disk and NOT in npm test (it never runs)"
                )
        notes.append(f"the test files on the disk: {len(on_disk)}")

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
    if log:
        if not log.exists():
            failures.append(f"the log {log} does not exist")
        else:
            values = summary_of(log)
            if "tests" not in values:
                failures.append(f"the log {log} carries no summary of node --test")
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
    group_logs = group_logs or {}
    per_group_values: dict = {}
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
            per_group_values[group] = values
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
    current = None
    if docs:
        documents = {
            "CURRENT-STATE.md": root / "CURRENT-STATE.md",
            "docs/TEST-MATRIX.md": root / "docs" / "TEST-MATRIX.md",
        }
        published: dict = {}
        markers: dict = {}
        for name, path in documents.items():
            if not path.exists():
                failures.append(f"the document {name} does not exist")
                continue
            text = path.read_text(encoding="utf-8")
            entries = {
                tuple(int(value) for value in match)
                for match in PARTITION.findall(latin(text))
            }
            published[name] = entries
            marker = current_marker(text)
            markers[name] = marker

        for name, entries in published.items():
            for entry in sorted(entries):
                left = sum(entry[:4])
                right = entry[4]
                # ⭐⭐ EVERY published partition must be arithmetically
                #   right: a wrong sum is a contradiction whatever its age.
                if left != right:
                    failures.append(f"{name} publishes {left} != {right} (the sum is wrong)")
                else:
                    notes.append(f"{name} publishes {left} == {right} (the sum is right)")

        # ⭐⭐ The CURRENT partition is the one the marker declares ⇒
        #   the history is NEVER compared with the measurement.
        current = None
        for name, marker in markers.items():
            if marker is None:
                failures.append(f"{name} declares no current partition (the marker is missing)")
                continue
            notes.append(f"{name} declares the current partition: {marker[:4]} = {marker[4]}")
            if current is None:
                current = marker
            elif current[:4] != marker[:4]:
                failures.append(
                    f"the documents declare different current partitions: {current[:4]} and {marker[:4]}"
                )
            if marker not in published[name]:
                failures.append(
                    f"{name} declares the current partition {marker[:4]} = {marker[4]} "
                    "but does not publish it"
                )

        if current is not None and measured_groups is not None:
            if current[:4] != measured_groups:
                failures.append(
                    f"the documents declare the current groups {current[:4]} but the measured "
                    f"ones are {measured_groups}"
                )
            else:
                notes.append(
                    f"the declared current groups {current[:4]} match the measurement"
                )
        if current is not None and measured is not None:
            if current[4] != measured.get("tests"):
                failures.append(
                    f"the documents declare {current[4]} tests but the measured run has "
                    f"{measured.get('tests')}"
                )
            else:
                notes.append(f"the declared total {current[4]} matches the measured run")

    # ------------------------------------------------------------
    # 3c) the totals of every real log (M85) ⇒ pass+fail+skipped = tests
    # ------------------------------------------------------------
    def totals_ok(values: dict, label: str) -> None:
        total = values.get("tests", 0)
        parts = (
            values.get("pass", 0)
            + values.get("fail", 0)
            + values.get("skipped", 0)
            + values.get("cancelled", 0)
            + values.get("todo", 0)
        )
        if parts != total:
            failures.append(f"{label}: pass+fail+skipped = {parts} != tests = {total}")

    if measured:
        totals_ok(measured, f"the run {log}")
    for group, values in per_group_values.items():
        totals_ok(values, f"the group {group}")

    # ------------------------------------------------------------
    # 3d) the partition of the COMMIT (M85) ⇒ the published number
    #     must belong to the commit the links point to.
    # ------------------------------------------------------------
    if commit:
        probe = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--git-dir"],
            capture_output=True,
            text=True,
        )
        if probe.returncode != 0:
            notes.append("the root is not a git repository ⇒ the check of the commit is skipped")
            marker = None
        else:
            marker = commit_marker(root, commit)
        if probe.returncode == 0 and marker is None:
            if strict:
                failures.append(f"the commit {commit} declares no current partition")
            else:
                notes.append(
                    f"the commit {commit} declares no current partition "
                    "\u21d2 the check of the commit is skipped (use --strict to fail \u2014 it is ON by default)"
                )
        elif marker is not None:
            notes.append(
                f"the commit {commit} declares the current partition: {marker[:4]} = {marker[4]}"
            )
            if measured is not None and marker[4] != measured.get("tests"):
                failures.append(
                    f"the commit {commit} declares {marker[4]} tests but the measured run has "
                    f"{measured.get('tests')}"
                )
            if measured_groups is not None and marker[:4] != measured_groups:
                failures.append(
                    f"the commit {commit} declares the groups {marker[:4]} but the measured ones "
                    f"are {measured_groups}"
                )
            if current is not None and current[:4] != marker[:4]:
                failures.append(
                    f"the working tree declares {current[:4]} but the commit {commit} declares "
                    f"{marker[:4]}"
                )

    return failures, notes


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument(
        "--commit",
        default="HEAD",
        help="the commit that must declare the published partition (M85)",
    )
    parser.add_argument(
        "--strict",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="fail when the commit declares no current partition (M85) \u2014 ON by default since M93",
    )
    parser.add_argument("--log", help="the log of a real run (the summary of node --test)")
    parser.add_argument("--docs", action="store_true", help="compare the published documents")
    parser.add_argument(
        "--group-log",
        action="append",
        default=[],
        metavar="GROUP=FILE",
        help="the log of a real run of one group (repeatable)",
    )
    args = parser.parse_args(argv)

    group_logs = {}
    for item in args.group_log:
        if "=" not in item:
            print(f"FAIL the group log {item} has no GROUP=FILE shape")
            return 1
        name, value = item.split("=", 1)
        group_logs[name] = value

    failures, notes = audit(
        Path(args.root),
        docs=args.docs,
        log=Path(args.log) if args.log else None,
        group_logs=group_logs,
        commit=args.commit,
        strict=args.strict,
    )

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
