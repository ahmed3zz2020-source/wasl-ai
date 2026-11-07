#!/usr/bin/env python3
"""⭐ رسالة GPT الجاهزة — تُولَّد آلياً من آخر commit منشور (ما تتقادمش).

⭐ المبدأ: ⭐ **«الأداة بتتحدّث لوحدها»** ⇒ ⭐ **الرابط بيتولَّد من آخر commit فعلي على `main`
   (مش `main` الخام ⇒ عشان الكاش مبيقدّمش نسخة قديمة) ⇒ ⭐ **والتسليم بيتحقّق من الملف المنشور نفسه.**

الاستخدام:
    python3 tools/print_gpt_msg.py                # رسالتا المراجعة (١ ثم ٢)
    python3 tools/print_gpt_msg.py 1 | 2          # رسالة واحدة
    python3 tools/print_gpt_msg.py --reply        # ⭐ سطر «راجع الردود» (جاهز للنسخ)
    python3 tools/print_gpt_msg.py --reply --summary  # ⭐ + «ما الذي تمّ» آلياً من حالة الريبو
    #                          (١٠ أسطر: آخر قرار · آخر ٥ مراحل · البطاقة · الجاهزية ·
    #                           العدّادات · الملفات · الاختبارات حيّاً · الروابط · ما ينتظرك · ⛔ لم يُنفَّذ)
    python3 tools/print_gpt_msg.py --reply --check  # ⭐ + يتحقّق أن الرابط منشور وحديث
    python3 tools/print_gpt_msg.py --copy         # ينسخ رسالة ١ للـclipboard
    python3 tools/print_gpt_msg.py --copy-reply   # ⭐ ينسخ سطر «راجع الردود» للـclipboard
    python3 tools/print_gpt_msg.py --link         # سطر «اقرأ الملف ده» (البرومبت الأصلي)
    python3 tools/print_gpt_msg.py --log          # سطر «سجل الردود» (ما نُفِّذ بعد آخر برومبت)
    python3 tools/print_gpt_msg.py --commit        # آخر commit منشور + ختم «آخر ردّ»
"""
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "docs/CHATGPT-POST-REVIEW-QUERY.md"
LOG = REPO / "docs/CHATGPT-REVIEW-LOG.md"
OWNER_REPO = "ahmed3zz2020-source/wasl-ai"
BASE_RAW = f"https://raw.githubusercontent.com/{OWNER_REPO}"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36"}
# ⭐⭐ M85 — أي تعارض بين رقم ال-commit والقياس الحيَّ = خطأ يُرفض نشره (لا نجاح كاذب).
PROBLEMS: list[str] = []


def fence(heading: str) -> str:
    txt = SRC.read_text(encoding="utf-8")
    m = re.search(r"##\s*📎\s*رسالة\s*" + heading + r"[\s\S]*?```\n([\s\S]*?)\n```", txt)
    if not m:
        sys.exit(f"⛔ مفيش «رسالة {heading}» في {SRC}")
    return m.group(1)


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ""


def latest_commit() -> str:
    """⭐ آخر commit **منشور فعلاً** على `main` ⇒ الأولوية لـls-remote (حقّ remote) ثم origin/main ثم HEAD."""
    out = git("ls-remote", "origin", "main")
    if out:
        return out.split()[0]
    for ref in ("origin/main", "main", "HEAD"):
        sha = git("rev-parse", ref)
        if sha:
            return sha
    return ""


def seal() -> str:
    """⭐ ختم «آخر ردّ مُنفَّذ = #X» من السجل ⇒ دليل أن الرابط يشير للنسخة المنشورة فعلاً."""
    if not LOG.exists():
        return ""
    m = re.search(r"آخر ردّ مُنفَّذ\s*=\s*(#[٠-٩]+)", LOG.read_text(encoding="utf-8"))
    return m.group(1) if m else ""


def pinned(sha: str, name: str) -> str:
    return f"{BASE_RAW}/{sha}/docs/{name}"


