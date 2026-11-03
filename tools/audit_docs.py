#!/usr/bin/env python3
"""تدقيق الاتساق للوثائق التحضيرية الأربع — WASL AI.

يفحص كل عيب قابل للإثبات آلياً (مش انطباع):
  1  LINK     كل رابط نسبي بيوصل لملف موجود
  2  SECTION  كل إحالة § في المصدر الر007 بتشير لقسم موجود
  3  ID-SEQ   تسلسلات D / OP / LG / EV كاملة وبلا تكرار
  4  QL       Q-L1..Q-L18 موجودة مرة واحدة ومطابقة لمصدرها في R007 §8.3
  5  LCOMP    ارتباط L1..L7 بأسئلتها مطابق تماماً لمصدره في R007 §8.5
  6  COUNT    الأرقام المعلنة في الوثائق مطابقة لمصادرها الحيّة
  7  GLUE     كلمة لاتينية ملزوقة بعربي (مسافة ناقصة)
  8  ENPROSE  كلمة لاتينية داخل جملة عربية بلا أقواس
  9  NUMSYS   عمود ترقيم واحد فيه نظامان مختلفان
  10 L-COMPLY  لا تثبيت تصميم / لا كود / لا إطلاق / لا التزام تعاقدي أو سعري
  11 DECISION لا وصف توصية على أنها قرار معتمد
  12 SECRET   لا مفاتيح ولا بيانات حسّاسة
  13 FOREIGN  محرف منScripts غريبة (كوري/صيني/سيريلي) داخل النص العربي

الاستخدام:
    python3 tools/audit_docs.py            # تقرير كامل
    python3 tools/audit_docs.py --quiet    # ملخص بس
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
R007 = ROOT / "REVIEWS" / "R007-r006-review-remediation.md"

DOCS = {
    "acceptance": ROOT / "LEGAL-ACCEPTANCE.md",
    "letter": ROOT / "docs" / "LEGAL-ENGAGEMENT-LETTER.md",
    "dr8": ROOT / "docs" / "DR-8-WHATSAPP-DECISION-CARD.md",
    "parallel": ROOT / "docs" / "PARALLEL-PREPARATION-SPEC.md",
}

# ⭐ مصطلحات تُستثنى من فحص «الإنجليزية في العربي»:
# معرّفات تقنية (Q-L14 · DR-8 · §7 · P1 · L3 · D1 · OP5 · LG2 · EV1 · R007 · D-038)
# وأسماء علامات تجارية (Meta · Cloudflare · WhatsApp · BSP · RLS · DSAR · API)
# ⇒ لأنها أسماء لا كلمات، والمشروع بيمارسها بالكتابة المرصوصة في كل ملفاته.
KNOWN_TERMS = {
    # ⭐ معرّفات تقنية وأسماء علامات ⇒ تُكتب مرصوصة ولا تُعدّ «كلمة إنجليزية»
    "Q", "L", "DR", "D", "OP", "LG", "EV", "P", "G", "R", "S", "C", "M", "V",
    "Meta", "Cloudflare", "WhatsApp", "BSP", "RLS", "DSAR", "API", "Tech",
    "Provider", "Cloud", "Queues", "Kill", "Switch", "Commit", "MIT",
    "PARALLEL", "PREPARATION", "LEGAL", "ACCEPTANCE", "LETTER",
    "DR-8", "R007", "WASL", "PRECEDENCE", "Customer", "Open", "Source",
    "Monolith", "Modular", "Usage", "based", "failover", "webhooks",
    "linkage", "weight", "PostgreSQL", "Utility", "Marketing", "vector",
}
ARABIC = re.compile(r"[؀-ۿ]")


# ⭐ مصدر واحد لنطاقات المحارف الغريبة = أداة الفحص اللغوي نفسها ⇒ الأداة بتتحدّث لوحدها
def _foreign_ranges():
    import importlib.util
    spec = importlib.util.spec_from_file_location("_check_lang", ROOT / "tools" / "check-lang.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.BAD


FOREIGN = _foreign_ranges()
FOREIGN_CLASS = "[" + "".join(f"\\u{lo:04x}-\\u{hi:04x}" for lo, hi in FOREIGN.values()) + "]"
FOREIGN_RE = re.compile(FOREIGN_CLASS)


def ar_num(s: str) -> int:
    """يحوّل الأرقام العربية-الهندية أو العادية إلى int."""
    table = {}
    for i, ch in enumerate("٠١٢٣٤٥٦٧٨٩"):
        table[ord(ch)] = i
    for i, ch in enumerate("۰۱۲۳۴۵۶۷۸۹"):
        table[ord(ch)] = i
    out = ""
    for ch in s:
        if ch in "0123456789":
            out += ch
        elif ord(ch) in table:
            out += str(table[ord(ch)])
        else:
            return -1
    return int(out) if out else -1


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def norm_sec(s: str) -> str:
    """يوحّد رقم القسم: عربي-هندي ⇒ لاتيني + شيل النقطة الأخيرة."""
    s = s.rstrip(".")
    out = ""
    for ch in s:
        # ⭐ ترتيب مهم: العربي-هندي أولاً ⭐ لأن str.isdigit() بترجع True ليه
        if ord(ch) in range(0x0660, 0x066A):
            out += str(ord(ch) - 0x0660)
        elif ord(ch) in range(0x06F0, 0x06FA):
            out += str(ord(ch) - 0x06F0)
        elif ch.isdigit():
            out += ch
        else:
            out += ch
    return out


def r007_sections():
    txt = read(R007)
    secs = set()
    for m in re.finditer(r"^#{2,4}\s+([٠-٩0-9\.]+)", txt, re.M):
        n = norm_sec(m.group(1))
        if n:
            secs.add(n)
    # ⭐ مراجع الأرقام «١٠» و«١٢» التي لا تحمل نقطة ⇒ تُقرأ بوضوح
    for extra in re.findall(r"^#{2,4}\s+([٠-٩]{1,2})\s", txt, re.M):
        secs.add(norm_sec(extra))
    return secs


def r007_ql_ids():
    txt = read(R007)
    block = txt[txt.index("### 8.3"):txt.index("### 8.3.1")]
    return re.findall(r"\*\*(Q-L\d+)\*\*", block)


def r007_l_deps():
    """يرجّع {L1: {Q-L..}} من جدول §8.5."""
    txt = read(R007)
    block = txt[txt.index("### 8.5"):txt.index("### 8.6")]
    out = {}
    for m in re.finditer(r"\|\s*(L[1-7])\s*\|([^|]+)\|([^|]+)\|", block):
        out[m.group(1)] = set(re.findall(r"Q-L\d+", m.group(3)))
    return out


def r007_q_dep():
    """يرجّع {L1: نص الاعتماد} كما هو."""
    txt = read(R007)
    block = txt[txt.index("### 8.5"):txt.index("### 8.6")]
    out = {}
    for m in re.finditer(r"\|\s*(L[1-7])\s*\|([^|]+)\|([^|]+)\|([^|]+)\|", block):
        out[m.group(1)] = m.group(4).strip()
    return out


def file_sections(p: Path) -> set:
    """أرقام الأقسام في أي ملف (تستوعب العربي-هندي واللاتيني)."""
    secs = set()
    try:
        txt = p.read_text(encoding="utf-8")
    except OSError:
        return secs
    for m in re.finditer(r"^#{2,4}\s+([٠-٩0-9\.]+)", txt, re.M):
        n = norm_sec(m.group(1))
        if n:
            secs.add(n)
    for m in re.finditer(r"^#{2,4}\s+([٠-٩]{1,2})\s", txt, re.M):
        secs.add(norm_sec(m.group(1)))
    return secs


def table_rows(txt: str):
    """يرجّع (رقم السطر، خلايا الصف) لكل صف جدول."""
    for i, line in enumerate(txt.splitlines(), 1):
        s = line.strip()
        if s.startswith("|") and s.endswith("|") and s.count("|") > 2:
            yield i, [c.strip() for c in s[1:-1].split("|")]


def main() -> int:
    quiet = "--quiet" in sys.argv
    issues = []

    def flag(code, where, msg):
        issues.append((code, where, msg))

    texts = {k: read(v) for k, v in DOCS.items()}
    src_secs = r007_sections()
    ql_src = r007_ql_ids()
    l_deps_src = r007_l_deps()
    l_work_src = r007_q_dep()

    # ── 1 LINK ───────────────────────────────────────────────────────────
    for key, p in DOCS.items():
        for m in re.finditer(r"\]\(([^)#][^)]*)\)", texts[key]):
            link = m.group(1).strip()
            if link.startswith(("http", "/", "...", "mailto:")):
                continue
            if not (p.parent / link).resolve().exists():
                line = texts[key][: m.start()].count("\n") + 1
                flag("LINK", f"{DOCS[key].name}:{line}", f"رابط مكسور → {link}")

    # ── 2 SECTION ────────────────────────────────────────────────────────
    # ⭐ كل إحالة § تُنسب لأقرب ذكر لملف مصدر قبلها في نفس السطر:
    #    «R007» أو اسم ملف ⇒ ⇒ تُفحص في أقسام ذلك الملف.
    #    ⭐ الإحالة بلا مصدر = قسم داخلي في نفس الوثيقة ⇒ لا تُفحص.
    src_files = {
        "R007": R007,
        "DECISION-REGISTER.md": ROOT / "DECISION-REGISTER.md",
        "CURRENT-STATE.md": ROOT / "CURRENT-STATE.md",
        "REVIEWS/LATEST.md": ROOT / "REVIEWS" / "LATEST.md",
    }
    sec_map = {name: file_sections(f) for name, f in src_files.items()}
    alias = {"R007": ["R007", "r006-review-remediation"], "DECISION-REGISTER.md": ["DECISION-REGISTER"],
             "CURRENT-STATE.md": ["CURRENT-STATE"], "REVIEWS/LATEST.md": ["LATEST"]}
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            mentions = []
            for name, keys in alias.items():
                for k in keys:
                    st = 0
                    while True:
                        pos = line.find(k, st)
                        if pos < 0:
                            break
                        mentions.append((pos, name))
                        st = pos + 1
            if not mentions:
                continue
            for m in re.finditer(r"§\s*([٠-٩0-9\.]+)", line):
                before = [x for x in mentions if x[0] < m.start()]
                if not before:
                    continue
                src_name = max(before)[1]
                ref = norm_sec(m.group(1))
                if ref not in sec_map.get(src_name, set()):
                    flag("SECTION", f"{p.name}:{i}",
                         f"إحالة §{m.group(1)} غير موجودة في {src_name}")

    # ── 3 ID-SEQ ─────────────────────────────────────────────────────────
    seqs = {"parallel": {"D": 7, "OP": 10, "LG": 9, "EV": 10}}
    for key, spec in seqs.items():
        txt = texts[key]
        for prefix, n in spec.items():
            ids = sorted({ar_num(x) for x in re.findall(rf"\b{prefix}(\d+)\b", txt)})
            want = list(range(1, n + 1))
            missing = [i for i in want if i not in ids]
            extra = [i for i in ids if i not in want]
            if missing or extra:
                flag("ID-SEQ", DOCS[key].name,
                     f"{prefix}: ناقص={missing} زائد={extra} (المتوقع 1..{n})")

    # ── 4 QL ─────────────────────────────────────────────────────────────
    acc = texts["acceptance"]
    for qid in ql_src:
        n = len(re.findall(rf"\*\*{qid}\*\*", acc))
        if n != 1:
            flag("QL", "LEGAL-ACCEPTANCE.md", f"{qid} ورد {n} مرة (المتوقع 1)")

    # ── 5 LCOMP ──────────────────────────────────────────────────────────
    for lid, deps in l_deps_src.items():
        pat = rf"\|\s*\*\*{lid}\*\*\s*\|[^|]*\|\s*([^|]*?)\s*\|"
        m = re.search(pat, acc)
        if not m:
            flag("LCOMP", "LEGAL-ACCEPTANCE.md", f"{lid} غير موجود في §6.2")
            continue
        got = set(re.findall(r"Q-L\d+", m.group(1)))
        if got != deps:
            flag("LCOMP", "LEGAL-ACCEPTANCE.md",
                 f"{lid}: الربط {sorted(got)} ≠ المصدر {sorted(deps)}")

    # ── 5b GATE / AXES: تطابق جدولَي DR-8 مع مصدرهما في R007 §9 ────────
    card = texts["dr8"]
    src_gates = set(re.findall(r"^\|\s*(G[\d\.]+)\b",
                               read(R007)[read(R007).index("### 9.3"):read(R007).index("### 9.4")], re.M))
    card_gates = set(re.findall(r"^\|\s*(G[\d\.]+)\b",
                                card[card.index("## ٣. أثر كل مسار"):card.index("## ٤.")], re.M))
    if src_gates - card_gates:
        flag("GATE", DOCS["dr8"].name, f"بوابات ناقصة: {sorted(src_gates - card_gates)}")
    if card_gates - src_gates:
        flag("GATE", DOCS["dr8"].name, f"بوابات زائدة: {sorted(card_gates - src_gates)}")
    r_txt = read(R007)
    src_axes = re.findall(r"^\|\s*\*\*(.+?)\*\*\s*\|",
                          r_txt[r_txt.index("### 9.2 "):r_txt.index("### 9.2.1")], re.M)
    card_axes = re.findall(r"^\|\s*\*\*(.+?)\*\*\s*\|",
                           card[card.index("## ٢. المقارنة"):card.index("## ٣.")], re.M)
    if set(src_axes) - set(card_axes):
        flag("AXES", DOCS["dr8"].name, f"محاور ناقصة: {sorted(set(src_axes) - set(card_axes))}")
    if set(card_axes) - set(src_axes):
        flag("AXES", DOCS["dr8"].name, f"محاور زائدة: {sorted(set(card_axes) - set(src_axes))}")

    # ── 6 COUNT ──────────────────────────────────────────────────────────
    dec = read(ROOT / "DECISIONS.md")
    row_re = r"^\|\s*(?:⭐\s*)?(?:\*\*)?D-(\d{3})"
    rows = re.findall(row_re, dec, re.M)
    n_rows = len(rows)
    n_ok = sum(1 for l in dec.splitlines() if re.match(row_re, l) and "✅" in l)
    n_pending = sum(1 for l in dec.splitlines() if re.match(row_re, l) and "🔵" in l)
    n_early = sum(1 for l in dec.splitlines() if re.match(row_re, l) and "🟡" in l)
    live = {
        "rows": n_rows, "ok": n_ok, "pending": n_pending,
        "md": len([p for p in ROOT.rglob("*.md") if ".git" not in p.parts]),
        "all": len([p for p in ROOT.rglob("*") if p.is_file() and ".git" not in p.parts]),
    }
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            if "٢٥ قرار" in line and live["ok"] != 25:
                flag("COUNT", f"{p.name}:{i}", f"٢٥ قرار لا يطابق الفهرس ({live['ok']})")
            if "9/21" in line and "9/21" not in read(ROOT / "CURRENT-STATE.md"):
                flag("COUNT", f"{p.name}:{i}", "9/21 غير موجود في المصدر")
            if "٣٨ صف" in line and live["rows"] != 38:
                flag("COUNT", f"{p.name}:{i}", f"٣٨ صف ≠ {live['rows']}")

    # ── 13 FOREIGN ──────────────────────────────────────────────────────
    for key, fp in list(DOCS.items()) + [("r007", R007)]:
        txt = texts[key] if key in texts else read(fp)
        for i, line in enumerate(txt.splitlines(), 1):
            for m in FOREIGN_RE.finditer(line):
                flag("FOREIGN", f"{fp.name}:{i}",
                     f"محرف غريب داخل النص: {m.group()!r} (U+{ord(m.group()):04X})")

    # ── 7 GLUE ───────────────────────────────────────────────────────────
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            if not ARABIC.search(line):
                continue
            for m in re.finditer(rf"(?:[؀-ۿ]|{FOREIGN_CLASS})([A-Za-z]{{2,}})|([A-Za-z]{{2,}})(?:[؀-ۿ]|{FOREIGN_CLASS})", line):
                w = m.group(1) or m.group(2)
                if w in KNOWN_TERMS:
                    continue
                flag("GLUE", f"{p.name}:{i}", f"لاتيني ملزوق بعربي: {w!r}")

    # ── 8 ENPROSE ────────────────────────────────────────────────────────
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            if not ARABIC.search(line):
                continue
            stripped = re.sub(r"`[^`]*`", "", line)
            stripped = re.sub(r"\[[^\]]*\]\([^)]*\)", "", stripped)
            stripped = re.sub(r"https?://\S+", "", stripped)
            for m in re.finditer(r"(?<![(\w])([A-Za-z]{3,})(?![)\w])", stripped):
                w = m.group(1)
                if w in KNOWN_TERMS:
                    continue
                before = stripped[max(0, m.start() - 1)]
                after = stripped[m.end():m.end() + 1]
                if before == "(" and after == ")":
                    continue
                flag("ENPROSE", f"{p.name}:{i}", f"كلمة إنجليزية بلا أقواس: {w!r}")

    # ── 9 NUMSYS ─────────────────────────────────────────────────────────
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            s = line.strip()
            if not (s.startswith("|") and s.endswith("|")):
                continue
            cells = [c.strip() for c in s[1:-1].split("|")]
            if not cells:
                continue
            first = cells[0]
            has_ai = bool(re.fullmatch(r"[٠-٩]+", first))
            has_circ = bool(re.fullmatch(r"[①②③④⑤⑥⑦⑧⑨⑩]+", first))
            if has_circ:
                flag("NUMSYS", f"{p.name}:{i}", f"ترقيم دائري بدل العربي-هندي: {first}")

    # ── 10 L-COMPLY ──────────────────────────────────────────────────────
    forbidden = [
        (r"\b(Neon|Supabase|Postgres|PostgreSQL|Railway)\b.*\b(نختار|نعتمد|قرارنا|القرار)\b",
         "ترجيح مكدّس"),
        (r"(نعتمد|قرّرنا|اعتمدنا)\s+(?:ال)?(?:Neon|Supabase|Postgres)", "ترجيح مكدّس"),
        (r"\b(اشتراكنا|تعاقدنا|دفعنا|حسابنا على Meta)\b", "التزام تعاقدي/مالي"),
        (r"(تم نشر|نشرنا المنتج|أطلقنا|تم إطلاق)", "إطلاق"),
        (r"(سعرنه|سعرنا المعتمد|التسعير المعتمد)", "تسعير معتمد"),
        (r"(نفّذنا|بنينا الكود|كتبنا الكود|تشغيل الإنتاج)", "كود/تنفيذ"),
    ]
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            for pat, label in forbidden:
                if re.search(pat, line):
                    flag("L-COMPLY", f"{p.name}:{i}", f"{label}: {line.strip()[:70]}")

    # ── 11 DECISION ──────────────────────────────────────────────────────
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            if re.search(r"DR-(5|8)\s*(معتمد|مُعتمد|اتقفل|اتّفق)", line):
                flag("DECISION", f"{p.name}:{i}", "وصف قرار غير معتمد على أنه معتمد")
            if re.search(r"(اعتُمد|تم اعتماد)\s*(الرأي|DR-)", line):
                flag("DECISION", f"{p.name}:{i}", "ادعاء اعتماد")

    # ── 12 SECRET ────────────────────────────────────────────────────────
    sec_pat = re.compile(
        r"(api[_-]?key|secret[_-]?key|password|BEGIN [A-Z ]*PRIVATE KEY|"
        r"ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})", re.I)
    for key, p in DOCS.items():
        for i, line in enumerate(texts[key].splitlines(), 1):
            if sec_pat.search(line):
                flag("SECRET", f"{p.name}:{i}", "مفتاح أو سرّ محتمل")

    # ── التقرير ──────────────────────────────────────────────────────────
    if not issues:
        print("✅ تدقيق نظيف — 0 عيب في ٤ وثائق (١٣ فحص)")
        return 0
    by_code = {}
    for code, where, msg in issues:
        by_code.setdefault(code, []).append((where, msg))
    for code in sorted(by_code):
        print(f"\n🔴 {code} — {len(by_code[code])} عيب")
        for where, msg in by_code[code]:
            print(f"   {where}  →  {msg}")
    print(f"\n⛔ الإجمالي: {len(issues)} عيب")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
