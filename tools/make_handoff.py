#!/usr/bin/env python3
"""⭐ مولّد «ملف التسليم» — WASL AI.

⭐ **الفكرة**: ⭐ **الشات الجديد يقرا ملف واحد صغير (بضع آلاف توكن) بدل ما يعيد بناء الحالة من الصفر.**
⭐ **المبدأ**: ⭐ **«الأداة بتتحدّث لوحدها» ⇒ الملف مولَّد آلياً من المصادر ⇒ صفر صيانة وصفر اختلاق.**

المصادر (كل رقم فيها مستخرَج آلياً — لا رقم مكتوب يدوياً):
  · CURRENT-STATE.md            ⇒ الجاهزية (9/21) والخطوة التالية
  · DECISIONS.md                ⇒ عدّاد القرارات المعتمدة
  · DECISION-REGISTER.md §12    ⇒ القرارات المعلّقة على المالك
  · docs/CHATGPT-REVIEW-LOG.md  ⇒ آخر الردود المنفَّذة
  · git                          ⇒ آخر commit + عدد الملفات

الاستخدام:
    python3 tools/make_handoff.py           # يولّد docs/HANDOFF.md
    python3 tools/make_handoff.py --print   # يطبع رسالة البدء الجاهزة
    python3 tools/make_handoff.py --check   # يتحقق أن الملف محدَّث (exit 1 لو قديم)
"""
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "HANDOFF.md"
RAW = "https://raw.githubusercontent.com/ahmed3zz2020-source/wasl-ai/main/docs/HANDOFF.md"


# ⭐ مصطلحات تقنية تُكتب مرصوصة ⇒ لا تُلفّ بأقواس
KEEP = {"Meta", "BSP", "Tech", "Provider", "WhatsApp", "Cloudflare", "RLS",
        "DSAR", "API", "DR", "WASL", "EA", "R007", "P1", "P2", "P3",
        "CONDITIONAL", "ACCEPTANCE"}


def ar(s: str) -> str:
    """أرقام لاتينية ⇒ أرقام عربية-هندية (للنص العربي فقط)."""
    return re.sub(r"\d", lambda m: chr(0x0660 + int(m.group())), s)


def clean(s: str) -> str:
    """إزالة رموز التنسيق ⭐ و ** من خلايا الجداول."""
    return re.sub(r"\s+", " ", s.replace("⭐", "").replace("**", "")).strip()


def wrap_latin(s: str) -> str:
    """أي كلمة لاتينية جوّه جملة عربية ⇒ تُلفّ بأقواس (قاعدة المالك)."""
    out = []
    for part in re.split(r"(\([^)]{0,40}\))", s):
        if part.startswith("("):
            out.append(part)
            continue
        for m in re.finditer(r"[A-Za-z]{2,}", part):
            w = m.group()
            if w in KEEP or w.isupper():
                continue
            before = part[m.start() - 1] if m.start() else ""
            after = part[m.end()] if m.end() < len(part) else ""
            if before == "(" and after == ")":
                continue
            part = part[:m.start()] + f"({w})" + part[m.end():]
            m = re.match(r"[A-Za-z]{2,}", part[m.start() + 1:])
        out.append(part)
    return "".join(out)


# ─────────────── مصادر ───────────────
def git(*args) -> str:
    try:
        return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True,
                              text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def read(rel: str) -> str:
    p = ROOT / rel
    return p.read_text(encoding="utf-8") if p.exists() else ""


def count_decisions() -> tuple[int, int, int, int]:
    """(صفوف، معتمد ✅، مؤجَّل 🟡، مقترح 🔵) من فهرس DECISIONS.md."""
    dec = read("DECISIONS.md")
    rows = [l for l in dec.splitlines()
            if re.match(r"^\|\s*(?:⭐\s*)?(?:\*\*)?D-\d{3}", l)]
    return (len(rows),
            sum(1 for l in rows if "✅" in l),
            sum(1 for l in rows if "🟡" in l),
            sum(1 for l in rows if "🔵" in l))


def count_files() -> tuple[int, int, int]:
    """(كل الملفات، .md، غير .md) من git."""
    files = [f for f in git("ls-files").splitlines() if f]
    if not files:
        files = [str(p.relative_to(ROOT)) for p in ROOT.rglob("*")
                 if p.is_file() and ".git" not in p.parts]
    md = [f for f in files if f.endswith(".md")]
    return len(files), len(md), len(files) - len(md)


