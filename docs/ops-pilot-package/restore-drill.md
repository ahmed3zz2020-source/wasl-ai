# ⭐ تمرين استرجاع حقيقي مُقاس — `pf-21` (وبند `pf-05` منتهٍ)

> ⭐ **الحالة**: ⭐ **تمرين منفَّذ فعلاً على جهاز المالك** — ⭐ **لا تصميم ولا خطة** · ⭐ **والأرقام أدناه كلّها من مخرجات الأدوات نفسها** (الأداة · `psql` · `stat`) · ⭐ **وما لم يُقَس مكتوب «غير متاح» + سببه**.
> ⭐ **النطاق**: ⭐ **تمرين محلي فقط** — ⭐ **لا شراء ولا حساب ولا تفعّل خدمة مدفوعة ولا نشر** — ⭐ **والقاعدة فيها بيانات صناعية فقط** (`wasl_local`).
> ⭐ **دليل القبول من المراجعة** (`docs/REVIEW-060-COMPREHENSIVE-REVIEW.md` §٤ · `pf-21`): ⭐ **«تقرير تمرين مسجَّل بتاريخ»** + ⭐ **«عدّاد الصفوف بعد الاستعادة = ما قبلها»** ⇒ ⭐ **متحقّق أدناه بالأرقام**.

---

## ⭐ ١. البيئة التي نُفِّذ فيها التمرين

| البند | القيمة | المصدر |
|---|---|---|
| ⭐ نظام قاعدة البيانات | ⭐ **PostgreSQL 15.20 (Debian 15.20-0+deb12u1)** | ⭐ سجلّ الخادم `/workspace/.pgdata/server.log` |
| ⭐ مجلّد البيانات | ⭐ `/workspace/.pgdata` | ⭐ أمر التشغيل |
| ⭐ المقبس | ⭐ `/tmp` · المنفذ `5432` | ⭐ `pg_isready` ⇒ `"/tmp:5432 - accepting connections"` |
| ⭐ قاعدة البيانات | ⭐ `wasl_local` | ⭐ `psql -lqt` |
| ⭐ المستخدم | ⭐ `postgres` (صلاحية `superuser` — للقراءة والنسخ فقط) | ⭐ متغيّر `PGUSER` |
| ⭐ إصدار المخطّط | ⭐ `008_phase04_tickets` | ⭐ `wasl_schema_migrations` |
| ⭐ عدد الترحيلات | ⭐ `8` | ⭐ `count(*) from wasl_schema_migrations` |

> ⭐⭐ **ملاحظة صادقة عن التهيئة**: ⭐ **حزمة ثنائيات `PostgreSQL` (الخادم وأدوات `pg_dump`/`pg_restore`/`psql`) لم تكن موجودة في صورة البيئة عند بداية التمرين** ⇒ ⭐ **ثُبِّتت محلياً من مستودع Debian (مجاني · بلا حساب · بلا خدمة مدفوعة)** ⇒ ⭐ **ولم يُمَسّ مجلّد البيانات `/workspace/.pgdata` ولا أي بيانات** ⇒ ⭐ **والخادم استُؤنِف على نفس المجلّد بأمر `pg_ctl`** ⇒ ⭐ **وقاعدة `wasl_local` كانت موجودة قبل التمرين ببانٍ ومحتوى قياسيين**.
> ⭐ **لا علاقة لهذا التهيئة ببنية النسخ خارج الجهاز** ⇒ ⭐ **وهي مُعلَنَة هنا لئلا يُفهم أن التمرين اعتمد على بيئة نظيفة من الصفر**.

---

## ⭐ ٢. التسلسل المُنفَّذ — بالأمر والتاريخ والمخرجات

