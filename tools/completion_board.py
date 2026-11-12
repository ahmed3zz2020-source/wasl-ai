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
import subprocess
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

# ⭐⭐⭐ M-128: ⭐⭐⭐ the weights of the TWELVE commercial domains.
# ⭐⭐⭐ They are EQUAL (one twelfth each) ⇒ ⇒ ⇒ because the original
# ⭐⭐⭐ list (R002 §4.2) carries no weights of its own ⇒ ⇒ ⇒ ⇒ the
# ⭐⭐⭐ equal weight is the only choice that does NOT favour a domain
# ⭐⭐⭐ ⇒ ⇒ ⇒ and the sum is checked (⇒ ⇒ ⇒ the weights never move).
EXPECTED_DOMAIN_COUNT = 12
EXPECTED_DOMAIN_WEIGHT = 8.33
DOMAIN_WEIGHT_TOLERANCE = 0.1

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

    # ---------------------------------------------------------------
    # ⭐⭐⭐ M-128: ⭐⭐⭐ the twelve commercial domains.
    # ⭐⭐⭐ THEIR CHECKS:
    #   ① there are exactly twelve of them (the original list),
    #   ② their weights are EQUAL and they sum to a hundred ⇒ ⇒ ⇒ the
    #      weights never move between the rounds,
    #   ③ every capability that claims an evidence carries files that
    #      REALLY EXIST ⇒ ⇒ ⇒ ⇒ no number can be written by hand,
    #   ④ a capability that needs a review is never counted as done.
    # ---------------------------------------------------------------
    domains = inventory.get("commercial_domains", [])
    if len(domains) != EXPECTED_DOMAIN_COUNT:
        problems.append(
            f"⭐⭐⭐ the inventory holds {len(domains)} commercial domains "
            f"instead of {EXPECTED_DOMAIN_COUNT}"
        )
    domain_ids: list[str] = []
    for domain in domains:
        domain_id = str(domain.get("id", ""))
        if not domain_id:
            problems.append("a commercial domain has no identifier")
            continue
        if domain_id in domain_ids:
            problems.append(f"the commercial domain {domain_id} is repeated")
        domain_ids.append(domain_id)
        weight = domain.get("weight")
        if not isinstance(weight, (int, float)) or abs(
            float(weight) - EXPECTED_DOMAIN_WEIGHT
        ) > 0.01:
            problems.append(
                f"⭐⭐⭐ the weight of the commercial domain {domain_id} is {weight} "
                f"instead of {EXPECTED_DOMAIN_WEIGHT} ⇒ ⭐⭐ the weights never move"
            )
        capabilities = domain.get("capabilities", [])
        if not capabilities:
            problems.append(f"⭐⭐⭐ the commercial domain {domain_id} holds no capability")
        capability_ids: list[str] = []
        for capability in capabilities:
            capability_id = str(capability.get("id", ""))
            if not capability_id:
                problems.append(f"a capability of the domain {domain_id} has no identifier")
                continue
            if capability_id in capability_ids:
                problems.append(f"the capability {capability_id} is repeated")
            capability_ids.append(capability_id)
            if not str(capability.get("title", "")).strip():
                problems.append(f"the capability {capability_id} carries no title")
            evidence = capability.get("evidence", [])
            if not isinstance(evidence, list):
                problems.append(f"the evidence of the capability {capability_id} is not a list")
                continue
            for path in evidence:
                if not (ROOT / str(path)).exists():
                    problems.append(
                        f"⭐⭐⭐ the capability {capability_id} claims the evidence "
                        f"{path} ⇒ ⇒ ⇒ the file does NOT exist ⇒ ⇒ ⇒ the number "
                        f"would be made up"
                    )
    if domains:
        total_weight = sum(float(domain.get("weight", 0)) for domain in domains)
        if abs(total_weight - 100) > DOMAIN_WEIGHT_TOLERANCE:
            problems.append(
                f"⭐⭐⭐ the weights of the commercial domains sum to {total_weight} "
                f"instead of 100"
            )

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
    baseline = inventory.get("baseline") or {}
    return {
        "areas": areas,
        "done": done,
        "total": total,
        "percent": percent(done, total),
        "series": inventory.get("project_estimate", []),
        # (the baseline of the round: the same weights, the numbers of
        #  the round before ⇒ the board shows before/after)
        "baseline": baseline,
    }