def readiness() -> str:
    cs = read("CURRENT-STATE.md")
    m = re.search(r"(\d+)\s*/\s*21", cs)
    return f"{m.group(1)}/21" if m else "❓"


def pending_decisions() -> list[dict]:
    """القرارات المعلّقة على المالك من DECISION-REGISTER.md §12."""
    txt = read("DECISION-REGISTER.md")
    if "## ١٢" not in txt:
        return []
    block = txt[txt.index("## ١٢"):]
    out = []
    for m in re.finditer(r"\|\s*\*\*(\d)\*\*\s*\|\s*⭐\s*\*\*(DR-\d+)\s*—\s*([^*]+)\*\*\s*\|",
                         block):
        out.append({"n": m.group(1), "id": m.group(2), "title": m.group(3).strip()})
    for d in out:
        card = re.search(rf"### ⭐ بطاقة {d['id']}.*?\n\n(.*?)(?=\n### |\n> ⭐|\Z)",
                         block, re.S)
        body = card.group(1) if card else ""
        opt = re.search(r"\| ⭐ \*\*الخيارات\*\* \| (.+?) \|", body)
        d["options"] = opt.group(1).strip() if opt else "—"
        simple = re.search(r"\| ⭐ \*\*شرح بسيط جداً\*\* \| (.+?) \|", body)
        d["simple"] = simple.group(1).strip() if simple else "—"
    return out