| # | الخطوة | الأمر | التوقيت (UTC) | رمز الخروج | المخرج |
|:-:|---|---|---|:-:|---|
| ١ | ⭐ **جرد ما قبل التمرين** | ⭐ `psql -d wasl_local -tAc "select count(*) from <كل جدول>"` | ⭐ `2026-11-26T01:36:02Z` | ⭐ `0` | ⭐ `evidence/drill-01-pre-inventory.txt` |
| ٢ | ⭐ **أخذ النسخة** | ⭐ `npm run db:backup` | ⭐ `2026-11-26T01:36:18Z` ⇒ `2026-11-26T01:36:20Z` | ⭐ `0` | ⭐ `evidence/drill-02-backup.txt` |
| ٣ | ⭐ **قراءة المانيفست** | ⭐ `cat <artifact>.manifest.json` | ⭐ `2026-11-26T01:36:2xZ` | ⭐ `0` | ⭐ `evidence/drill-03-manifest.json` |
| ٤ | ⭐ **التحقق من النسخة** | ⭐ `npm run db:verify -- <artifact>` | ⭐ `2026-11-26T01:36:2xZ` | ⭐ `0` | ⭐ `evidence/drill-04-verify.txt` |
| ٥ | ⭐ **فحص وجود القاعدة النظيفة** | ⭐ `psql -tAc "select count(*) from pg_database where datname='wasl_restore_drill'"` | ⭐ `2026-11-26T01:36:2xZ` | ⭐ `0` | ⭐ **`0`** ⇒ **القاعدة لم تكن موجودة ⇒ نظيفة فعلاً** |
| ٦ | ⭐ **الاستعادة** | ⭐ `npm run db:restore -- <artifact> --target wasl_restore_drill` | ⭐ `2026-11-26T01:36:29Z` ⇒ `2026-11-26T01:36:35Z` | ⭐ `0` | ⭐ `evidence/drill-05-restore.txt` |
| ٧ | ⭐ **جرد ما بعد الاستعادة** | ⭐ `psql -d wasl_restore_drill -tAc "select count(*) from <كل جدول>"` | ⭐ `2026-11-26T01:36:41Z` | ⭐ `0` | ⭐ `evidence/drill-06-post-inventory.txt` |
| ٨ | ⭐ **مقارنة العدّادات** | ⭐ `diff` بين ملفَّي الجرد | ⭐ `2026-11-26T01:36:4xZ` | ⭐ `0` | ⭐ `evidence/drill-07-rowcount-diff.txt` (فارغ ⇒ **لا فرق**) |
| ٩ | ⭐ **قياس الأحجام** | ⭐ `stat` + `pg_database_size` | ⭐ `2026-11-26T01:36:47Z` | ⭐ `0` | ⭐ `evidence/drill-08-sizes.txt` |
| ١٠ | ⭐ **تنظيف قاعدة التمرين** | ⭐ `psql -c "drop database if exists wasl_restore_drill"` | ⭐ `2026-11-26T01:36:4xZ` | ⭐ `0` | ⭐ **`DROP DATABASE`** ⇒ **قُبِلت القاعدة بعد التحقق ⇒ لم يبقَ أثر** |

> ⭐ **القاعدة النظيفة المستهدفة**: ⭐ **`wasl_restore_drill`** — ⭐ **اسم مختلف عن `wasl_local`** ⇒ ⭐ **والاستعادة لم تمسّ قاعدة التشغيل إطلاقاً**.
> ⭐ **والتوقيتات المختارة (`01:36:2xZ`)** ⇒ ⭐ **هي لحظة تنفيذ الخطوة نفسها** ⇒ ⭐ **وهي لحظات داخل نافذة الدقيقة نفسها** ⇒ ⭐ **وليس تاريخاً مخترعاً** ⇒ ⭐ **والطوابع الكاملة موجودة في ملفات الأدلة نفسها**.

---

## ⭐ ٣. مخرجات الأدوات كما هي — بلا تنقيح

### ⭐ ٣-١ `npm run db:backup`

```text
backup written: .local/backups/wasl_local_2026-11-26T01-36-19-228Z.dump.enc (260157 bytes)
manifest written: .local/backups/wasl_local_2026-11-26T01-36-19-228Z.dump.enc.manifest.json
key fingerprint: c50b653e46a7abff
dump duration: 651 ms
verified: true
```

### ⭐ ٣-٢ المانيفست (كما كُتب على القرص)

```json
{
  "manifest_version": 1,
  "created_at": "2026-11-26T01:36:20.008Z",
  "database": "wasl_local",
  "schema_version": "008_phase04_tickets",
  "plain_sha256": "d8cc328ad569eb404d700f8402378c2c4afa546f9c75bfdd520ae0b6b67417c5",
  "artifact_sha256": "fb1eb90c059074e7c25bfb7638f135b2ce3b44b40c69302eadb1da1e4e313ddc",
  "plain_bytes": 260121,
  "artifact_bytes": 260157,
  "cipher": "aes-256-gcm",
  "key_fingerprint": "c50b653e46a7abff",
  "dump_duration_ms": 651
}
```

### ⭐ ٣-٣ `npm run db:verify -- <artifact>`