def fetch(url: str, timeout: int = 30) -> tuple[int, str]:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # ⛔ الشبكة قد تفشل ⇒ لا يُفشل التسليم كله
        return 0, str(e)


def reply_block(sha: str, link: str) -> str:
    return (
        "يا ChatGPT — اقرأ سجل الردود ده (آخر رد في §٣) وراجعه نقدياً: "
        "هل كل بند طلبته اتنفّذ كما طلبت؟ وأي بند سقط أو اتنفّذ ناقصاً؟ "
        "وبعدها اكتب ملاحظاتك الجديدة بنفس الصيغة المعتادة.\n\n"
        f"{link}"
    )


AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"


def ar_num(value: int) -> str:
    """⭐ رقم عربي-هندي (لتسق مع أرقام المستودع) — الأرقام النصوصية تُترك كما هي."""
    return "".join(AR_DIGITS[int(d)] for d in str(value))


def decision_rows(dec: str) -> list[tuple[str, str]]:
    """⭐ صفوف فهرس القرارات = (المعرّف · باقي الصف) ⇒ العدّادات تُشتق لا تُكتب."""
    rows: list[tuple[str, str]] = []
    for ln in dec.splitlines():
        m = re.match(r"^\|\s*(?:⭐\s*)?(?:\*\*)?(D-\d+)(.*)$", ln)
        if m:
            rows.append((m.group(1), m.group(2)))
    return rows


def decision_title(dec: str, did: str) -> str:
    """⭐ عنوان القسم الكامل للقرار ⇒ جملة قصيرة تُقرأ في الرسالة."""
    m = re.search(r"^##\s*" + re.escape(did) + r"\s*—\s*(.+)$", dec, re.M)
    if not m:
        return ""
    title = m.group(1).replace("⭐", " ")
    title = re.sub(r"\s+", " ", title).strip(" *·—")
    return title


def test_counts() -> tuple[int, int, int] | None:
    """⭐ عدّادات الاختبارات من **تشغيل فعلي** ⇒ رقم حيّ لا رقم مكتوب يدوياً."""
    try:
        p = subprocess.run(
            ["npm", "test", "--silent"], cwd=str(REPO), capture_output=True, text=True, timeout=900
        )
    except Exception:
        return None
    out = p.stdout or ""

    def grab(key: str) -> int:
        m = re.search(r"^#\s*" + key + r"\s+(\d+)", out, re.M)
        return int(m.group(1)) if m else 0

    total = grab("tests")
    if not total:
        return None
    return total, grab("pass"), grab("fail")


# ⭐⭐⭐ M85 — مصدر الرقم لازم يكون **الـcommit نفسه** ⇒ ⭐ ولا رقم من شجرة مختلفة.
PARTITION_RE = re.compile(r"<!--\s*wasl:current-partition\s+(.+?)\s*-->")
OPEN_DECISIONS = REPO / "docs/OPEN-DECISIONS.md"


def commit_partition(sha: str) -> tuple[int, int, str] | None:
    """⭐ القسم الموثّق **من الـcommit المُثبَّت** ⇒ (المجموع، عدد الملفات، التعبير).

    ⭐ **لماذا**: ⭐ ملاحظة M85 — ⭐ الرسالة كانت تعلن أرقام **الشجرة الحالية** وتضع
    الروابط على **commit أقدم** ⇒ ⇒ ⇒ القارئ يقارن رقمين مختلفين ⇒ ⇒ ⇒ تعارض حقيقي.
    ⇒ ⭐ **الرقم المنشور لازم يكون رقم الـcommit نفسه.**
    """
    if not sha:
        return None
    raw = git("show", f"{sha}:docs/TEST-MATRIX.md")
    if not raw:
        raw = git("show", f"{sha}:CURRENT-STATE.md")
    if not raw:
        return None
    m = PARTITION_RE.search(raw)
    if not m:
        return None
    expr = m.group(1).strip()
    nums = [int(x) for x in re.findall(r"\d+", expr)]
    if len(nums) < 2:
        return None
    parts, declared = nums[:-1], nums[-1]
    if sum(parts) != declared:
        return None
    return declared, len(parts), expr


