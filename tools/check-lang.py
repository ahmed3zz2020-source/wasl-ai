#!/usr/bin/env python3
"""فحص لغوي لملفات Markdown — يمنع أي محرف غريب يتسرّب جوه النص العربي.

القاعدة (مشروع WASl AI): العربي مصري سطر سطر · مفيش مربعات · مفيش حروف صينية/سيريلية/يونانية/عبري
أو محرف تالف (Replacement) جوه سطر عربي.

الاستخدام:
    python3 tools/check-lang.py [مجلد]           # فحص كل ملفات .md
    python3 tools/check-lang.py --quiet [مجلد]   # ملخص بس
"""
import re
import sys
from pathlib import Path

# نطاقات ممنوعة
BAD = {
    "صيني (CJK)": (0x4E00, 0x9FFF),
    "صيني (تعليق)": (0x3000, 0x303F),
    "كوري/ياباني (Kana)": (0x3040, 0x30FF),
    # ⭐ الهانغول الكوري كان ناقصاً ⇒ تسرّب ٣١-oct-2026 داخل عربي (عيب مثبت)
    "كوري (Hangul)": (0xAC00, 0xD7AF),
    "كوري (جاما)": (0x1100, 0x11FF),
    "كوري (متوافق)": (0x3130, 0x318F),
    "سيريلي": (0x0400, 0x04FF),
    "يوناني": (0x0370, 0x03FF),
    "عبري": (0x0590, 0x05FF),
    "تالف (Replacement)": (0xFFFD, 0xFFFD),
    "فيتنامي": (0x1EA0, 0x1EF9),
    "تايلندي": (0x0E00, 0x0E7F),
    "هندي": (0x0900, 0x097F),
}
ARABIC = (0x0600, 0x06FF)

# رموز رياضية مقصودة في التوثيق (مش خطأ تلوث)
ALLOW = {
    "Δ": "U+0394",   # فرق
    "Σ": "U+03A3",   # مجموع
    "±": "U+00B1",   # aproximadamente
    "×": "U+00D7",   # ضرب
    "≤": "U+2264",   # أقل أو يساوي
    "≥": "U+2265",   # أكبر أو يساوي
}


def has_arabic(text: str) -> bool:
    return any(ARABIC[0] <= ord(c) <= ARABIC[1] for c in text)


# ⭐⭐ حارس التشوّه داخل الكلمة (٦ نوفمبر ٢٠٢٦) — عيب مثبت حيّاً:
# ⭐ «وernelه» (بدل موعده) · «مcentage» (بدل percentage) · «يsupplementaryا» · «ةMismatchت»
# ⭐ القاعدة: كلمة لاتينية ملتصقة بحرف عربي على اليمين ⇒ تشوّه لا مصطلح.
# ⭐ الاستثناء المشروع: «الـmanifest» · «الـMVP» · «الـHTML» ⇒ التاء المربوطة (U+0640) قبل اللاتيني = مصطلح معتمد.
TATWEEL = "ـ"
ARABIC_LETTER = re.compile(r"[ء-يٱ-ۓ]")
LATIN_RUN = re.compile(r"[A-Za-z]{2,}")
ARABIC_PUNCT_AFTER = "؟،؛"


def mixed_script_tokens(line: str):
    """يرجّع التوكنات اللي فيها لاتيني ملتصق بحرف عربي (تشوّه مثبَت).

    ⭐ الأجزاء داخل ``code span`` (باك تكس) مستثناة ⇒ لأن التوكنات التقنية
    ⭐ تُقتبس حرفياً هناك (أمثلة على تشوّه مثبَت · أسماء دوال · معرّفات).
    """
    out = []
    segments = [seg for i, seg in enumerate(line.split("`")) if i % 2 == 0]
    for segment in segments:
        for m in LATIN_RUN.finditer(segment):
            start, end = m.start(), m.end()
            left = segment[start - 1] if start > 0 else ""
            right = segment[end] if end < len(segment) else ""
            left_ok = bool(left) and left != TATWEEL and bool(ARABIC_LETTER.match(left))
            right_ok = bool(right) and (bool(ARABIC_LETTER.match(right)) or right in ARABIC_PUNCT_AFTER)
            if left_ok and right_ok:
                out.append((m.group(0), segment[max(0, start - 1):end + 1]))
    return out


def scan_line(line: str):
    hits = []
    for ch in line:
        if ch in ALLOW:
            continue
        cp = ord(ch)
        for label, (lo, hi) in BAD.items():
            if lo <= cp <= hi:
                hits.append((label, ch, f"U+{cp:04X}"))
    for token, context in mixed_script_tokens(line):
        hits.append(("تشوّه داخل كلمة (لاتيني ملتصق بعربي)", token, context))
    return hits


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    quiet = "--quiet" in sys.argv
    root = Path(args[0]) if args else Path(__file__).resolve().parent.parent
    files = sorted(root.rglob("*.md"))
    total = 0
    for f in files:
        if ".git" in f.parts:
            continue
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            print(f"⛔ {f}: الملف مش UTF-8")
            total += 1
            continue
        for i, line in enumerate(lines, 1):
            if not has_arabic(line):
                continue
            hits = scan_line(line)
            if hits:
                total += 1
                labels = " · ".join(f"{lbl} {c} ({u})" for lbl, c, u in hits)
                print(f"⛔ {f.relative_to(root)}:{i} — {labels}")
                print(f"    {line.strip()[:160]}")
    if total == 0:
        print(f"✅ فحص نظيف — {len(files)} ملف .md · مفيش محرف غريب")
    elif not quiet:
        print(f"\n⛔ {total} سطر فيه محرف ممنوع")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
