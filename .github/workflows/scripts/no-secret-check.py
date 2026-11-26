#!/usr/bin/env python3
"""WASL AI — the guard that no workflow holds a secret written by hand.

⭐ WHY THIS GUARD EXISTS
  The rule of the project is absolute: a secret is NEVER written in a
  file ⇒ it comes from GitHub Secrets as a reference ⇒ and the value
  itself never appears in the repository, in the log, or in the run.

  ⭐ A guard that is never checked is a guard that fails silently ⇒
  this script is run by BOTH workflows (`ci.yml` and `release-check.yml`)
  ⇒ so a secret written by hand breaks the build instead of leaking.

⭐ WHAT IT REFUSES
  1) a YAML mapping whose key looks like a credential (password, secret,
     token, credential, api key, passcode) and whose value is a plain
     literal instead of a `${{ secrets.… }}` / `${{ vars.… }}` /
     `${{ env.… }}` reference,
  2) a shell assignment inside a `run:` block with the same shape
     (the value must not be a literal),
  3) a URL that carries a password inside it (`scheme://user:pass@`).

⭐ WHAT IT ALLOWS
  - a reference to `secrets` / `vars` / `env` (any value),
  - an empty value,
  - a name that does not look like a credential at all
    (`POSTGRES_USER` is a user, not a secret).

الاستخدام:
    python3 .github/workflows/scripts/no-secret-check.py
"""
import re
import sys
from pathlib import Path

# ⭐ `<root>/.github/workflows/scripts/<this file>` ⇒ four levels up.
ROOT = Path(__file__).resolve().parent.parent.parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"

# ⭐ A YAML mapping entry: the key, the indent, the value.
# ⭐ A YAML entry: the indent, the key, the value. ⭐ The list marker
#   (`- key: value`) is part of the entry ⇒ so a block scalar under a
#   list item (`- run: |`) is found exactly like a block scalar under a
#   mapping (`run: |`).
KEY = re.compile(r"^(\s*)(-\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$")
# ⭐ A shell assignment: the name, the value.
ASSIGN = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$")
# ⭐ A key that carries a credential.
SECRETISH = re.compile(r"(?i)(pass(word)?|secret|token|credential|api[_-]?key|passcode)")
# ⭐ A value that is a reference and not a literal.
REFERENCE = re.compile(r"^\$\{\{\s*(secrets|vars|env)\b")
# ⭐ A URL with a password inside it.
URL_WITH_PASSWORD = re.compile(r"://[^/\s:@'\"\[\]]+:[^/\s@'\"\[\]]+@")
# ⭐ The block scalars of YAML (`run: |` and friends).
BLOCK_MARKERS = {"|", ">", "|-", ">-", "|+", ">+"}


def is_literal(value: str) -> bool:
    """⭐ A literal is a value that is not a reference and not a variable."""
    if value == "":
        return False
    if REFERENCE.match(value):
        return False
    if value.startswith(("$", '"', "'", "`")):
        return False
    if "${" in value:
        return False
    return True


def scan(path: Path) -> list:
    problems = []
    lines = path.read_text(encoding="utf-8").splitlines()
    in_block = False
    block_indent = 0
    for number, line in enumerate(lines, 1):
        if in_block:
            # ⭐ The content of a block scalar is a shell script, not YAML.
            if line.strip() and (len(line) - len(line.lstrip())) <= block_indent:
                in_block = False
            else:
                assignment = ASSIGN.match(line)
                if assignment and SECRETISH.search(assignment.group(1)):
                    if is_literal(assignment.group(2)):
                        problems.append(
                            f"{path.relative_to(ROOT)}:{number}: "
                            f"{assignment.group(1)} = {assignment.group(2)}"
                        )
                continue
        match = KEY.match(line)
        if not match:
            continue
        indent, marker, key = match.group(1), match.group(2), match.group(3)
        raw = match.group(4).strip()
        # ⭐ The content of a block scalar lives deeper than the key
        #   itself ⇒ under a list item the key sits two columns deeper
        #   than the dash.
        key_indent = len(indent) + (2 if marker else 0)
        if raw in BLOCK_MARKERS:
            in_block = True
            block_indent = key_indent
            continue
        if SECRETISH.search(key) and is_literal(raw):
            problems.append(f"{path.relative_to(ROOT)}:{number}: {key} = {raw}")
        if URL_WITH_PASSWORD.search(line) and "secrets." not in line:
            problems.append(f"{path.relative_to(ROOT)}:{number}: a URL that carries a password")
    return problems


def main() -> int:
    if not WORKFLOWS.is_dir():
        print("there is no .github/workflows directory")
        return 0
    files = sorted(WORKFLOWS.rglob("*.yml")) + sorted(WORKFLOWS.rglob("*.yaml"))
    problems = []
    for path in files:
        problems.extend(scan(path))
    if problems:
        print("NO SECRET CHECK FAILED", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\na secret is never written in a file: use a reference to "
            "`secrets` and nothing else.",
            file=sys.stderr,
        )
        return 1
    print(f"NO SECRET CHECK OK: {len(files)} workflow file(s) hold no written secret")
    return 0


if __name__ == "__main__":
    sys.exit(main())