def pending_owner_items() -> tuple[list[str], list[str]]:
    """\u2b50 \u00ab\u0645\u0627 \u064a\u0646\u062a\u0638\u0631 \u0642\u0631\u0627\u0631 \u0627\u0644\u0645\u0627\u0644\u0643\" \u064a\u064f\u0634\u062a\u0642 \u0645\u0646 \u00ab\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0645\u0648\u062d\u0651\u062f\" \u21d2 \u2b50 \u0644\u0627 \u064a\u0633\u0642\u0637 \u0628\u0646\u062f \u0645\u0646 \u0627\u0644\u0645\u0644\u062e\u0635.

    \u2b50\u2b50 \u00ab\u0644\u0645\u0627\u0630\u0627 (M86)\": \u2b50 \u0627\u0644\u0631\u062f\u0651 \u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 \u0623\u0639\u0644\u0646 \u00a7 \u0628\u0646\u0648\u062f \u00b7 \u0648\u0631\u062f\u0651 \u00a0\u00a0\u00a0\u00a0\u00a0\u00a0 \u0623\u0639\u0644\u0646 \u00a5 \u21d2 \u21d2 \u21d2 \u062e\u0645\u0633\u0629 \u0628\u0646\u062f \u0627\u062e\u062a\u0641\u062a \u0645\u0646 \u0623\u062d\u062f\u062b \u0645\u0644\u062e\u0635 \u21d2 \u2b50 \u00ab\u0648\u0627\u0644\u0627\u062e\u062a\u0641\u0627\u0621 \u0644\u064a\u0633 \u0625\u063a\u0644\u0627\u0642\u0627\u064b\".
    \u21d2 \u2b50 \u00ab\u0627\u0644\u0645\u0635\u062f\u0631 \u0627\u0644\u0648\u062d\u064a\u062f = `docs/OPEN-DECISIONS.md`\" \u21d2 \u21d2 \u21d2 \u0648\u0627\u0644\u0642\u0627\u0639\u062f\u0629: \u2b50 \u00ab\u0644\u0627 \u064a\u064f\u063a\u0644\u0642 \u0628\u0646\u062f \u0625\u0644\u0627 \u0628\u062a\u0635\u0631\u064a\u062d \u0645\u0627\u0644\u0643 \u0635\u0631\u064a\u062d\" \u21d2 \u21d2 \u21d2 \u0648\u0645\u0627 \u0639\u062f\u0627 \u0644\u0630\u0644\u0643 \u064a\u0628\u0642\u0649 \u0645\u0639\u0644\u0651\u0642\u0627\u064b \u062d\u062a\u0649 \u0644\u0648 \u0644\u0645 \u064a\u064f\u0630\u0643\u0631 \u0641\u064a \u0622\u062e\u0631 \u0631\u062f\u0651\u00bb.

    \u2b50 \u0627\u0644\u0645\u0631\u062c\u0639 = (\u0645\u0637\u0644\u0648\u0628 \u0627\u0644\u0622\u0646 \u00b7 \u0645\u0639\u0644\u0651\u0642 \u0628\u0644\u0627 \u0642\u0631\u0627\u0631 \u0627\u0644\u0622\u0646).
    """
    if not OPEN_DECISIONS.exists():
        return ([], [])
    items_now: list[str] = []
    items_later: list[str] = []

    def clean(s: str) -> str:
        return s.replace("\u2b50", "").replace("**", "").strip()

    for ln in OPEN_DECISIONS.read_text(encoding="utf-8").splitlines():
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) < 6:
            continue
        name, state, need_now, closed = clean(cells[1]), clean(cells[3]), clean(cells[4]), clean(cells[5])
        if not name or not state or "\u0645\u0641\u062a\u0648\u062d" not in state:
            continue
        if "\u0646\u0639\u0645" in closed:
            continue
        (items_now if "\u0646\u0639\u0645" in need_now else items_later).append(name)
    return (items_now, items_later)