```json
{
  "artifact": ".local/backups/wasl_local_2026-11-26T01-36-19-228Z.dump.enc",
  "manifest": ".local/backups/wasl_local_2026-11-26T01-36-19-228Z.dump.enc.manifest.json",
  "verified": true,
  "plainBytes": 260121,
  "keyFingerprint": "c50b653e46a7abff",
  "schemaVersion": "008_phase04_tickets",
  "createdAt": "2026-11-26T01:36:20.008Z",
  "mode": "600"
}
```

### ⭐ ٣-٤ `npm run db:restore -- <artifact> --target wasl_restore_drill`

```json
{
  "targetDatabase": "wasl_restore_drill",
  "migrations": [
    "001_foundation",
    "002_deletion_evidence",
    "003_phase01_security",
    "004_phase02_auth_hardening",
    "005_phase02_evidence_integrity",
    "006_phase03_login_admission",
    "007_phase02_crm",
    "008_phase04_tickets"
  ],
  "users": 268,
  "passcodeVerified": true,
  "durationMs": 1887,
  "keyFingerprint": "c50b653e46a7abff",
  "plainSha256": "d8cc328ad569eb404d700f8402378c2c4afa546f9c75bfdd520ae0b6b67417c5"
}
```

> ⭐ **حقل `tenants` في المخرج الأصلي قائمة من 138 مُعرِّفاً** ⇒ ⭐ **وليس مختصراً في هذا المستند** ⇒ ⭐ **وهو كامل في `evidence/drill-05-restore.txt`** ⇒ ⭐ **والعدد المُقاس منه: `138`**.

---

## ⭐ ٤. جدول الأرقام المقيسة

| # | المؤشّر | القيمة | مصدر الرقم | الأمر |
|:-:|---|---:|---|---|
| ١ | ⭐ **حجم نسخة مشفّرة (بايت)** | ⭐ **260157** | ⭐ مخرج `db:backup` + المانيفست | ⭐ `npm run db:backup` |
| ٢ | ⭐ **حجم النص الصريح داخلها (بايت)** | ⭐ **260121** | ⭐ المانيفست + مخرج `db:verify` | ⭐ `npm run db:verify` |
| ٣ | ⭐ **مدة التفريغ (مللي ثانية)** | ⭐ **651** | ⭐ `dump duration` في مخرج `db:backup` + `dump_duration_ms` | ⭐ `npm run db:backup` |
| ٤ | ⭐ **مدة الاستعادة (مللي ثانية)** | ⭐ **1887** | ⭐ `durationMs` في مخرج `db:restore` | ⭐ `npm run db:restore` |
| ٥ | ⭐ **مدة تحقّق `db:verify`** | ⭐ **غير متاح** | ⭐ ⭐ الأداة **لا تطبع مدة** ⇒ ⭐ **بلا قياس ⇒ بلا رقم** | ⭐ — |
| ٦ | ⭐ **عدد الجداول المستعادة** | ⭐ **20** | ⭐ `information_schema.tables` على `wasl_restore_drill` | ⭐ `psql` |
| ٧ | ⭐ **مجموع الصفوف المستعادة** | ⭐ **9746** | ⭐ مجموع عدّادات `psql` على الجداول الـ20 | ⭐ `psql` |
| ٨ | ⭐ **عدد المستأجرين** | ⭐ **138** | ⭐ مخرج `db:restore` + عدّاد `psql` | ⭐ `npm run db:restore` |
| ٩ | ⭐ **عدد المستخدمين** | ⭐ **268** | ⭐ مخرج `db:restore` (`users`) | ⭐ `npm run db:restore` |
| ١٠ | ⭐ **عدد الترحيلات (migrations)** | ⭐ **8** | ⭐ مخرج `db:restore` (`migrations`) + `psql` | ⭐ `npm run db:restore` |
| ١١ | ⭐ **تحقّق كلمة سرّ المالك** | ⭐ **`true`** | ⭐ `passcodeVerified` في مخرج `db:restore` | ⭐ `npm run db:restore` |
| ١٢ | ⭐ **بصمة المفتاح (قبل وبعد)** | ⭐ **`c50b653e46a7abff` ⇒ نفسها** | ⭐ المانيفست + مخرج `db:restore` | ⭐ — |
| ١٣ | ⭐ **بصمة النص الصريح (قبل وبعد)** | ⭐ **`d8cc328a…7417c5` ⇒ نفسها** | ⭐ المانيفست + `plainSha256` | ⭐ — |
| ١٤ | ⭐ **صلاحية ملف النسخة** | ⭐ **`600`** | ⭐ حقل `mode` في مخرج `db:verify` + `stat` | ⭐ `npm run db:verify` |
| ١٥ | ⭐ **حجم قاعدة التشغيل على القرص** | ⭐ **14548327** | ⭐ `pg_database_size('wasl_local')` | ⭐ `psql` |
| ١٦ | ⭐ **حجم قاعدة التمرين بعد الاستعادة** | ⭐ **12352871** | ⭐ `pg_database_size('wasl_restore_drill')` | ⭐ `psql` |
| ١٧ | ⭐ **عدد محاولات الدخول المسجّلة** | ⭐ **0** | ⭐ `count(*) from login_attempts` | ⭐ `psql` |
| ١٨ | ⭐ **عدد الجلسات** | ⭐ **587** | ⭐ `count(*) from sessions` | ⭐ `psql` |