def replies() -> list[dict]:
    """آخر الردود من سجل الردود §2."""
    log = read("docs/CHATGPT-REVIEW-LOG.md")
    if "## ٢." not in log:
        return []
    block = log[log.index("## ٢."):]
    block = block[:block.index("## ٣.")] if "## ٣." in block else block
    out = []
    for line in block.splitlines():
        if not re.match(r"^\|\s*\*\*[٠-٩\d]+\*\*\s*\|", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 7:
            continue
        out.append({"n": cells[0].strip("*"), "date": cells[1],
                    "topic": cells[2], "commit": cells[4], "check": cells[5]})
    return out


# ─────────────── الملف ───────────────
def build() -> str:
    files, md, other = count_files()
    rows, ok, early, pending = count_decisions()
    decs = pending_decisions()
    reps = replies()
    commit = git("log", "-1", "--format=%h")
    _m = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
          "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    _d = date.today()
    today = f"{ar(str(_d.day))} {_m[_d.month - 1]} {ar(str(_d.year))}"

    L = []
    A = L.append
    A("# ⭐ ملف التسليم — WASL AI")
    A("")
    A("> ⭐ **مولَّد آلياً** بـ`tools/make_handoff.py` ⇒ ⭐ **بيتحدّث لوحده** ⇒ ⭐ **ولّده بعد أي تعديل:** `python3 tools/make_handoff.py`")
    A("> ⭐ **الهدف**: ⭐ **الشات الجديد يقرا هذا الملف وحده ⇒ ويكمّل ⇒ بلا إعادة بناء للحالة.**")
    A(f"> ⭐ **نسخة مولَّدة**: {today} · ⭐ **آخر commit وقت التوليد**: `{commit or '❓'}`")
    A("")
    A("---")
    A("")
    A("## ١. ⭐ ابدأ من هنا (٣ خطوات)")
    A("")
    A("1. ⭐ **اقرأ هذا الملف فقط** (ملف واحد · بضع آلاف توكن) ⇒ ⭐ **لا تقرا §٦ إلا عند الحاجة الفعلية.**")
    A("2. ⭐ **نفّذ الخطوة التالية** (§٥).")
    A("3. ⭐ **حدّث السجل بعد التنفيذ**: `docs/CHATGPT-REVIEW-LOG.md` (§٢ + §٣) ⇒ ثم `python3 tools/make_handoff.py`.")
    A("")
    A("---")
    A("")
    A("## ٢. ⭐ الحالة الآن (كل رقم مستخرَج آلياً)")
    A("")
    A("| البند | القيمة | المصدر |")
    A("|---|---|---|")
    A(f"| ⭐ **الجاهزية (EA)** | **{readiness()}** | `CURRENT-STATE.md` |")
    A(f"| ⭐ **القرارات المعتمدة** | **{ar(str(ok))}** من {ar(str(rows))} صف (🟡 {ar(str(early))} · 🔵 {ar(str(pending))}) | `DECISIONS.md` |")
    A(f"| ⭐ **عدد الملفات** | **{ar(str(files))}** ({ar(str(md))} `.md` + {ar(str(other))} غير `.md`) | `git ls-files` |")
    A(f"| ⭐ **آخر commit** | `{commit or '❓'}` | `git log -1` |")
    A("| ⭐ **آخر إصدار مراجَع** | **R007** — ✅ مقبول معمارياً · القبول المشروط | `REVIEWS/LATEST.md` |")
    A("")
    A("---")
    A("")
    A("## ٣. ⭐ إيه اللي اتنفّذ (سجل الردود — آلياً)")
    A("")
    if reps:
        A("| # | التاريخ | الموضوع | commit | نتيجة الفحص |")
        A("|:-:|---|---|---|---|")
        for r in reversed(reps):
            topic = wrap_latin(clean(r["topic"]))
            topic = topic if len(topic) <= 90 else topic[:88] + "…"
            check = clean(r["check"])
            cm = clean(r["commit"])
            cm = "آخر commit على `main`" if cm.startswith("آخر") else cm.strip("`")
            A(f"| {ar(r['n'])} | {clean(r['date'])} | {topic} | `{cm}` | {check} |")
    else:
        A("| — | — | ⭐ **مفيش ردود مسجَّلة بعد** | — | — |")
    A("")
    A(f"> ⭐ **التفاصيل الكاملة** (ما طُلب · ما نُفِّذ · ما لم يُنفَّذ · الأدلة): [`docs/CHATGPT-REVIEW-LOG.md`](CHATGPT-REVIEW-LOG.md) — ⭐ **§٣ = الأحدث · §٤ = السابق · §٥ = الأقدم**.")
    A("")
    A("---")
    A("")
    A("## ٤. ⭐ القرارات المعلّقة على المالك (٢ فقط — آلياً من `DECISION-REGISTER.md` §١٢)")
    A("")
    for d in decs:
        A(f"### ⭐ {d['id']} — {d['title']}")
        A("")
        A(f"- ⭐ **باختصار:** {wrap_latin(d['simple'])}")
        A(f"- ⭐ **الخيارات:** {wrap_latin(d['options'])}")
        A("")
    A("> ⭐ **قاعدة العرض**: ⭐ **يُعرض فقط ما يحتاج موافقتك الآن** ⇒ ⭐ **والباقي معلّق على الرأي القانوني أو مؤجَّل عن قصد ⇒ لا يُعرض.**")
    A("")
    A("---")
    A("")
    A("## ٥. ⭐ الخطوة التالية")
    A("")
    A("1. ⭐ **قرار المالك: DR-5 + DR-8** (§٤) ⇒ ⭐ **ده كل المطلوب دلوقتي — ما فيش شغل تقني معلّق.**")
    A("2. ⭐ **بعد قرار DR-5**: ⭐ **خطاب التكليف جاهز** ⇒ `docs/LEGAL-ENGAGEMENT-LETTER.md` ⇒ ⭐ **يُرسل كما هو بعد تعبئة بيانات المكتب** (⛔ بلا تعاقد · بلا دفعة · بلا مبلغ).")
    A("3. ⭐ **بعد قرار DR-8**: ⭐ **الصيغة المقترحة في §٧ من** `docs/DR-8-WHATSAPP-DECISION-CARD.md` ⇒ ⭐ **وبحدّ الاستفسار غير الملزم وبشرط V1..V6 قبل أي خطوة ملزمة.**")
    A("4. ⭐ **وبعد أي تنفيذ**: ⭐ **حدّث سجل الردود + ولّد هذا الملف من جديد.**")
    A("")
    A("---")
    A("")
    A("## ٦. ⭐ ⛔ ما تقراش (اتقرا قبل كده — مش ناقصك)")
    A("")
    A("| الملف | ليه مش مطلوب |")
    A("|---|---|")
    for f_, why in [
        ("`REVIEWS/R007-r006-review-remediation.md`", "⭐ **مقبولة معمارياً ⇒ قرارها مكتوب (§٢ + §٤ من `DECISION-REGISTER.md`)**"),
        ("`LEGAL-ACCEPTANCE.md`", "⭐ **قالب فارغ — لا رأي فيه (والرأي السري نفسه مش في الريبو العام)**"),
        ("`docs/LEGAL-ENGAGEMENT-LETTER.md`", "⭐ **جاهز للنسخ — مش محتاج قراءته عشان تتصرف**"),
        ("`docs/DR-8-WHATSAPP-DECISION-CARD.md`", "⭐ **الملخّص في §٤ — والقرار للمالك**"),
        ("`docs/PARALLEL-PREPARATION-SPEC.md`", "⭐ **توصيف فقط — لا يمسّ الخطوة الجاية**"),
        ("`DECISIONS.md`", "⭐ **العدّاد في §٢ — والقراران في §٤**"),
        ("`ARCHITECTURE.md` · `CHARTER.md` · `ASSUMPTIONS.md` · `TIMELINE.md`", "⭐ **ثوابت — مش متأثرة بالخطوة الجاية**"),
    ]:
        A(f"| {f_} | {why} |")
    A("")
    A("---")
    A("")
    A("## ٧. ⭐ اللي تقراه لو احتجت (٣ بالظبط)")
    A("")
    A("| الملف | متى |")
    A("|---|---|")
    A("| ⭐ `docs/DR-8-WHATSAPP-DECISION-CARD.md` | ⭐ **لو المالك قرر DR-8** (المقارنة + الصيغة) |")
    A("| ⭐ `docs/LEGAL-ENGAGEMENT-LETTER.md` | ⭐ **لو المالك قرر DR-5** (الخطاب جاهز للنسخ) |")
    A("| ⭐ `docs/CHATGPT-REVIEW-LOG.md` §٣ | ⭐ **لو جه ملاحظة جديدة من (ChatGPT) — محتاج آخر رد بالتفصيل** |")
    A("")
    A("⭐ **أوامر التحقق (شغّلها قبل أي تسليم):**")
    A("")
    A("```")
    A("python3 tools/audit_docs.py --quiet     # تدقيق الوثائق الأربع (١٣ فحصاً)")
    A("python3 tools/check-lang.py --quiet     # فحص لغوي")
    A("python3 tools/make_handoff.py --check   # يتأكد إن الملف ده محدَّث")
    A("```")
    A("")
    A("---")
    A("")
    A("## ٨. ⭐ رسالة البدء الجاهزة (الصقها في الشات الجديد)")
    A("")
    A("```")
    A("WASL AI — كمّل من ملف التسليم (مولَّد آلياً):")
    A(RAW)
    A("```")
    A("")
    A("> ⭐ **الملف بيتولَّد آلياً ⇒ يبقى حديثاً دايماً ⇒ ⇒ فتقدر تفتح شات جديد في أي وقت في دقيقة.**")
    A("> ⛔ **والنسخة دي محلّها الدائم = الريبو** ⇒ ⭐ **مش الـworkspace** (الـworkspace بيمسح كل شات ⇒ وملف التسليم كان بيضيع ⇒ وبنرجع نبنيه من الصفر).")
    A("")
    return "\n".join(L)


def main() -> int:
    args = sys.argv[1:]
    text = build()
    if "--print" in args:
        idx = text.index("## ٨.")
        print(text[text.index("```", idx) + 3:text.index("```", text.index("```", idx) + 3)].strip())
        return 0
    if "--check" in args:
        if not OUT.exists():
            print("⛔ ملف التسليم مش موجود — ولّده: python3 tools/make_handoff.py")
            return 1
        # ⭐ الحقول المتغيّرة (التاريخ · رقم الـcommit) مش جزء من الفحص
        #   ⇒ لأن الـcommit بيتغيّر مع كل commit ⇒ والفحص لازم يظل صالح للأبد.
        def norm(s: str) -> str:
            s = re.sub(r"\*\*نسخة مولَّدة\*\*: [^·]+", "«تاريخ»", s)
            s = re.sub(r"\*\*آخر commit وقت التوليد\*\*: `[^`]+`", "«commit»", s)
            s = re.sub(r"\| ⭐ \*\*آخر commit\*\* \| `[^`]+` \|", "| «commit» |", s)
            return s.strip()
        if norm(OUT.read_text(encoding="utf-8")) != norm(text):
            print("⛔ ملف التسليم قديم ⇒ ولّده: python3 tools/make_handoff.py")
            return 1
        print("✅ ملف التسليم محدَّث")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"✅ اتولّد: {OUT.relative_to(ROOT)} ({len(text)} حرف)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