def summary_block(sha: str) -> str:
    """⭐ «ما الذي تم» — يُشتق آلياً من حالة الريبو ⇒ لا يتقادم ولا يُكتب يدوياً."""
    lines: list[str] = []
    dec = (REPO / "DECISIONS.md").read_text(encoding="utf-8") if (REPO / "DECISIONS.md").exists() else ""
    cs = (REPO / "CURRENT-STATE.md").read_text(encoding="utf-8") if (REPO / "CURRENT-STATE.md").exists() else ""
    tracked = git("ls-files").splitlines()
    # ⭐ **العدّادات تُقاس بالميزة ⇒ كل مجلّد على حدة** ⇒ ⭐ «كود الإنتاج» = النواة + الخادم (مش النواة وحدها).
    n_core = len([f for f in tracked if f.startswith("src/core/")])
    n_local = len([f for f in tracked if f.startswith("src/local/")])
    n_server = len([f for f in tracked if f.startswith("server/")])
    n_tools = len([f for f in tracked if f.startswith("tools/")])
    n_prod = n_core + n_local + n_server
    n_tests = len([f for f in tracked if f.startswith("tests/")])
    rows = decision_rows(dec)
    n_ok = sum(1 for _, t in rows if "✅" in t)
    n_mid = sum(1 for _, t in rows if "🟡" in t)
    n_blue = sum(1 for _, t in rows if "🔵" in t)

    # ① آخر قرار مُعتمد = آخر صف في فهرس DECISIONS.md حالته ✅
    last_ok = ""
    for did, tail in rows:
        if "✅" in tail:
            last_ok = did
    if last_ok:
        closed = False
        idx = dec.find(f"## {last_ok}")
        if idx > 0:
            nxt = dec.find("\n## ", idx + 1)
            section = dec[idx: nxt if nxt > 0 else len(dec)]
            closed = "إغلاق المهمة" in section
        tail_txt = " = ✅ منجَز ومغلَق (المخرَج موثَّق في السجل)." if closed else " (المخرَج موثَّق في السجل)."
        lines.append(f"- ⭐ **آخر قرار مُعتمد**: {last_ok}{tail_txt}")

    # ② آخر ٥ مراحل مُنفَّذة (عناوين مُشتقّة من أقسام سجل القرارات)
    phases = []
    for did, tail in [r for r in rows if "✅" in r[1]][-5:]:
        title = decision_title(dec, did)
        phases.append(f"{did} ({title})" if title else did)
    if phases:
        lines.append("- ⭐ **آخر ٥ مراحل مُنفَّذة**: " + " · ".join(phases))

    card = REPO / "docs/FIRST-SLICE-DECISION-CARD.md"
    if card.exists():
        executed = any(did == "D-049" and "✅" in t for did, t in rows)
        note = (
            "نطاق مجمَّد — نُفِّذ بـD-049 ✅"
            if executed
            else "إعداد ≠ موافقة"
        )
        lines.append(
            f"- ⭐ **بطاقة الشريحة البرمجية الأولى** ({note}): "
            f"{BASE_RAW}/{sha}/docs/FIRST-SLICE-DECISION-CARD.md"
        )

    # ③ الجاهزية تُقرأ من سطر درجات EA-001..EA-007 تحديداً ⇒ لا تُلتقط أي «ن/م» عشوائي
    ready = ""
    moved = False
    for ln in cs.splitlines():
        if "EA-001..EA-007" in ln:
            m2 = re.search(r"(\d+)/(\d+)", ln)
            if m2:
                ready = f"{m2.group(1)}/{m2.group(2)}"
                moved = "لم تتحرك" not in ln
                break
    if ready:
        if n_prod:
            state = (
                f"✔ كود الإنتاج ({ar_num(n_prod)} ملفاً = {ar_num(n_core)} نواة (src/core) + {ar_num(n_local)} محاكاة محلية (src/local) + {ar_num(n_server)} خادم) "
                f"· ✔ اختبارات محلية ({ar_num(n_tests)} ملف اختبار)"
            )
        else:
            state = "بلا كود · بلا اختبار"
        tail_txt = "" if moved else " (درجات EA-001..EA-007 لم تتحرك)"
        lines.append(f"- ⭐ **الجاهزية {ready}** — {state} · بلا حساب · بلا نشر{tail_txt}.")

    # ④ عدّادات القرار والملفات (كلها مشتقّة)
    if rows:
        lines.append(
            f"- ⭐ **سجل القرارات**: {ar_num(len(rows))} صف = {ar_num(n_ok)}✅ · {ar_num(n_mid)}🟡 · {ar_num(n_blue)}🔵 "
            "· ⭐ **والفجوة `D-039..D-045` محجوزة لكتلة `DR-3`** · ⭐ **والتوصيات (🔵) ليست قرارات**."
        )
    n_md = len([f for f in tracked if f.endswith(".md")])
    lines.append(
        f"- ⭐ **الريبو**: {ar_num(len(tracked))} ملف متتبَّع ({ar_num(n_md)} ملف `.md`) · "
        f"{ar_num(n_core)} نواة (src/core) + {ar_num(n_local)} محاكاة محلية (src/local) + {ar_num(n_server)} خادم + {ar_num(n_tools)} أداة تشغيل "
        f"· {ar_num(n_tests)} ملف اختبار · العدّادات في `CURRENT-STATE.md` مصحَّحة."
    )

    # ① ⭐ M85 — الرقم المنشور = رقم ال-commit نفسه ⇒ ⭐ ولا رقم من شجرة مختلفة.
    cp = commit_partition(sha)
    counts = test_counts()
    short = sha[:7]
    if cp:
        total_c, _n_files, expr = cp
        if counts:
            total_l, passed_l, failed_l = counts
            if total_l != total_c:
                PROBLEMS.append(
                    f"تعارض أرقام (M85): ال-commit {short} يوثّق {ar_num(total_c)} اختبار · "
                    f"والقياس الحيَّ {ar_num(total_l)} ⇒ لا يُنشر رقم غير مربوط بال-commit."
                )
                lines.append(
                    f"- ⛔ **الاختبارات**: ⛔ تعارض أرقام (M85) — ال-commit {short} يوثّق {ar_num(total_c)} · "
                    f"والقياس الحيَّ {ar_num(total_l)} ⇒ ⛔ لا يُنشر."
                )
            else:
                verdict = "✅ كله ناجح" if failed_l == 0 else f"⛔ {ar_num(failed_l)} فاشل"
                lines.append(
                    f"- ⭐ **الاختبارات (رقم مربوط بال-commit {short})**: {ar_num(total_c)} اختبار · "
                    f"{ar_num(passed_l)} ناجح · {verdict} · ⭐ التقسيم الموثّق: {expr} · "
                    "⛔ **نتاج اختبارات محلية — ليست شهادة جاهزية**."
                )
        else:
            lines.append(
                f"- ⭐ **الاختبارات (رقم مربوط بال-commit {short})**: {ar_num(total_c)} اختبار · {expr} · "
                "⏳ القياس الحيَّ لم يُنفّذ."
            )
    else:
        PROBLEMS.append(f"مفقود marker التقسيم في ال-commit {short} ⇒ لا رقم مربوط (M85).")
        lines.append(f"- ⛔ **الاختبارات**: ⛔ مفيش marker تقسيم في ال-commit {short} ⇒ ⛔ لا رقم مربوط.")
    # ⑥ الوثائق الأساسية (روابط مثبَّتة على نفس الـcommit)
    # ⭐ **أحدث تقريرَين بالترتيب الزمني** ⇒ ⭐ الترتيب من **git** (تاريخ آخر commit لمسّ الملف)
    # ⇒ ⭐ **ثابت بعد أي clone** ⇒ ⭐ **لا تتقادم باليد**.
    def report_rank(p: Path) -> int:
        out = git("log", "-1", "--format=%ct", "--", str(p.relative_to(REPO)))
        try:
            return int(out.strip())
        except ValueError:
            return 0

    reports = sorted(
        (p for p in (REPO / "docs").glob("*REPORT.md") if p.is_file()),
        key=report_rank,
        reverse=True,
    )[:2]
    docs = [(f"docs/{p.name}", p.stem.replace("-", " ")) for p in reports]
    docs += [
        ("docs/TEST-MATRIX.md", "مصفوفة الاختبارات"),
        ("DECISIONS.md", "سجل القرارات"),
    ]
    links = [
        f"{label}: {BASE_RAW}/{sha}/{path}"
        for path, label in docs
        if (REPO / path).exists()
    ]
    if links:
        lines.append("- ⭐ **الوثائق الأساسية (روابط مثبَّتة على نفس الـcommit)**: " + " · ".join(links))

    # ⑦ ما ينتظر قرار المالك (مشتق من رقم القسم الفعلي في آخر ردّ)
    need_now, pending = pending_owner_items()
    if pending or need_now:
        parts = []
        if need_now:
            parts.append("مطلوب الآن: " + " · ".join(need_now))
        if pending:
            parts.append("معلّق بلا قرار الآن: " + " · ".join(pending))
        lines.append(
            "- ⭐ **ما ينتظر قرار المالك** (المصدر الوحيد: `docs/OPEN-DECISIONS.md`): " + " · ".join(parts)
        )
    # ⑧ ما لم يُنفَّذ
    if n_prod:
        lines.append(
            "- ⭐ **⛔ لم يُنفَّذ**: لا تكامل خارجي · لا حسابات · لا تواصل خارجي · لا تعاقد · لا دفعة · لا نشر "
            "· ولا اعتماد نهائي لمسار واتساب · ⭐ **والكود الموجود = ما نُفِّذ محلياً فقط (بلا اتصال وبلا حساب)**."
        )
    else:
        lines.append(
            "- ⭐ **⛔ لم يُنفَّذ**: لا كود · لا اختبارات فعلية · لا حسابات · لا تواصل خارجي · لا تعاقد · لا دفعة · لا نشر · ولا اعتماد نهائي لمسار واتساب."
        )
    return "\n".join(lines)


