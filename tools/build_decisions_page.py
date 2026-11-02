#!/usr/bin/env python3
"""يبني صفحة WASl AI المستقلة (R004.2) — تشتغل من غير نت (file://).

الاستخدام:
    python3 tools/build_decisions_page.py [مجلد الريبو] [ملف الإخراج]
"""
import html
import re
import sys
from pathlib import Path

REPO = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/workspace/wasl-ai")
SRC = REPO / "docs" / "CHATGPT-REVIEW-REQUEST.md"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/workspace/wasl-standalone.html")

raw = SRC.read_text(encoding="utf-8")
m = re.search(r"```\n(.*?)\n```", raw, re.S)
if not m:
    raise SystemExit("message block not found")
msg = m.group(1)

# --- بيانات القرارات (من REVIEWS/R004.2 §٦.١ و §٤.ب) ---
QUESTIONS = [
    ("Q1", "الحد الأقصى للأنشطة الفرعية",
     "كام نشاط فرعي مسموح لمؤسسة واحدة في الـMVP؟",
     "كل نشاط فرعي = طبقة عزل جديدة + فروع في الفوترة + مسارات.",
     [("مش محدَّد — نحدّده من أول ٥ عملاء حقيقيين", True),
      ("٣ أنشطة", False), ("٥ أنشطة", False), ("٧ أنشطة", False)]),
    ("Q2", "هل R3 يدخل الموجة الأولى؟",
     "بعد موافقة المالك على إدخال الخدمات التثقيفية في R3 — R3 يدخل الموجة الأولى ولا يتأجل للموجة التانية بعد المراجعة القانونية؟",
     "ده بيحدد ترتيب المرحلة ٣ بالكامل.",
     [("R3 مؤجّل للموجة التانية (الموجة الأولى R0/R1)", True),
      ("R3 يدخل الموجة الأولى", False)]),
    ("Q3", "ترتيب الأولوية بين المحورين",
     "لما حزمتين في محورين مختلفين (P تجاري · R تنظيمي) — الأولوية بتروح لمين؟",
     "الافتراضي: R أولاً — لأنه بيعطّل الأنشطة اللي محتاجة بوابات.",
     [("R أولاً — الأعلى حساسية يبطّل", True),
      ("P أولاً — الأعلى ربحية يشتغل", False),
      ("حسب الحالة", False)]),
    ("Q4", "توقيت إخطار الطوارئ",
     "في إجراء الطوارئ الأمنية — الإخطار قبل الإجراء ولا بعده؟",
     "المكتوب حالياً: إشعار قبل الإجراء ما لم تكن الثغرة مستغلة فعلياً.",
     [("قبل الإجراء — إلا لو الثغرة مستغلة فعلياً (المكتوب حالياً)", True),
      ("بعده مباشرة — لأن الثغرة المستغلة مش بتنتظر", False)]),
    ("Q5", "جدول توافق CAPMAS: نعرضه للعميل؟",
     "الجدول المقترح (٣٣ صفاً) — ينفع نعرضه للعميل وهو اجتهادي (مش رسمي)؟",
     "⛔ عرضه ممكن يوحي إنه رسمي. الافتراضي: داخلياً بس + التسليم يذكر الكودين.",
     [("داخلياً بس + التسليم يذكر كود Rev.5 وكود Rev.4", True),
      ("نعرضه للعميل في مادة التسليم", False)]),
    ("Q6", "عنصر حالة في واجهة الـHub",
     "«فصل Decision Status عن Technical Status» في الـHub — هل نعمله؟",
     "⛔ ده تعديل كود في لوحة المشروع — محتاج موافقة منفصلة. الافتراضي: التوثيق بس.",
     [("لأ — التوثيق بس (مش هيتعمل)", True),
      ("نعمله — تعديل كود في الـHub", False)]),
]

