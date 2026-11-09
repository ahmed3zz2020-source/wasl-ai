#!/usr/bin/env python3
"""WASL AI — M113 — the guard of the published numbers.

⭐⭐ WHY THIS TOOL EXISTS
  The review of reply #54 found THREE real contradictions in the published
  documents:
    ① the report of the round announced 933 tests while a published state
      file announced 932 (the same run, two numbers),
    ② the published review log did not show #54 as the latest reply,
    ③ the decision D-077 shipped with unreplaced placeholders
      (__TOTAL__ · __PASS__ · __PARTITION__).

⭐⭐ WHAT IT CHECKS
  1) PLACEHOLDERS  no published document carries an unreplaced
     placeholder (__WORD__) ⇒ ⭐⭐ a decision can never ship with a hole
     in its numbers.
  2) THE MARKERS   every document that states the current totals carries
     the same machine-readable marker:
         <!-- wasl:current-total 933 = 932 pass + 0 fail + 1 skipped -->
     ⇒ ⭐⭐ and all the markers must agree with each other.
  3) THE PROSE     the numbers written by hand inside the current scope
     of every document (the pass count, the fail count, the total) must
     agree with the marker ⇒ ⭐⭐ a document cannot say "931 successful"
     while the marker says 932.
  4) THE MEASUREMENT  with --log, the marker must equal the summary that
     `node --test` printed in a real run ⇒ ⭐⭐ the numbers are never a
     guess.

⭐ THE HISTORY IS NOT TOUCHED
  Only the CURRENT scope of every document is read ⇒ ⭐⭐ the numbers of
  the old rounds stay in the documents on purpose (they are a record).

الاستخدام:
    python3 tools/published_numbers_audit.py
    python3 tools/published_numbers_audit.py --log /workspace/r54-full.log
    python3 tools/published_numbers_audit.py --root <dir>
"""
import argparse
import re
import sys
from pathlib import Path

# ⭐⭐ The documents that are published (and that a reader reads).
PUBLISHED_GLOBS = [
    "DECISIONS.md",
    "CURRENT-STATE.md",
    "SESSION-NOTES.md",
    "docs/*.md",
    "logs/*.md",
]

# ⭐⭐ The documents that carry the CURRENT numbers, and how to cut their
#     current scope out of the file.
SCOPES = {
    "CURRENT-STATE.md": "first-dot-zero",
    "DECISIONS.md": "last-decision",
    "docs/CHATGPT-REVIEW-LOG.md": "third-heading",
    "docs/TEST-MATRIX.md": "first-heading",
}

MARKER = re.compile(
    r"<!--\s*wasl:current-total\s+(\d+)\s*=\s*(\d+)\s+pass\s*\+\s*(\d+)\s+fail"
    r"\s*\+\s*(\d+)\s+skipped\s*-->"
)

# ⭐⭐ A placeholder that was never replaced.
PLACEHOLDER = re.compile(r"__[A-Z][A-Z_]*__")

# ⭐⭐ The numbers written by hand (Arabic-Indic and Latin).
DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u0640]")
PASS_AR = re.compile(r"(\d+)\s*\u0646\u0627\u062c\u062d")
FAIL_AR = re.compile(r"(\d+)\s*\u0641\u0627\u0634\u0644")
TOTAL_AR = re.compile(
    r"(\d+)\s*(?:\u0627\u062e\u062a\u0628\u0627\u0631\u0627(?!\u062a)|\u0627\u062e\u062a\u0628\u0627\u0631(?!\u0627))"
)
ARROW_AR = re.compile(r"(\d+)\s*(?:\u21d2|=>)\s*(\d+)\s*\u0646\u0627\u062c\u062d")
PASS_LA = re.compile(r"(\d+)\s+of\s+the\s+(\d+)\s+pass")
FAIL_LA = re.compile(r"(\d+)\s+fail")
TOTAL_LA = re.compile(r"(\d+)\s+tests?")
PARTITION = re.compile(r"(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)")

DIGITS = {chr(0x0660 + i): str(i) for i in range(10)}
DIGITS.update({str(i): str(i) for i in range(10)})


def latin(text: str) -> str:
    return "".join(DIGITS.get(char, char) for char in text)


def normalize(text: str) -> str:
    """⭐ The diacritics go away and the digits become Latin ones."""
    return latin(DIACRITICS.sub("", text))


def headings(text: str) -> list:
    return [(match.start(), match.group(1)) for match in re.finditer(r"^## (.+)$", text, re.M)]


def scope_of(text: str, kind: str) -> str:
    """⭐⭐ The current scope of a document (the history is cut away)."""
    marks = headings(text)
    if kind == "first-heading":
        if not marks:
            return text
        start = marks[0][0]
        end = marks[1][0] if len(marks) > 1 else len(text)
        return text[start:end]
    if kind == "third-heading":
        if len(marks) < 3:
            return text
        start = marks[2][0]
        end = marks[3][0] if len(marks) > 3 else len(text)
        return text[start:end]
    if kind == "first-dot-zero":
        for start, title in marks:
            if re.match(r"^\S+\.\S+-", title.strip()):
                end = len(text)
                for other_start, _ in marks:
                    if other_start > start:
                        end = other_start
                        break
                return text[start:end]
        return text
    if kind == "last-decision":
        chosen = None
        for start, title in marks:
            if re.match(r"^D-\d+", title.strip()):
                chosen = start
        if chosen is None:
            return text
        end = len(text)
        for other_start, _ in marks:
            if other_start > chosen:
                end = other_start
                break
        return text[chosen:end]
    return text


def published_files(root: Path) -> list:
    files = []
    for pattern in PUBLISHED_GLOBS:
        for path in sorted(root.glob(pattern)):
            if path.is_file():
                files.append(path)
    return files


