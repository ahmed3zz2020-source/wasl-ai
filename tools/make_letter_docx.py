#!/usr/bin/env python3
"""⭐ يبني نسخة جاهزة للإرسال من خطاب تكليف المحامي (Word · RTL).

المصدر: `docs/LEGAL-ENGAGEMENT-LETTER.md` ⇒ ⭐ **الأداة تقرأ من المصدر وقت التشغيل**
(⇒ تتحدّث لوحدها · ولا نسخة مكرّرة تتكلّم) · والنسخة المبنيّة = **جسم الخطاب فقط**
⇒ لأن المصدر فيه ٣ أقسام داخلية موسومة صراحةً بـ«تُحذف قبل الإرسال» / «لا يُرسل».

الاستخدام:
    python3 tools/make_letter_docx.py [مجلد-الإخراج]     (افتراضي: ./out)

⛔ الأداة **لا تُرسل** · ولا توقّع · ولا تملأ أي بيانات · ولا تتعاقد · ولا تنشر.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "LEGAL-ENGAGEMENT-LETTER.md"

# ⛔ الأقسام الداخلية التي لا تُرسَل (موسومة في المصدر)
INTERNAL_MARKERS = ("ملاحظات قبل الإرسال", "ملحق — بنود المراجعة الداخلية")


def extract_body(md: str) -> str:
    """جسم الخطاب: بين <div dir="rtl"> و </div> · بلا الأقسام الداخلية."""
    start = md.index('<div dir="rtl">')
    end = md.index("</div>", start)
    body = md[start:end].replace('<div dir="rtl">', "").replace("</div>", "")
    for marker in INTERNAL_MARKERS:
        i = body.find(marker)
        if i != -1:
            body = body[:i]
    body = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", body)  # روابط ⇒ نص
    body = body.replace("⭐", "").replace("⚠️", "").replace("⚠", "")
    return body.strip()


def build_docx(body: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_md = out_dir / "_letter_body.md"
    out_docx = out_dir / "WASL-AI-خطاب-تكليف-محامٍ-جاهز-للإرسال.docx"
    tmp_md.write_text("# خطاب تكليف محامٍ — WASL AI\n\n" + body + "\n", encoding="utf-8")
    subprocess.run(["pandoc", str(tmp_md), "-o", str(out_docx)], check=True, capture_output=True)
    return out_docx


def apply_rtl(path: Path) -> int:
    """RTL صحيح: w:bidi على كل فقرة + w:bidiVisual على كل جدول + محاذاة يمين."""
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn

    doc = Document(str(path))
    n = 0
    for p in doc.paragraphs:
        pPr = p._p.get_or_add_pPr()
        if pPr.find(qn("w:bidi")) is None:
            pPr.append(pPr.makeelement(qn("w:bidi"), {}))
            n += 1
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    for t in doc.tables:
        tblPr = t._tbl.tblPr
        if tblPr.find(qn("w:bidiVisual")) is None:
            tblPr.append(tblPr.makeelement(qn("w:bidiVisual"), {}))
        for row in t.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    pPr = p._p.get_or_add_pPr()
                    if pPr.find(qn("w:bidi")) is None:
                        pPr.append(pPr.makeelement(qn("w:bidi"), {}))
                        n += 1
                    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    doc.save(str(path))
    return n


def verify(path: Path) -> dict:
    from docx import Document
    doc = Document(str(path))
    txt = "\n".join(p.text for p in doc.paragraphs)
    for t in doc.tables:
        for row in t.rows:
            txt += "\n" + " | ".join(c.text for c in row.cells)
    return {
        "q_l": len(re.findall(r"Q-L\d+", txt)),
        "blanks": txt.count("____"),
        "internal_left": [m for m in INTERNAL_MARKERS if m in txt],
    }


def main() -> int:
    out_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (ROOT / "out")
    body = extract_body(SRC.read_text(encoding="utf-8"))
    out_docx = build_docx(body, out_dir)
    n = apply_rtl(out_docx)
    v = verify(out_docx)
    print(f"✅ اتبنى: {out_docx} ({out_docx.stat().st_size} بايت · فقرات RTL = {n})")
    print(f"✅ أسئلة Q-L ظاهرة = {v['q_l']} · خانات تعبئة = {v['blanks']}")
    print(f"✅ الأقسام الداخلية في النسخة = {v['internal_left'] if v['internal_left'] else 'لا شيء'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