def reply_with_summary(sha: str, link: str) -> str:
    return (
        reply_block(sha, link)
        + "\n\n⭐ **ما الذي تمّ في الجولة الأخيرة (لا تفترض — اقرأ §٣ و§٤ و§٢):**\n"
        + summary_block(sha)
    )


def print_reply(check: bool, with_summary: bool = False) -> int:
    sha = latest_commit()
    if not sha:
        print("⛔ مفيش commit — الـtools/print_gpt_msg.py محتاج git.")
        return 1
    link = pinned(sha, "CHATGPT-REVIEW-LOG.md")
    main_link = f"{BASE_RAW}/main/docs/CHATGPT-REVIEW-LOG.md"
    block = reply_with_summary(sha, link) if with_summary else reply_block(sha, link)
    print(block)
    print()
    print(f"⏺️ commit: {sha}")
    print(f"⏺️ الختم في الملف المنشور: {seal() or '؟'}")
    print(f"⏺️ بديل (نسخة تتحدّث تلقائياً مع كل commit): {main_link}")
    if PROBLEMS:
        print()
        for pb in PROBLEMS:
            print(f"⛔ {pb}")
        if check:
            return 1
        return 0
    status, body = fetch(link)
    if status != 200:
        print(f"⛔ الرابط المنشور رجّع {status} ⇒ استنى شوية وجرّب تاني (الكاش بيأخّر شوية).")
        return 1
    live = re.search(r"آخر ردّ مُنفَّذ\s*=\s*(#[٠-٩]+)", body)
    live_seal = live.group(1) if live else "؟"
    want = seal()
    if want and live_seal != want:
        print(f"⛔ النسخة المنشورة ختمها {live_seal} والمحلي {want} ⇒ الرابط مش أحدث نسخة (كاش).")
        return 1
    print(f"✅ متحقَّق: الرابط منشور (٢٠٠) وختمه {live_seal} = النسخة المحلية ⇒ ابحث/انسخ من فوق.")
    return 0