def newest_request(root: Path) -> Path | None:
    """⭐ The newest published reply request (the current round)."""
    best = None
    best_number = -1
    for path in (root / "docs").glob("GPT-REVIEW-*-REQUEST.md"):
        found = re.search(r"GPT-REVIEW-(\d+)-REQUEST", path.name)
        if not found:
            continue
        number = int(found.group(1))
        if number > best_number:
            best_number = number
            best = path
    return best


def audit(root: Path, log: Path | None = None) -> tuple:
    failures = []
    notes = []

    # ------------------------------------------------------------
    # 1) the placeholders
    # ------------------------------------------------------------
    placeholders = 0
    for path in published_files(root):
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in PLACEHOLDER.finditer(text):
            failures.append(
                "the document " + path.name + " carries an unreplaced placeholder: " + match.group(0)
            )
            placeholders += 1
    notes.append("the placeholders that were never replaced: " + str(placeholders))

    # ------------------------------------------------------------
    # 2) the markers
    # ------------------------------------------------------------
    scopes = {}
    for name, kind in SCOPES.items():
        path = root / name
        if not path.exists():
            failures.append("the document " + name + " does not exist")
            continue
        scopes[name] = scope_of(path.read_text(encoding="utf-8", errors="replace"), kind)
    request = newest_request(root)
    if request is not None:
        scopes[request.relative_to(root).as_posix()] = request.read_text(
            encoding="utf-8", errors="replace"
        )

    markers = {}
    for name, text in scopes.items():
        found = MARKER.search(text)
        if found is None:
            failures.append("the document " + name + " declares no current-total marker")
            continue
        markers[name] = tuple(int(value) for value in found.groups())

    unique = set(markers.values())
    if len(unique) > 1:
        failures.append("the documents declare different current totals: " + str(markers))
    elif unique:
        notes.append("the current total declared by every document: " + str(unique.pop()))

    # ------------------------------------------------------------
    # 3) the prose against the marker
    # ------------------------------------------------------------
    for name, text in scopes.items():
        if name not in markers:
            continue
        total, passed, failed, skipped = markers[name]
        flat = normalize(text)
        for value in PASS_AR.findall(flat)[:1]:
            if int(value) != passed:
                failures.append(
                    "the document " + name + " says " + value + " successful while the marker says "
                    + str(passed)
                )
        for value in FAIL_AR.findall(flat)[:1]:
            if int(value) != failed:
                failures.append(
                    "the document " + name + " says " + value + " failed while the marker says "
                    + str(failed)
                )
        for value in TOTAL_AR.findall(flat)[:1]:
            if int(value) != total:
                failures.append(
                    "the document " + name + " says " + value + " tests while the marker says "
                    + str(total)
                )
        for left, right in ARROW_AR.findall(flat):
            if int(left) != total or int(right) != passed:
                failures.append(
                    "the document " + name + " writes the headline " + left + " => " + right
                    + " while the marker says " + str(total) + " => " + str(passed)
                )
        for right, left in PASS_LA.findall(flat)[:1]:
            if int(right) != passed or int(left) != total:
                failures.append(
                    "the document " + name + " writes " + right + " of the " + left
                    + " pass while the marker says " + str(total) + " => " + str(passed)
                )
        for value in FAIL_LA.findall(flat)[:1]:
            if int(value) != failed:
                failures.append(
                    "the document " + name + " says " + value + " fail while the marker says "
                    + str(failed)
                )
        for value in TOTAL_LA.findall(flat)[:1]:
            if int(value) != total:
                failures.append(
                    "the document " + name + " says " + value + " tests while the marker says "
                    + str(total)
                )
        for parts in PARTITION.findall(flat):
            if sum(int(value) for value in parts[:4]) != int(parts[4]):
                failures.append("the document " + name + " publishes a partition whose sum is wrong")
            elif int(parts[4]) != total:
                failures.append(
                    "the document " + name + " publishes the partition " + parts[4]
                    + " while the marker says " + str(total)
                )

    # ------------------------------------------------------------
    # 4) the measurement
    # ------------------------------------------------------------
    if log:
        if not log.exists():
            failures.append("the log " + str(log) + " does not exist")
        else:
            summary = {}
            for match in re.finditer(r"^#\s+(tests|pass|fail|skipped)\s+(\d+)\s*$", log.read_text(
                encoding="utf-8", errors="replace"
            ), re.M):
                summary[match.group(1)] = int(match.group(2))
            if "tests" not in summary:
                failures.append("the log " + str(log) + " carries no summary of node --test")
            else:
                notes.append(
                    "the measured run: tests=" + str(summary.get("tests"))
                    + " pass=" + str(summary.get("pass"))
                    + " fail=" + str(summary.get("fail"))
                    + " skipped=" + str(summary.get("skipped"))
                )
                for name, marker in markers.items():
                    measured = (
                        summary.get("tests"),
                        summary.get("pass"),
                        summary.get("fail"),
                        summary.get("skipped"),
                    )
                    if marker != measured:
                        failures.append(
                            "the document " + name + " declares " + str(marker)
                            + " but the measured run is " + str(measured)
                        )
                    else:
                        notes.append("the document " + name + " declares the measured run")

    return failures, notes


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--log", help="the log of a real run (the summary of node --test)")
    args = parser.parse_args(argv)

    failures, notes = audit(Path(args.root), Path(args.log) if args.log else None)
    for note in notes:
        print("- " + note)
    for failure in failures:
        print("FAIL " + failure)
    if failures:
        print("\n" + str(len(failures)) + " problem(s)")
        return 1
    print("\nPUBLISHED NUMBERS AUDIT OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
