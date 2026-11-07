#!/usr/bin/env python3
"""⭐ Audit the internal references (§N) INSIDE the reply sections only.

The rule (D-071): every internal reference («§N») must point at a
section that EXISTS ⇒ ⭐ a renumbering of the history breaks every old
reference ⇒ ⭐ this tool finds them.

⭐ Only the references INSIDE the "آخر رد" sections are checked: a
reference to «§٠» of ANOTHER file is not a reference to this file.

الاستخدام:
    python3 tools/audit_section_refs.py <file>
"""
import re
import sys
from pathlib import Path

ARABIC = "٠١٢٣٤٥٦٧٨٩"
TO_LATIN = {ch: str(i) for i, ch in enumerate(ARABIC)}


def latin(text: str) -> str:
    return "".join(TO_LATIN.get(ch, ch) for ch in text)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    lines = path.read_text(encoding="utf-8").splitlines()

    # ⭐ The sections of THIS file: "## ٣. ..." and "### ٣.١ ...".
    headings = set()
    for line in lines:
        match = re.match(r"^#{1,4}\s+([٠-٩0-9]+)(\.|\s)", latin(line))
        if match:
            headings.add(int(latin(match.group(1))))

    # ⭐ A reference is INTERNAL when it names a section of this file:
    #   the tool only accepts a reference whose target exists here.
    problems = []
    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith(">"):
            continue
        for match in re.finditer(r"§\s*([٠-٩0-9]+)", latin(line)):
            value = int(match.group(1))
            # ⭐ §٠ is the "first section" of ANOTHER file in these tables.
            if value == 0:
                continue
            if value not in headings:
                problems.append((number, value, stripped[:110]))

    for number, value, line in problems:
        print(f"REF {path.name}:{number} §{value} => {line}")
    if problems:
        print(f"\n{len(problems)} broken reference(s)")
        return 1
    print(f"OK: every internal §N of {path.name} points at an existing section")
    return 0


if __name__ == "__main__":
    sys.exit(main())