def copy_to_clipboard(body: str) -> int:
    for cmd in (["pbcopy"], ["xclip", "-selection", "clipboard"], ["wl-copy"], ["xsel", "-b", "--clipboard"]):
        if shutil.which(cmd[0]):
            p = subprocess.run(cmd, input=body, text=True)
            if p.returncode == 0:
                print("✅ اتنسخ للـclipboard")
                return 0
    print("⛔ مفيش أداة clipboard على الجهاز — النص اتطبع تحت:")
    print(body)
    return 1


def main() -> int:
    args = [a for a in sys.argv[1:]]
    check = "--check" in args
    args = [a for a in args if a != "--check"]
    summary = "--summary" in args
    args = [a for a in args if a != "--summary"]
    arg = args[0] if args else "both"

    if arg == "--reply":
        return print_reply(check, summary)
    if arg == "--copy-reply":
        sha = latest_commit()
        if not sha:
            print("⛔ مفيش commit")
            return 1
        return copy_to_clipboard(reply_block(sha, pinned(sha, "CHATGPT-REVIEW-LOG.md")))
    if arg == "--commit":
        print(latest_commit())
        print(seal())
        return 0
    if arg == "--link":
        print("يا ChatGPT — اقرأ الملف ده (فيه رسالتين جاهزتين بالترتيب: رسالة ١ ثم رسالة ٢) ونفّذهم:\n")
        print(f"{BASE_RAW}/main/docs/CHATGPT-POST-REVIEW-QUERY.md")
        return 0
    if arg == "--log":
        if not LOG.exists():
            sys.exit(f"⛔ مفيش سجل الردود: {LOG}")
        print("يا ChatGPT — ده سجل الردود على مراجعاتك (أنا اللي كاتبه). "
              "اقرأه: آخر رد مُنفَّذ في §٣، والسجل المختصر في §٢. "
              "بهذا تعرف بالظبط إيه اللي اتنفّذ بعد آخر برومبت لك.\n")
        print(f"{BASE_RAW}/main/docs/CHATGPT-REVIEW-LOG.md")
        print()
        print(" وبعد ما تقراه: راجع الردود السابقة نقدياً — "
              "هل كل بند طلبته اتنفّذ كما طلبت؟ وأي بند سقط أو اتنفّذ ناقصاً؟ "
              "واكتب ملاحظاتك بنفس الصيغة المعتادة.")
        return 0
    if arg == "1":
        print(fence("١"))
    elif arg == "2":
        print(fence("٢"))
    elif arg == "--copy":
        body = fence("١")
        for cmd in (["pbcopy"], ["xclip", "-selection", "clipboard"], ["wl-copy"],
                    ["xsel", "-b", "--clipboard"]):
            if shutil.which(cmd[0]):
                p = subprocess.run(cmd, input=body, text=True)
                if p.returncode == 0:
                    print("✅ رسالة ١ اتنسخت للـclipboard")
                    return 0
        print("⛔ مفيش أداة clipboard على الجهاز — الـmessage اتطبع تحت:")
        print(body)
        return 1
    else:
        print("═══ رسالة ١ — تُرسل أولاً ═══\n")
        print(fence("١"))
        print("\n\n═══ رسالة ٢ — في نفس المحادثة ═══\n")
        print(fence("٢"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
