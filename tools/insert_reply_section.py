#!/usr/bin/env python3
"""WASL AI — reply log — insert a new section 3 and renumber the history.

⭐⭐ WHAT IT DOES (mechanically, so the numbers cannot drift):
  ① the headings "## N." (N >= 3) are shifted by +1 (Arabic-Indic digits),
  ② the new section 3 (the file passed as --new) is inserted before them,
  ③ the stamp of the file is updated to the new reply,
  ④ a renumbering note is added (the old ones stay),
  ⑤ the row of the new reply is added to the short log of section 2.

⭐⭐ THE HISTORY IS NOT TOUCHED: only the NUMBER of a heading moves.
    The text inside a historical section is never renumbered.
"""
import argparse
import re
from pathlib import Path

DIGITS = {chr(0x0660 + i): str(i) for i in range(10)}
DIGITS.update({str(i): str(i) for i in range(10)})

STAR = "⭐"          # ⭐
ARROW = "⇒"         # ⇒
BOLD = "**"


def to_latin(text: str) -> str:
    return "".join(DIGITS.get(char, char) for char in text)


def to_arabic(text: str) -> str:
    return "".join(chr(0x0660 + int(char)) if char.isdigit() else char for char in text)


def stars(count: int) -> str:
    return STAR * count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", required=True)
    parser.add_argument("--new", required=True)
    parser.add_argument("--reply-old", required=True)
    parser.add_argument("--reply-new", required=True)
    parser.add_argument("--note", required=True, help="the body of the renumbering note")
    parser.add_argument("--row", required=True, help="the row of section 2 (without the leading |)")
    args = parser.parse_args()

    log = Path(args.log)
    text = log.read_text(encoding="utf-8")
    new_section = Path(args.new).read_text(encoding="utf-8").rstrip() + "\n"

    # ---------------------------------------------------------------
    # ① the renumbering of the headings (from the bottom to the top
    #    ⇒ a heading is never renumbered twice)
    # ---------------------------------------------------------------
    marks = list(re.finditer(r"^## ([٠-٩0-9]+)\. ", text, re.M))
    numbers = [int(to_latin(m.group(1))) for m in marks]
    print("the headings before:", numbers)

    for match in sorted(marks, key=lambda m: m.start(), reverse=True):
        value = match.group(1)
        number = int(to_latin(value))
        if number < 3:
            continue
        old = "## " + value + ". "
        new = "## " + to_arabic(str(number + 1)) + ". "
        position = text.index(old, match.start())
        text = text[:position] + new + text[position + len(old):]

    # ---------------------------------------------------------------
    # ② the new section 3 (before the section that was 3)
    # ---------------------------------------------------------------
    anchor = "## " + to_arabic("4") + ". "
    if anchor not in text:
        print("FAIL the anchor of the new section 3 was not found")
        return 1
    position = text.index(anchor)
    text = text[:position] + new_section + "\n" + text[position:]

    # ---------------------------------------------------------------
    # ③ the stamp
    # ---------------------------------------------------------------
    old_stamp = "آخر ردّ مُنفَّذ = #" + args.reply_old
    new_stamp = "آخر ردّ مُنفَّذ = #" + args.reply_new
    if old_stamp not in text:
        print("FAIL the stamp was not found")
        return 1
    text = text.replace(old_stamp, new_stamp, 1)

    # ---------------------------------------------------------------
    # ④ the renumbering note (the newest note goes first)
    # ---------------------------------------------------------------
    notes = re.findall(r"^> .*تنبيه ترقيم.*$", text, re.M)
    if not notes:
        print("FAIL no renumbering note was found to anchor the new one")
        return 1
    first_note = notes[0]
    new_note = "> " + stars(38) + " تنبيه ترقيم (جولة M121..M125 + D-082): " + args.note
    text = text.replace(first_note, new_note + "\n\n" + first_note, 1)

    # ---------------------------------------------------------------
    # ⑤ the row of the new reply in the short log of section 2
    # ---------------------------------------------------------------
    lines = text.split("\n")
    last_row = None
    for index, line in enumerate(lines):
        if re.match(r"^\| \*\*[٠-٩0-9]+\*\* \|", line):
            last_row = index
    if last_row is None:
        print("FAIL the short log of section 2 has no row")
        return 1
    row = args.row.strip()
    if not row.startswith("|"):
        row = "| " + row
    if not row.endswith("|"):
        row = row + " |"
    lines.insert(last_row + 1, row)
    text = "\n".join(lines)

    log.write_text(text, encoding="utf-8")
    print("OK the reply log was updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