RECS = [
    ("D-017", "قائمة الـ٣٣ = أولويات تجارية", "الـISIC مرجع ارتباط مش مصدر اشتقاق"),
    ("D-020", "العقد = حقل جوه الـRegistry", "٣ طبقات برمجية + مفهوم بيانات واحد"),
    ("D-021", "Control Plane × Execution Plane", "٤ عناصر تحكم + ٤ تنفيذ + ٣ أفقية"),
    ("D-023", "مؤشرات الفشل مستقلة وغير محذوفة", "provider_error · cold_start · timeout · retry"),
    ("D-026", "المدة ٣٠–٣٩ أسبوع", "سحب ادعاء التقصير — المدة مش مثبتة كده"),
    ("D-027", "حذف الوعود الزمنية التجارية", "⛔ حذف «ساعة / ٢–٥ أيام / ١–٣ أسابيع»"),
    ("D-028", "عزل = شرط إطلاق لـ ١٠ طبقات", "١٠٠ محاولة لكل طبقة"),
    ("D-029", "٥ ضوابط نشر الهوية + تمييز الشعار", "تباين · إتاحة · تركيز · طباعة · بوابة"),
]

rows_q = []
for qid, title, question, why, opts in QUESTIONS:
    op = []
    for i, (label, default) in enumerate(opts):
        chk = " checked" if default else ""
        op.append(
            f'<label class="opt"><input type="radio" name="{qid}" value="{html.escape(label)}"{chk}>'
            f'<span>{html.escape(label)}</span></label>'
        )
    rows_q.append(f"""
    <div class="card" id="{qid}">
      <div class="qhead"><span class="qid">{qid}</span><b>{html.escape(title)}</b></div>
      <p class="qtext">{html.escape(question)}</p>
      <p class="qwhy">ⓘ {html.escape(why)}</p>
      <div class="opts">{''.join(op)}</div>
    </div>""")

rows_r = []
for did, title, detail in RECS:
    opts = "".join(
        f'<option value="{html.escape(v)}">{html.escape(v)}</option>' for v in
        ["معلّق — لسه مفيش قرار", "يعتمد زي ما مكتوب", "يعتمد بتعديل (اكتب التعديل في الملاحظات)", "يسقط"]
    )
    rows_r.append(f"""
    <div class="card rec">
      <div class="qhead"><span class="qid">{did}</span><b>{html.escape(title)}</b></div>
      <p class="qwhy">{html.escape(detail)}</p>
      <select data-rec="{did}">{opts}</select>
    </div>""")

msg_html = html.escape(msg)