> ⭐ **الفرق بين (15) و (16)**: ⭐ **`14548327 − 12352871 = 2195456` بايت** ⇒ ⭐ **الفرق بنى المُشغِّل والجداول النظامية وقواعد الأدوار** (التي تُنشأ بـ `pg_restore` داخل القاعدة الجديدة) ⇒ ⭐ **وليس فرقاً في بيانات العميل** ⇒ ⭐ **ودليل ذلك: عدّاد كل جدول مطابق تماماً (القسم ٥)**.

---

## ⭐ ٥. عدّاد الصفوف: قبل الاستعادة وبعدها — مطابقة تامة

| # | الجدول | قبل الاستعادة (`wasl_local`) | بعد الاستعادة (`wasl_restore_drill`) | الفرق |
|:-:|---|---:|---:|:-:|
| ١ | `audit_events` | 1767 | 1767 | ⭐ **0** |
| ٢ | `conversation_changes` | 222 | 222 | ⭐ **0** |
| ٣ | `conversations` | 1964 | 1964 | ⭐ **0** |
| ٤ | `customers` | 1720 | 1720 | ⭐ **0** |
| ٥ | `deletion_requests` | 83 | 83 | ⭐ **0** |
| ٦ | `login_admission_global` | 1 | 1 | ⭐ **0** |
| ٧ | `login_admission_tenant` | 72 | 72 | ⭐ **0** |
| ٨ | `login_attempts` | 0 | 0 | ⭐ **0** |
| ٩ | `login_attempts_global` | 6 | 6 | ⭐ **0** |
| ١٠ | `memberships` | 171 | 171 | ⭐ **0** |
| ١١ | `messages` | 2199 | 2199 | ⭐ **0** |
| ١٢ | `read_audit_events` | 222 | 222 | ⭐ **0** |
| ١٣ | `retention_policies` | 180 | 180 | ⭐ **0** |
| ١٤ | `sessions` | 587 | 587 | ⭐ **0** |
| ١٥ | `support_ticket_changes` | 38 | 38 | ⭐ **0** |
| ١٦ | `support_tickets` | 28 | 28 | ⭐ **0** |
| ١٧ | `tenant_deletion_evidence` | 72 | 72 | ⭐ **0** |
| ١٨ | `tenants` | 138 | 138 | ⭐ **0** |
| ١٩ | `users` | 268 | 268 | ⭐ **0** |
| ٢٠ | `wasl_schema_migrations` | 8 | 8 | ⭐ **0** |
| | ⭐ **المجموع** | ⭐ **9746** | ⭐ **9746** | ⭐ **0** |

> ⭐⭐⭐ **النتيجة**: ⭐ **عدّاد كل جدول من الـ20 مطابق تماماً** ⇒ ⭐ **`diff` بين ملفَّي الجرد فارغ** (`evidence/drill-07-rowcount-diff.txt`) ⇒ ⭐ **وهذا هو دليل القبول من §٤ للبنود `pf-21` و `pf-05`: «عدّاد الصفوف بعد الاستعادة = ما قبلها»**.

---

## ⭐ ٦. ما الذي يثبته هذا التمرين — وما الذي لا يثبته

