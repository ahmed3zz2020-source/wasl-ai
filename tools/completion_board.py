#!/usr/bin/env python3
"""============================================================
WASL AI — M-118 — the board of the completion (لوحة نسب الإنجاز)
------------------------------------------------------------
⭐⭐ WHAT THIS TOOL DOES
   ① it READS the inventory (`docs/completion-board.json`) ⇒ ⇒ ⇒
      the numbers are NEVER written by hand;
   ② it CHECKS the inventory (the weights are fixed · every done
      item carries its evidence · the denominator is 75) ⇒ ⇒ ⇒ a
      board cannot grow its own denominator;
   ③ it RENDERS the board (`docs/COMPLETION-BOARD.md`) and it
      VERIFIES the published file against the computed one ⇒ ⇒ ⇒
      a stale published number is a FAILURE (the lesson of M-115);
   ④ it prints the two gauges with the fixed method:
      ⭐ the measurable list (75 items · three areas) and
      ⭐ the overall estimate of the project (the owner's scale).

⭐⭐ THE METHOD (it does NOT change between the rounds)
   ⭐ the areas keep their weights (20 / 20 / 35 ⇒ 75 items);
   ⭐ an item is done ⇐ it has its evidence (a test or a file);
   ⭐ the overall estimate advances ONLY by a round that delivered
     a proven capability ⇒ ⇒ ⇒ and the basis of every advance is
     written in the inventory (⇒ ⇒ ⇒ the next round is comparable).

⛔ LOCAL ONLY: no network, no database, no external service.
============================================================
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# ⭐⭐ the inventory may be pointed elsewhere (a proof tampers with a
# ⭐⭐ COPY of it ⇒ ⭐⭐ the real one is never touched).
INVENTORY = Path(os.environ.get("WASL_BOARD_INVENTORY", ROOT / "docs" / "completion-board.json"))
PUBLISHED = ROOT / "docs" / "COMPLETION-BOARD.md"

# ⭐⭐ THE FIXED WEIGHTS (the denominator never changes).
EXPECTED_WEIGHTS = {"ui": 20, "tickets": 20, "platform": 35}
EXPECTED_TOTAL = 75

ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"


def to_arabic(value: int) -> str:
    return "".join(ARABIC_DIGITS[int(digit)] for digit in str(value))


def percent(done: int, total: int) -> float:
    return round((done / total) * 100, 1) if total else 0.0


def load_inventory(path: Path = INVENTORY) -> dict:
    if not path.exists():
        raise SystemExit(f"the inventory is missing: {path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def check_inventory(inventory: dict) -> list[str]:
    """⭐⭐⭐ THE CHECKS (every one of them is a FAILURE, not a warning)."""
    problems: list[str] = []

    weights = inventory.get("weights", {})
    if weights != EXPECTED_WEIGHTS:
        problems.append(
            f"the weights changed: {weights} instead of {EXPECTED_WEIGHTS} "
            "⇒ ⭐⭐ the denominator of the board must never move"
        )

    areas = inventory.get("areas", [])
    area_ids = [area.get("id") for area in areas]
    for area in areas:
        if area.get("weight") != weights.get(area.get("id")):
            problems.append(
                f"the weight of the area {area.get('id')} does not match the weight of the inventory"
            )
    if len(area_ids) != len(set(area_ids)):
        problems.append("the areas are not unique")

    items = inventory.get("items", [])
    if len(items) != EXPECTED_TOTAL:
        problems.append(
            f"the inventory holds {len(items)} items instead of {EXPECTED_TOTAL} "
            "⇒ ⭐⭐ the denominator must never move"
        )

    seen: set[str] = set()
    for item in items:
        item_id = str(item.get("id", ""))
        if not item_id:
            problems.append("an item has no identifier")
            continue
        if item_id in seen:
            problems.append(f"the item {item_id} is repeated")
        seen.add(item_id)
        if item.get("area") not in area_ids:
            problems.append(f"the item {item_id} is in an unknown area: {item.get('area')}")
        if item.get("done") is True:
            evidence = str(item.get("evidence", "")).strip()
            if not evidence:
                problems.append(
                    f"⭐⭐⭐ the item {item_id} is marked as done WITHOUT evidence "
                    "⇒ ⭐⭐ a done item must carry its proof"
                )
            if not str(item.get("round", "")).strip():
                problems.append(f"⭐⭐⭐ the item {item_id} is done without the round that did it")

    # ⭐⭐⭐ the count of every area must be its weight.
    for area in areas:
        area_id = area.get("id")
        count = len([item for item in items if item.get("area") == area_id])
        if count != area.get("weight"):
            problems.append(
                f"⭐⭐⭐ the area {area_id} holds {count} items instead of {area.get('weight')}"
            )

    # ⭐⭐ the series of the overall estimate must be ordered and sane.
    series = inventory.get("project_estimate", [])
    if not series:
        problems.append("⭐⭐⭐ the series of the overall estimate is empty")
    previous = None
    for entry in series:
        value = entry.get("value")
        if not isinstance(value, (int, float)):
            problems.append(f"the estimate {entry.get('round')} carries no number")
            continue
        if not 0 <= value <= 100:
            problems.append(f"the estimate {entry.get('round')} is out of the range: {value}")
        if previous is not None and value < previous:
            problems.append(
                f"⭐⭐⭐ the estimate went BACKWARDS: {entry.get('round')} ({value} < {previous})"
            )
        if not str(entry.get("basis", "")).strip():
            problems.append(f"⭐⭐⭐ the estimate {entry.get('round')} carries no basis")
        previous = value

    return problems


def compute(inventory: dict) -> dict:
    """⭐⭐⭐ THE COMPUTATION (the same method in every round)."""
    areas = []
    for area in inventory.get("areas", []):
        items = [item for item in inventory.get("items", []) if item.get("area") == area.get("id")]
        done = len([item for item in items if item.get("done") is True])
        total = len(items)
        areas.append(
            {
                "id": area.get("id"),
                "name": area.get("name"),
                "weight": area.get("weight"),
                "done": done,
                "total": total,
                "percent": percent(done, total),
            }
        )
    items = inventory.get("items", [])
    done = len([item for item in items if item.get("done") is True])
    total = len(items)
    return {
        "areas": areas,
        "done": done,
        "total": total,
        "percent": percent(done, total),
        "series": inventory.get("project_estimate", []),
    }


def render(inventory: dict, computed: dict) -> str:
    """⭐⭐⭐ THE RENDERING (the published file is compared with it)."""
    lines: list[str] = []
    lines.append("# ⭐ لوحة نسب الإنجاز — WASL AI")
    lines.append("")
    lines.append(
        "> ⭐⭐ **هذا الملف مُولَّد** — ⭐⭐ `python3 tools/completion_board.py --write` "
        "⇒ ⇒ ⇒ ولا يُكتب بخط اليد ⇒ ⇒ ⇒ والرقم المنشور لا يمكن أن يخالف ما حُسب."
    )
    lines.append(
        "> ⭐⭐ **المصدر الوحيد**: `docs/completion-board.json` · ⭐⭐ **الطريقة لا تتغيّر "
        "بين الجولات**: ⭐ الأوزان ثابتة (٢٠ / ٢٠ / ٣٥ ⇒ ٧٥ بنداً) ⇐ ⭐ والبند المُنجَز "
        "له دليل ⇐ ⭐⇒ ⇒ ⇒ فلا تضخيم في المقام ولا في النسب."
    )
    lines.append("")
    lines.append("## ١. ⭐⭐⭐ المقياس الأول — القائمة الداخلية (٧٥ بنداً · مرجعها قابل للتشغيل)")
    lines.append("")
    lines.append("| النطاق | الوزن | المُنجَز | الإجمالي | النسبة |")
    lines.append("|---|---:|---:|---:|---:|")
    for area in computed["areas"]:
        lines.append(
            f"| ⭐ {area['name']} | {area['total']} | {area['done']} | {area['total']} "
            f"| **{area['percent']:.1f}%** |"
        )
    lines.append(
        f"| ⭐⭐ **الإجمالي** | **{computed['total']}** | **{computed['done']}** "
        f"| **{computed['total']}** | **{computed['percent']:.1f}%** |"
    )
    lines.append("")
    lines.append(
        f"> ⭐⭐ **الرقم**: ⭐ **{computed['done']}/{computed['total']} = {computed['percent']:.1f}%** "
        "⇐ ⭐⭐ ولكل بند مُنجَز سطر بدليله في `docs/completion-board.json`."
    )
    lines.append("")
    lines.append("## ٢. ⭐⭐⭐ المقياس الثاني — التقدير العام للمشروع (سلّم المالك)")
    lines.append("")
    lines.append("| الجولة | النسبة | الحالة | الأساس |")
    lines.append("|---|---:|---|---|")
    for entry in computed["series"]:
        status = "✅ مُعتمد" if entry.get("status") == "owner" else "🟡 مُقترح (بانتظار المالك)"
        lines.append(
            f"| {entry.get('round')} | **{entry.get('value')}%** | {status} | {entry.get('basis')} |"
        )
    lines.append("")
    first = computed["series"][0] if computed["series"] else {"value": 0}
    last = computed["series"][-1] if computed["series"] else {"value": 0}
    lines.append(
        f"> ⭐⭐ **السلّم**: ⭐ **{first.get('value')}%** (قبل M-114) ⇒ ⭐ **{last.get('value')}%** "
        "(بعد هذه الجولة) ⇐ ⭐⭐ والفرق كله من **قدرات جديدة مثبتة** ⇐ ⭐⭐ وكل جولة تكتب أساسها."
    )
    lines.append("")
    lines.append(
        "> ⭐⭐ **تنبيه (منع الخلط)**: ⭐⭐ المقياسان يقيسان **نطاقين مختلفين** ⇐ ⭐⭐ "
        "الأول = البناء المحلي (٧٥ بنداً) ⇐ ⭐⭐ والثاني = المشروع التجاري كله (الواتساب "
        "· الفوترة · البيانات الحقيقية · النشر · القانون …) ⇒ ⇒ ⇒ فرق القائمة "
        "**لا** يعني اكتمال WASL التجاري."
    )
    lines.append("")
    lines.append("## ٣. ⭐⭐⭐ البند المفتوح من هذه الجولة")
    lines.append("")
    for item in inventory.get("items", []):
        note = str(item.get("note", "")).strip()
        if note:
            state = "✅" if item.get("done") is True else "❌"
            lines.append(f"- {state} **{item.get('id')}** — {item.get('title')} ⇒ {note}")
    lines.append("")
    lines.append("## ٤. ⭐⭐⭐ كيف يُعاد تشغيل هذا القياس")
    lines.append("")
    lines.append("```bash")
    lines.append("python3 tools/completion_board.py --check   # ⭐⭐ يفحص ولا يكتب")
    lines.append("python3 tools/completion_board.py --write   # ⭐⭐ يولّد الملف المنشور")
    lines.append("node --experimental-strip-types --test tests/tools/completion-board.test.ts")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="the board of the completion of WASL")
    parser.add_argument("--write", action="store_true", help="write the published board")
    parser.add_argument("--check", action="store_true", help="verify the published board")
    parser.add_argument("--json", action="store_true", help="print the computed numbers as JSON")
    args = parser.parse_args(argv)

    inventory = load_inventory()
    problems = check_inventory(inventory)
    computed = compute(inventory)

    if args.json:
        print(json.dumps(computed, ensure_ascii=False, indent=2))

    for problem in problems:
        print(f"COMPLETION BOARD PROBLEM: {problem}", file=sys.stderr)

    if problems:
        print("COMPLETION BOARD AUDIT FAILED", file=sys.stderr)
        return 1

    rendered = render(inventory, computed)

    if args.write:
        PUBLISHED.write_text(rendered, encoding="utf-8")
        print(f"the board is written: {PUBLISHED}")
        return 0

    if args.check:
        if not PUBLISHED.exists():
            print(f"COMPLETION BOARD PROBLEM: the published board is missing: {PUBLISHED}", file=sys.stderr)
            print("COMPLETION BOARD AUDIT FAILED", file=sys.stderr)
            return 1
        published = PUBLISHED.read_text(encoding="utf-8")
        if published != rendered:
            print(
                "COMPLETION BOARD PROBLEM: the published board is STALE "
                "⇒ ⭐⭐ run `python3 tools/completion_board.py --write`",
                file=sys.stderr,
            )
            print("COMPLETION BOARD AUDIT FAILED", file=sys.stderr)
            return 1
        print("COMPLETION BOARD AUDIT OK")
        return 0

    # ⭐⭐ the JSON is the ONLY output when it is asked for (a machine
    # ⭐⭐ reads it ⇒ ⭐⭐ nothing else may be mixed with it).
    if args.json:
        return 0

    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