HTML = f"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WASl AI — نسخة مستقلة (R004.2)</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;padding:16px;background:#0f1419;color:#e8eaed;
       font-family:"Segoe UI",Tahoma,"Noto Naskh Arabic",Arial,sans-serif;line-height:1.9;font-size:16px}}
  .wrap{{max-width:860px;margin:0 auto}}
  h1{{font-size:22px;margin:0 0 4px}}
  h3{{font-size:18px;margin:26px 0 10px;padding-bottom:8px;border-bottom:1px solid #2a3440}}
  .sub{{color:#9aa4b2;font-size:14px;margin:0 0 18px}}
  .box{{background:#161d26;border:1px solid #27313d;border-radius:12px;padding:14px 16px;margin:12px 0}}
  .warn{{border-color:#6b4a12;background:#241d0f}}
  .ok{{border-color:#1f5c3a;background:#0f2419}}
  textarea{{width:100%;min-height:300px;background:#0b0f14;color:#dfe6ee;border:1px solid #2a3440;
           border-radius:10px;padding:12px;font-family:inherit;font-size:14px;line-height:1.7;resize:vertical}}
  button{{background:#1a73e8;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:15px;
         font-family:inherit;font-weight:700;cursor:pointer;margin:8px 6px 8px 0}}
  button.ghost{{background:#243040}}
  .card{{background:#161d26;border:1px solid #27313d;border-radius:12px;padding:12px 14px;margin:12px 0}}
  .qhead{{display:flex;gap:10px;align-items:center;font-size:17px;margin-bottom:6px}}
  .qid{{background:#1a73e8;color:#fff;border-radius:8px;padding:2px 9px;font-size:14px;font-weight:700}}
  .qtext{{margin:4px 0;color:#d6dbe2}}
  .qwhy{{margin:4px 0 10px;color:#9aa4b2;font-size:14px}}
  .opts label{{display:flex;gap:9px;align-items:flex-start;padding:7px 4px;border-radius:8px;cursor:pointer}}
  .opts label:hover{{background:#1c242f}}
  .opts input{{margin-top:7px;flex:0 0 auto}}
  table{{width:100%;border-collapse:collapse;font-size:15px}}
  td,th{{padding:9px 8px;border-bottom:1px solid #27313d;vertical-align:top}}
  .did{{color:#9aa4b2;font-weight:700;white-space:nowrap}}
  .det{{color:#9aa4b2;font-size:13px}}
  select{{background:#0b0f14;color:#dfe6ee;border:1px solid #2a3440;border-radius:8px;padding:7px;font-family:inherit;font-size:14px;max-width:100%;width:100%}}
  .st{{color:#8fd18f;font-size:14px;min-height:20px}}
  a{{color:#8ab4f8}}
  ul{{padding-right:20px}}
  .num{{direction:rtl}}
  .rec select{{margin-top:2px}}
  p,li,.qtext,.qwhy{{overflow-wrap:anywhere}}
  html,body{{max-width:100%;overflow-x:hidden}}
</style>
</head>
<body>
<div class="wrap">
  <h1>WASl AI — نسخة مستقلة 📄</h1>
  <p class="sub">حزمة R004.2 (٢ نوفمبر ٢٠٢٦) · ⛔ تحديث وثائقي فقط — مفيش كود اتكتب · بتشتغل من غير نت</p>

  <div class="box ok">
    <b>📍 أنت فين بالظبط</b>
    <ul>
      <li>التأسيس خلص: R002 · R003 · R004 · R004.1 · R004.2 — كلها <b>بدون كود</b>.</li>
      <li>المالك وافق على <b>٧ قرارات</b> (نص الموافقة §أولاً) ⇒ اتطبّقت على التوثيق · ⭐ وبند التنفيذ «نشاط رئيسي + أنشطة فرعية» ⇒ <b>D-031</b> ⇒ <b>٨ قرارات مسجّلة ✅</b>.</li>
      <li>⛔ <b>٨ توصيات لسه معلّقة</b> (D-017 · D-020 · D-021 · D-023 · D-026 · D-027 · D-028 · D-029) — ما بتتحوّلش لقرار إلا باختيارك الصريح.</li>
      <li>⛔ <b>٦ أسئلة محتاجة قرار منك</b> (تحتها).</li>
      <li>⏳ <b>مراجعة المهندس المعماري</b> لحزمة R004.2 لسه ما جتش — دي رسالة المراجعة تحت.</li>
    </ul>
  </div>

  <h3>📋 ملخص R004.2</h3>
  <div class="box">
    <b>✅ المعتمد (نص المالك محفوظ حرفياً):</b>
    <ul>
      <li>⭐ <b>ISIC Rev.5</b> مرجع أساسي · Rev.4 توافق تاريخي</li>
      <li>⭐ <b>محوران</b> P تجاري + R تنظيمي · والتقييمين <b>منفصلين</b></li>
      <li>⭐ الصحة والصيدلة: ⛔ لا تشخيص/وصف/بيع <b>قبل مراجعة قانونية مصرية متخصصة</b> · ✅ <b>٣ خدمات مسموحة بضوابط</b> (حجز · استفسارات إدارية · تثقيف صحي)</li>
      <li>⭐ <b>٢٤ خطوة</b> سقف + <b>Execution Budget</b> (وقت · أدوات · تكلفة · اختبارات) + تعريف الخطوة + منع الدورات + توقف آمن</li>
      <li>⭐ <b>٩٠ يوم</b> من الإخطار الرسمي · ⛔ لا فرض تحديث عادي دون سند تعاقدي · طوارئ موثّقة</li>
      <li>⭐ <b>فصل</b> Decision Status عن Technical Status (معتمد = موافقة + قياس)</li>
      <li>⭐ <b>بحث CAPMAS رسمي مفتوح (B-1..B-5)</b> + ⭐ <b>جدول توافق مقترح</b> بوسم رسمي/اجتهادي/غير متاح</li>
    </ul>
    <b>⭐ نتيجة بحث CAPMAS:</b> ❌ مفيش جدول رسمي Rev.5 لاقيناه (⛔ مش إثبات عدم وجوده) · ⭐ مصر لسه على <b>Rev.4</b> · ⭐ الدليل المصري = ترجمة عربية لـ Rev.4 + <b>حدّان محليان مجهولين</b> ⇒ كل رمز مصري = <b>اجتهادي</b>. ⭐ Rev.5 بالإنجليزية بس ⇒ كل تقرير يذكر كود Rev.5 <b>و</b> كود Rev.4.
  </div>

  <h3>🧭 الخطوة ١ — رسالة المراجعة (انسخها والصقها للمهندس المعماري)</h3>
  <textarea id="msg" readonly spellcheck="false">{msg_html}</textarea>
  <button onclick="cpMsg()">📋 نسخ رسالة المراجعة</button>
  <button class="ghost" onclick="copyArea('msg')">📄 نسخ النص كامل</button>
  <p class="st" id="st1"></p>

  <h3>🧭 الخطوة ٢ — القرارات اللي محتاجة منك</h3>
  <div class="box warn">
    ⛔ <b>مفيش توصية بتتحوّل لقرار من غير نص صريح منك.</b> الافتراضي المكتوب تحت هو Safer الافتراضي — لو ما لمستش حاجة، هيفضل «معلّق».<br>
    ⭐ بعد ما تختار: اضغط <b>«نسخ إجابتي»</b> والصقها في الشات ده — هتسجّلها نص صريح في <code>DECISIONS.md</code>.
  </div>
  {''.join(rows_q)}

  <h3>🧭 الخطوة ٣ — التوصيات الثماني المعلّقة</h3>
  <div class="box">
    <p class="qwhy">⛔ الافتراضي «معلّق» — التوصية ما بتتحوّلش لقرار إلا لما تختار بإيدك.</p>
    {''.join(rows_r)}
  </div>

  <div class="box">
    <button onclick="copyAnswers()">📋 نسخ إجابتي (ترسلها هنا)</button>
    <button class="ghost" onclick="resetAll()">↺ رجّع الكل للافتراضي</button>
    <p class="st" id="st2"></p>
  </div>

  <h3>🔗 روابط (لو اشتغل عندك)</h3>
  <div class="box">
    <ul>
      <li><a href="https://wasl-hub.ahmed3zz2020.workers.dev">الرئيسية (اللوحة الدائمة)</a></li>
      <li><a href="https://wasl-hub.ahmed3zz2020.workers.dev/review/latest">آخر حزمة مراجعة (R004.2 كاملة)</a></li>
      <li><a href="https://wasl-hub.ahmed3zz2020.workers.dev/bridge">حزمة السياق الكاملة</a></li>
      <li><a href="https://raw.githubusercontent.com/ahmed3zz2020-source/wasl-ai/main/DECISIONS.md">DECISIONS (القرارات)</a></li>
      <li><a href="https://raw.githubusercontent.com/ahmed3zz2020-source/wasl-ai/main/STATUS.md">STATUS (الحالة)</a></li>
    </ul>
    <p class="sub">⛔ لو workers.dev مش بيفتح عندك (بيحصل على بعض الشبكات) ⇒ الصفحة دي شغالة أوفلاين كويس · والنسخة الكاملة على GitHub من الروابط فوق.</p>
  </div>

  <h3>🧭 كيف تستخدمها</h3>
  <div class="box">
    <ul>
      <li>١. اضغط <b>«نسخ رسالة المراجعة»</b> → افتح ChatGPT → الصق → ابعت.</li>
      <li>٢. املأ الـ٦ أسئلة واختار التوصيات → اضغط <b>«نسخ إجابتي»</b> → الصق هنا.</li>
      <li>٣. انسخ ردّ ChatGPT والصقه هنا ⇒ هطبّق المؤكّد وأبني حزمة <b>R005</b>.</li>
    </ul>
  </div>
</div>
<script>
function fallback(el, btn, msgId, okMsg){{
  el.focus(); el.select(); el.setSelectionRange(0, el.value.length);
  var ok=false; try{{ok=document.execCommand('copy');}}catch(e){{ok=false;}}
  if(!ok){{
    try{{var ok2=navigator.clipboard.writeText(el.value);}}
    catch(e2){{var ok2=Promise.reject();}}
    if(ok2 && ok2.then){{ok2.then(function(){{document.getElementById(msgId).textContent=okMsg;}},
      function(){{document.getElementById(msgId).textContent='⚠️ النسخ اتقفل — حدّد النص واعمل نسخ بإيدك.';}});}}
    else{{document.getElementById(msgId).textContent='⚠️ حدّد النص واعمل نسخ بإيدك.';}}
  }} else {{document.getElementById(msgId).textContent=okMsg;}}
}}
function cpMsg(){{
  var el=document.getElementById('msg');
  try{{
    navigator.clipboard.writeText(el.value).then(
      function(){{document.getElementById('st1').textContent='✅ اتنسخت — الصقها في ChatGPT';}},
      function(){{fallback(el,null,'st1','✅ اتنسخت (طريقة بديلة) — الصقها في ChatGPT');}});
  }}catch(e){{fallback(el,null,'st1','✅ اتنسخت (طريقة بديلة) — الصقها في ChatGPT');}}
}}
function copyArea(id){{
  var el=document.getElementById(id);
  fallback(el,null,'st1','✅ اتنسخت');
}}
function radioVal(name){{
  var els=document.getElementsByName(name);
  for(var i=0;i<els.length;i++){{if(els[i].checked) return els[i].value;}}
  return '';
}}
function copyAnswers(){{
  var ids=['Q1','Q2','Q3','Q4','Q5','Q6'];
  var lines=[];
  lines.push('📌 قرارات المالك — حزمة R004.2 (٢ نوفمبر ٢٠٢٦)');
  lines.push('');
  for(var i=0;i<ids.length;i++){{
    lines.push(ids[i]+' — ' + radioVal(ids[i]));
  }}
  lines.push('');
  lines.push('📌 التوصيات المعلّقة (٨):');
  var sels=document.querySelectorAll('select[data-rec]');
  for(var j=0;j<sels.length;j++){{
    var v=sels[j].value;
    if(v.indexOf('معلّق')===0) continue;
    lines.push('- ' + sels[j].getAttribute('data-rec') + ': ' + v);
  }}
  var notes=document.getElementById('notes');
  if(notes && notes.value.trim()){{
    lines.push('');
    lines.push('📌 ملاحظات:');
    lines.push(notes.value.trim());
  }}
  var out=lines.join('\\n');
  var el=document.getElementById('out');
  el.value=out;
  fallback(el,null,'st2','✅ اتنسخت الإجابات — الصقها في الشات');
}}
function resetAll(){{
  document.querySelectorAll('input[type=radio]').forEach(function(r){{r.checked=r.defaultChecked;}});
  document.querySelectorAll('select[data-rec]').forEach(function(s){{s.selectedIndex=0;}});
  var n=document.getElementById('notes'); if(n) n.value='';
  document.getElementById('st2').textContent='↺ رجعنا كله للافتراضي';
}}
</script>
</body>
</html>
"""

# حقول إضافية: صندوق الإجابة + ملاحظات
HTML = HTML.replace(
    '<div class="box">\n    <button onclick="copyAnswers()">',
    '<div class="box">\n    <label class="qwhy">📝 ملاحظات إضافية (اختياري)</label>\n'
    '<textarea id="notes" style="min-height:80px" placeholder="اكتب هنا أي تعديل أو سبب على أي اختيار"></textarea>\n'
    '<label class="qwhy">⬇️ النص اللي هيتنسخ (الصقه هنا)</label>\n'
    '<textarea id="out" readonly style="min-height:180px"></textarea>\n'
    '<button onclick="copyAnswers()">'
)

OUT.write_text(HTML, encoding="utf-8")
print(f"written: {OUT} ({OUT.stat().st_size} bytes)")
print(f"message chars: {len(msg)}")