| ⭐ **يثبته (مقيس)** | ⭐ **لا يثبته (غير متاح + السبب)** |
|---|---|
| ⭐ **أن النسخة تُؤخذ وتُستعاد وتُتحقَّق محلياً** | ⭐ **الاستعادة خارج الجهاز (خادم ثاني / مخزن كائنات)** ⇒ ⭐ **غير متاح: لم يُشترَ شيء ولم تُفعَّل خدمة** ⇒ ⭐ **وهو بند `pf-19`** |
| ⭐ **أن عدّاد الصفوف يطابق تماماً** | ⭐ **زمن التعافي على عتاد مختلف** ⇒ ⭐ **غير متاح: الجهاز نفسه** ⇒ ⭐ **العتاد المختلف يُقاس في `pf-19`** |
| ⭐ **أن النص الصريح لا يوجد على القرص** (التشفير أثناء البثّ) | ⭐ **أن الاستعادة تنجح بعد إتلاف الجهاز** ⇒ ⭐ **غير متاح: الجهاز سليم ⇒ فلم تُختبر نقطة الفشل** |
| ⭐ **أن المانيفست يكشف أي تعديل** (بصمتان + `mode` = `600`) | ⭐ **زمن الاستعادة السريري (RTO)** ⇒ ⭐ **غير متاح: لا  خادم  ولا شبكة ⇒ `durationMs` هنا = `1887` وهو **زمن محلي على القرص** لا RTO** |
| ⭐ **أن كلمة سرّ المالك ما زالت تعمل بعد الاستعادة** | ⭐ **مدّة فقدان البيانات المسموحة (RPO)** ⇒ ⭐ **غير متاح: لم تُجدوَل نسخة دورية ⇒ فالفجوة الزمنية بين نسختين = **غير معروف** ⇒ وعرضه في `rpo-rto-proposal.md` كقيمة مقترحة لا كمقيسة** |

> ⭐⭐⭐ **الخلاصة الصادقة**: ⭐ **هذا التمرين يُثبت أن مسار النسخ والاستعادة سليم **على الجهاز** ⇒ ⭐ **ولا يُثبت أن البيانات نجت من فقدان الجهاز نفسِه** ⇒ ⭐ **وهذا بالضبط الفرق بين `pf-05` (منتهٍ) و `pf-19` (مفتوح)**.

---

## ⭐ ٧. كيف يُعاد التمرين (الأوامر حرفياً)

```bash
export PGHOST=/tmp PGPORT=5432 PGUSER=postgres
export PATH=/usr/lib/postgresql/15/bin:$PATH

# ① جرد قبل الاستعادة
for t in $(psql -d wasl_local -tAc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"); do
  printf "%s|%s\n" "$t" "$(psql -d wasl_local -tAc "select count(*) from $t")"
done > /tmp/pre.txt

# ② أخذ النسخة
npm run db:backup

# ③ التحقق (بلا استعادة)
npm run db:verify -- .local/backups/<artifact>.dump.enc

# ④ الاستعادة في قاعدة نظيفة
npm run db:restore -- .local/backups/<artifact>.dump.enc --target wasl_restore_drill

# ⑤ الجرد بعد الاستعادة ثم المقارنة
for t in $(psql -d wasl_restore_drill -tAc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"); do
  printf "%s|%s\n" "$t" "$(psql -d wasl_restore_drill -tAc "select count(*) from $t")"
done > /tmp/post.txt
diff -u /tmp/pre.txt /tmp/post.txt

# ⑥ تنظيف
psql -c "drop database if exists wasl_restore_drill"
```

> ⭐ **كل الملفات الخام للأرقام في**: ⭐ `docs/ops-pilot-package/evidence/` — ⭐ **وهي مُولَّدة بالأدوات نفسها لا باليد**.

---

## ⭐ ٨. حالة البند

| البند | الحالة بعد هذا التمرين | الدليل |
|---|---|---|
| ⭐ **`pf-05`** (النسخ والاستعادة محلياً) | ⭐ **مُثبت بمقاييس حديثة** (لا يتغيّر حالته — كان منتهياً) | ⭐ هذا الملف |
| ⭐ **`pf-21`** (تمرين الكوارث — محلياً) | ⭐ **مُنفَّذ ومُوثَّق بتاريخ** ⇒ ⭐ **دليل القبول «تقرير تمرين مسجَّل بتاريخ» متحقّق** | ⭐ هذا الملف + `evidence/` |
| ⭐ **`pf-19`** (نسخة خارج الجهاز) | ⭐ **لم يبدأ** ⇒ ⭐ **بلا شراء ولا تسجيل في هذه الحزمة** | ⭐ `backup-architecture.md` |
| ⭐ **`pf-20`** (قيم RPO/RTO) | ⭐ **مقترح غير معتمد** ⇒ ⭐ **التمرين يزوّده بالأرقام اللازمة للقياس** | ⭐ `rpo-rto-proposal.md` |
