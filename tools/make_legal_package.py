#!/usr/bin/env python3
"""⭐ يبني الحزمة القانونية بصيغ Word (RTL) + PDF من المصدر.

المصدر: `docs/LEGAL-PACKAGE.md` ⇒ ⭐ **الأداة تقرأ من المصدر وقت التشغيل**
(⇒ تتحدّث لوحدها · ولا نسخة مكرّرة تتكلّم) · والداخل:Body كامل
(⇐ كل الأقسام — لأن الحزمة وثيقة تُسلَّم كما هي).

الاستخدام:
    python3 tools/make_legal_package.py [مجلد-الإخراج]     (افتراضي: /workspace/output)

⛔ الأداة **لا تُرسل** · ولا توقّع · ولا تملأ أي بيانات · ولا تتعاقد · ولا تنشر.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "LEGAL-PACKAGE.md"

BASE_NAME = "WASL-AI-حزمة-قانونية"


def prepare_markdown(md: str) -> str:
    """يُهيّئ المصدر لـpandoc: يحافظ على div dir=rtl ويحذف رموز التزيين."""
    body = md
    # ⭐ pandoc لا يعرف dir ⇒ نحوّله لعلامة HTML تُربط باتجاه الفقرة
    body = body.replace('<div dir="rtl">', '<div style="text-align: right;">')
    body = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", body)  # روابط ⇒ نص
    body = body.replace("⭐", "").replace("⚠️", "").replace("⚠", "")
    return body


def build_docx(body: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_md = out_dir / "_legal_package_body.md"
    out_docx = out_dir / f"{BASE_NAME}.docx"
    tmp_md.write_text(body, encoding="utf-8")
    subprocess.run(
        ["pandoc", str(tmp_md), "-o", str(out_docx), "--from=markdown+raw_html"],
        check=True,
        capture_output=True,
    )
    return out_docx


def apply_rtl(path: Path) -> int:
    """RTL صحيح: w:bidi على كل فقرة + w:bidiVisual على كل جدول + محاذاة يمين."""
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Cm

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
        # ⭐ حدود الجدول يدوياً (نمط «Table Grid» غير موجود في مرجع pandoc)
        if tblPr.find(qn("w:tblBorders")) is None:
            borders = tblPr.makeelement(qn("w:tblBorders"), {})
            for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
                el = borders.makeelement(qn(f"w:{edge}"), {})
                el.set(qn("w:val"), "single")
                el.set(qn("w:sz"), "4")
                el.set(qn("w:space"), "0")
                el.set(qn("w:color"), "9AA0A6")
                borders.append(el)
            tblPr.append(borders)
        # ⭐ عرض الأعمدة: عمود الترقيم (#) ضيّق · والباقي يتشارك الباقي حسب طول المحتوى
        total_cm = 16.0
        ncols = len(t.columns)
        header0 = t.rows[0].cells[0].text.strip() if t.rows else ""
        is_index_col = header0 in ("#", "م", "№", "م.")
        weights = []
        for i in range(ncols):
            if is_index_col and i == 0:
                weights.append(0.9)
                continue
            longest = 0
            for row in t.rows:
                if i < len(row.cells):
                    longest = max(longest, len(row.cells[i].text.strip()))
            weights.append(max(1.0, min(6.0, longest / 8.0)))
        wsum = sum(weights)
        widths = [total_cm * w / wsum for w in weights]
        if is_index_col and ncols > 1:
            # ⭐ عمود الترقيم: لا يقلّ عن عرض المعرّف نفسه (Q-L18) ⇒ لا ينكسر على سطرين
            longest_idx = max((len(row.cells[0].text.strip()) for row in t.rows), default=1)
            widths[0] = max(0.9, min(2.2, 0.32 * longest_idx + 0.5))
            rest = total_cm - widths[0]
            wsum2 = sum(weights[1:])
            for i in range(1, ncols):
                widths[i] = rest * weights[i] / wsum2
        t.autofit = False
        # ⭐ تثبيت التخطيط + عرض الجدول بالكامل
        layout = tblPr.makeelement(qn("w:tblLayout"), {})
        layout.set(qn("w:type"), "fixed")
        tblPr.append(layout)
        for gridcol in t._tbl.find(qn("w:tblGrid")):
            idx = list(t._tbl.find(qn("w:tblGrid"))).index(gridcol)
            if idx < len(widths):
                gridcol.set(qn("w:w"), str(int(widths[idx] * 567)))
        for row in t.rows:
            for idx, cell in enumerate(row.cells):
                if idx < len(widths):
                    cell.width = Cm(widths[idx])
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


def build_pdf(docx: Path, out_dir: Path) -> Path:
    """DOCX ⇒ PDF عبر LibreOffice (⇒ نفس التخطيط اللي رآه المالك في Word)."""
    pdf = out_dir / (docx.stem + ".pdf")
    if pdf.exists():
        pdf.unlink()  # ⭐ إعادة توليد كاملة (لا نسخة قديمة)
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(docx)],
        check=True,
        capture_output=True,
        timeout=240,
    )
    if not pdf.exists():
        raise RuntimeError("لم يُنتَج ملف PDF")
    return pdf


def verify(docx: Path, pdf: Path) -> dict:
    from docx import Document

    doc = Document(str(docx))
    txt = "\n".join(p.text for p in doc.paragraphs)
    for t in doc.tables:
        for row in t.rows:
            txt += "\n" + " | ".join(c.text for c in row.cells)

    pages = 0
    try:
        from pypdf import PdfReader

        pages = len(PdfReader(str(pdf)).pages)
    except Exception as exc:  # pragma: no cover
        pages = -1
        print(f"⚠️ تعذّر قراءة صفحات PDF: {exc}")

    q_ids = sorted({m for m in re.findall(r"Q-L\d+", txt)}, key=lambda x: int(x.split("-L")[1]))
    return {
        "q_l_count": len(q_ids),
        "q_l_ids": q_ids,
        "c_extra": len(re.findall(r"C-2[0-9]", txt)),
        "tables": len(doc.tables),
        "chars": len(txt),
        "pages": pages,
        "has_negative": "تصريح سالب" in txt,
        "has_scope": "نطاق الخدمات" in txt,
        "has_nda": "سرية" in txt,
    }


def main() -> int:
    out_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("/workspace/output")
    body = prepare_markdown(SRC.read_text(encoding="utf-8"))
    out_docx = build_docx(body, out_dir)
    n = apply_rtl(out_docx)
    out_pdf = build_pdf(out_docx, out_dir)
    v = verify(out_docx, out_pdf)

    print(f"✅ Word: {out_docx} ({out_docx.stat().st_size} بايت · فقرات RTL = {n})")
    print(f"✅ PDF : {out_pdf} ({out_pdf.stat().st_size} بايت · صفحات = {v['pages']})")
    print(f"✅ أسئلة Q-L = {v['q_l_count']} · أسئلة إضافية = {v['c_extra']}")
    print(f"✅ جداول = {v['tables']} · حروف = {v['chars']}")
    print(f"✅ تصريح سالب = {v['has_negative']} · نطاق الخدمات = {v['has_scope']} · بند السرية = {v['has_nda']}")
    if v["q_l_count"] != 18:
        print(f"⛔ عدد أسئلة Q-L = {v['q_l_count']} (المتوقَّع ١٨)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