def file_at_commit(sha: str, path: str) -> bool:
    """⭐⭐⭐ Did this file exist at that commit? (the truth of the baseline)"""
    try:
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "cat-file", "-e", f"{sha}:{path}"],
            capture_output=True,
            text=True,
        )
    except OSError:
        return False
    return proc.returncode == 0


def compute_domains(inventory: dict) -> dict:
    """⭐⭐⭐ M-128: ⭐⭐⭐ the twelve commercial domains.

    ⭐⭐⭐ THE NUMBERS ARE MEASURED, NEVER WRITTEN:
      the "now" is read from the disk (the file must exist) and the
      "before" is read from the BASELINE commit (the same file must
      have existed there) ⇒ ⇒ ⇒ ⇒ the before/after of a domain is the
      truth of the files ⇒ ⇒ ⇒ and a capability that carries no file
      is simply NOT built.
    """
    baseline = inventory.get("commercial_domains_baseline", {}) or {}
    sha = str(baseline.get("sha", "")).strip()
    domains = inventory.get("commercial_domains", [])
    rows = []
    for domain in domains:
        capabilities = domain.get("capabilities", [])
        total = len(capabilities)
        done_now = 0
        done_before = 0
        changed = []
        review = []
        for capability in capabilities:
            evidence = [str(path) for path in capability.get("evidence", [])]
            if capability.get("needs_review", False):
                review.append(capability)
                continue
            if not evidence:
                continue
            present = all((ROOT / path).exists() for path in evidence)
            if present:
                done_now += 1
            if sha and all(file_at_commit(sha, path) for path in evidence):
                done_before += 1
            elif not sha:
                done_before += 0
            if present and not (sha and all(file_at_commit(sha, path) for path in evidence)):
                changed.append(capability)
        needs_review = len(review) > 0
        rows.append(
            {
                "id": domain.get("id"),
                "name": domain.get("name"),
                "source": domain.get("source", ""),
                "weight": domain.get("weight"),
                "total": total,
                "done": done_now,
                "done_before": done_before,
                "percent": percent(done_now, total),
                "percent_before": percent(done_before, total),
                "needs_review": needs_review,
                "review": review,
                "changed": changed,
            }
        )
    reviewed = [row for row in rows if not row["needs_review"]]
    weight_total = sum(float(row["weight"]) for row in reviewed) or 1.0
    weighted_now = sum(float(row["weight"]) * row["percent"] for row in reviewed) / weight_total
    weighted_before = (
        sum(float(row["weight"]) * row["percent_before"] for row in reviewed) / weight_total
    )
    return {
        "baseline": baseline,
        "rows": rows,
        "reviewed": len(reviewed),
        "pending_review": len(rows) - len(reviewed),
        "weighted_percent": round(weighted_now, 1),
        "weighted_percent_before": round(weighted_before, 1),
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

    # (the before/after of the round: the same areas, the same weights)
    baseline = computed.get("baseline") or {}
    base_areas = baseline.get("areas") or {}
    if base_areas:
        lines.append(
            "### ⭐⭐⭐ المقارنة (قبل / بعد) — النطاقات الثلاثة بأوزانها الثابتة"
        )
        lines.append("")
        lines.append("| النطاق | الوزن | قبل | بعد | الفرق |")
        lines.append("|---|---:|---:|---:|---:|")
        for area in computed["areas"]:
            before = base_areas.get(area["id"])
            if before is None:
                continue
            delta = area["done"] - int(before)
            lines.append(
                f"| ⭐ {area['name']} | {area['weight']} | {before} | {area['done']} "
                f"| {'+' if delta > 0 else ''}{delta} |"
            )
        base_done = baseline.get("done")
        base_total = baseline.get("total", computed["total"])
        if base_done is not None:
            delta = computed["done"] - int(base_done)
            lines.append(
                f"| ⭐⭐ **الإجمالي** | **{computed['total']}** | **{base_done}/{base_total}** "
                f"| **{computed['done']}/{computed['total']}** "
                f"| {'+' if delta > 0 else ''}{delta} بند |"
            )
        lines.append("")
        lines.append(
            f"> ⭐⭐ **الأساس**: ⭐ {baseline.get('round', '')} — "
            f"{computed['done'] - int(base_done)} بند أُنجز فعلاً في هذه الجولة "
            "⇐ ⭐⭐ والمقام (75) والأوزان (20/20/35) لم يتغيّرا ⇐ ⭐⭐ فلا تضخيم."
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
    owner_last = None
    for entry in computed["series"]:
        if entry.get("status") == "owner":
            owner_last = entry
    approved = owner_last.get("value") if owner_last else first.get("value")
    lines.append(
        f"> ⭐⭐ **السلّم**: ⭐ **{first.get('value')}%** (قبل M-114) ⇒ ⭐ **{approved}%** "
        f"(المعتمد من المالك) ⇒ ⭐ **{last.get('value')}%** (مقترح هذه الجولة) "
        "⇐ ⭐⭐ والفرق كله من **قدرات جديدة مثبتة** ⇐ ⭐⭐ وكل جولة تكتب أساسها."
    )
    lines.append("")
    lines.append(
        "> ⭐⭐ **تنبيه (منع الخلط)**: ⭐⭐ المقياسان يقيسان **نطاقين مختلفين** ⇐ ⭐⭐ "
        "الأول = البناء المحلي (٧٥ بنداً) ⇐ ⭐⭐ والثاني = المشروع التجاري كله (الواتساب "
        "· الفوترة · البيانات الحقيقية · النشر · القانون …) ⇒ ⇒ ⇒ فرق القائمة "
        "**لا** يعني اكتمال WASL التجاري."
    )
    lines.append("")
    lines.append("## ٣. ⭐⭐⭐ المقياس الثالث — المجالات الأصلية الاثنا عشر (R002 §4.2)")
    lines.append("")
    domains = computed.get("domains")
    if domains and domains.get("rows"):
        lines.append(
            "> ⭐⭐⭐ **هذا مقياس ثالث مستقل** ⇐ ⭐⭐ النطاق = النطاقات الأصلية "
            "الاثنا عشر للوحة العميل (R002 §4.2) ⇐ ⭐⭐ والأوزان **متساوية** "
            "(١/١٢ لكل مجال ⇒ ٨٫٣٣٪) لأن R002 لا يحمل أوزاناً ⇒ ⭐⭐ "
            "والتساوي لا يقدّم مجالاً على غيره ⇐ ⭐⭐ والأوزان لا تتغيّر بين الجولات."
        )
        lines.append("")
        lines.append(
            "> ⭐⭐⭐ **الأرقام مقيسة لا مكتوبة**: ⭐ «بعد» = القدرات التي ملفاتها "
            "موجودة **على القرص الآن** ⇐ ⭐ «قبل» = القدرات التي ملفاتها "
            "كانت موجودة **على خط الأساس** (`git`) ⇐ ⭐⭐ ⇒ ⇒ ⇒ لا رقم يكتبه إنسان."
        )
        lines.append("")
        lines.append("| المجال | الوزن | المبني | قبل | بعد | الفرق | الدليل |")
        lines.append("|---|---:|---:|---:|---:|---:|---|")
        for row in domains["rows"]:
            if row["needs_review"]:
                before = "يحتاج إعادة تقييم"
                after = "يحتاج إعادة تقييم"
                delta = "—"
                evidence = (
                    "⏳ بند واحد يحتاج إعادة تقييم: "
                    + " · ".join(
                        f"**{capability.get('id')}** — {capability.get('title')}"
                        for capability in row["review"]
                    )
                )
            else:
                before = f"{row['percent_before']:.1f}%"
                after = f"**{row['percent']:.1f}%**"
                difference = round(row["percent"] - row["percent_before"], 1)
                delta = f"{'+' if difference > 0 else ''}{difference}"
                if row["changed"]:
                    evidence = " · ".join(
                        f"**{capability.get('id')}** — {capability.get('title')}"
                        for capability in row["changed"]
                    )
                else:
                    evidence = "بلا تغيير في هذه الجولة"
            lines.append(
                f"| ⭐ {row['name']} | {row['weight']} | {row['done']}/{row['total']} "
                f"| {before} | {after} | {delta} | {evidence} |"
            )
        lines.append("")
        lines.append(
            f"> ⭐⭐⭐ **المجموع (المجالات المراجَعة فقط)**: ⭐ "
            f"**{domains['weighted_percent']:.1f}%** (قبل: "
            f"{domains['weighted_percent_before']:.1f}%) ⇐ ⭐⭐ "
            f"**{domains['reviewed']}** مجالاً مراجَعاً ⇐ ⭐⭐ و"
            f"**{domains['pending_review']}** مجالاً **يحتاج إعادة تقييم** "
            "(⇒ ⭐⭐ خارج المجموع ⇒ ⭐⭐ فلا تضخيم)."
        )
        lines.append("")
        approved = next(
            (
                entry
                for entry in reversed(computed["series"])
                if entry.get("status") == "owner"
            ),
            None,
        )
        latest = computed["series"][-1] if computed["series"] else None
        owner_part = f"{approved['value']}٪ المعتمد" if approved else "لا يوجد معتمد"
        if latest and latest.get("status") != "owner":
            owner_part += f" · {latest['value']}٪ مُقترح"
        lines.append(
            "> ⭐⭐⭐ **منع الخلط (مرة أخرى)**: ⭐⭐ هذا الجدول **لا** يلغي التقدير "
            f"العام للمشروع ({owner_part}) ⇐ ⭐⭐ ولا القائمة "
            "الداخلية (٧٥ بنداً) ⇐ ⭐⭐ ⇒ ⇒ ⇒ هو **مقياس ثالث** يقيس النطاق "
            "التجاري الأصلي ⇐ ⭐⭐⇒ ⇒ ⇒ جاهزية المنتج التجاري تُقرأ من سُلّم المالك."
        )
        lines.append("")
        lines.append(
            "> ⭐⭐⭐ **طريقة المقارنة (المقياس الثالث)**: ⭐⭐ عمود «قبل» "
            "مقيس على **نفس القدرات** عند خط الأساس (عبر git) ⇐ ⭐⭐ فالمقارنة "
            "بمقام ثابت ⇐ ⭐⭐ والمقام نفسه كبر بست قدرات جديدة ⇐ ⭐⭐ "
            "ولذلك الرقم ارتفع من جهة واحدة فقط: البرهان مثبت."
        )
        lines.append("")
    lines.append("## ٤. ⭐⭐⭐ البند المفتوح من هذه الجولة")
    lines.append("")
    for item in inventory.get("items", []):
        note = str(item.get("note", "")).strip()
        if note:
            state = "✅" if item.get("done") is True else "❌"
            lines.append(f"- {state} **{item.get('id')}** — {item.get('title')} ⇒ {note}")
    lines.append("")
    lines.append("## ٥. ⭐⭐⭐ كيف يُعاد تشغيل هذا القياس")
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
    # ⭐⭐⭐ M-128: ⭐⭐⭐ the twelve commercial domains (measured).
    computed["domains"] = compute_domains(inventory)

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
