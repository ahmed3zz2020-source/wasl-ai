// ============================================================
// WASL AI — أداة لقطة مركز العمل (Slice 06 · P0)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-workbench-snapshot.ts`
// ⭐ **مخرَجان**:
//   ① `docs/wasl-workbench-snapshot.json` — ⭐ لقطة JSON **حتمية** (توقيت مثبَّت).
//   ② `docs/wasl-workbench-preview.html` — ⭐ صفحة معاينة واحدة (JSON **مضمَّن** داخلها).
// ⭐ **لماذا JSON مضمَّن لا ملف خارجي**: ⭐ الصفحة تُفتح بـ`file://` ⇒ ⭐ و`fetch`
//   على `file://` **محجوب** في المتصفّحات ⇒ ⇒ ⇒ فلو كان JSON ملفاً خارجياً ⇒
//   **الصفحة لا تعمل** ⇒ ⇒⇒ ⇒⇒ **لذلك: JSON داخل الصفحة** ⇒ ⇒ (ودون شبكة إطلاقاً).
// ⭐ **كل البيانات اصطناعية بالكامل** — ⭐ لا حساب · ⭐ لا شبكة · ⭐ لا نشر.
// ⛔ لا يستورد من شجرة الاختبار (⇒ الملف مستقل تماماً).
// ⛔ القراءة فقط: ⭐ لا تُنشأ حالة ولا يُسند ولا يُعدَّل سجل تغييرات.
// ⭐ **بلا نصوص الرسائل** — ⭐ المخرجات: معرّفات + أرقام + توقيتات فقط.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AuditLog,
  ConversationChangeLog,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  getServiceMetrics,
  listWorkQueue,
  resolveTenantContext,
  updateConversationState,
  type ConversationStateDependencies,
  type MessageEnvelope,
  type SessionSource,
  type TenantContext,
  type TrustedRole,
  type VerifiedIdentity,
} from '../src/core/index.ts';
// ⭐ تسجيل المصدر داخليّ من `src/core/session.ts` ⇒ ⭐ لأنّ registerSessionSource ليس في السطح العام.
import { registerSessionSource } from '../src/core/session.ts';

// ============================================================
// ⭐ مصادر الجلسات المحلية — ⭐ **مصدر لكل دور** (سلطة المالك على المنح).
// ⭐ كل مصدر يتحقّق من **دوره فقط** ⇒ ⇒ ولا تحوّل بين الأدوار.
// ============================================================

const ROLES = new WeakMap<object, TrustedRole>();

function buildSource(role: TrustedRole): SessionSource {
  return {
    id: `wasl-preview-${role}`,
    scope: 'test',
    description: 'مصدر محلي لمعاينة مركز العمل — بيانات اصطناعية بالكامل',
    verify(input: unknown): VerifiedIdentity | null {
      if (!input || typeof input !== 'object') return null;
      if (ROLES.get(input as object) !== role) return null;
      const claims = input as {
        session_id: string;
        tenant_id: string;
        actor_id: string;
        conversation_ref: string;
        authenticated: boolean;
      };
      if (claims.authenticated !== true) return null;
      // ⭐ كائن هوية جديد ⇒ ⭐ بلا تمرير لحمولة العميل.
      return {
        session_id: claims.session_id,
        tenant_id: claims.tenant_id,
        actor_id: claims.actor_id,
        conversation_ref: claims.conversation_ref,
        authenticated: true,
      };
    },
  };
}

const CEILINGS: Readonly<Record<TrustedRole, readonly string[]>> = Object.freeze({
  owner: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.assign',
    'conversation.queue.read',
    'conversation.metrics.read',
  ]),
  supervisor: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.queue.read',
    'conversation.metrics.read',
  ]),
  agent: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.queue.read',
  ]),
  viewer: Object.freeze(['conversation.list', 'conversation.read', 'conversation.audit']),
  none: Object.freeze([]),
});

const sources = {
  owner: buildSource('owner'),
  supervisor: buildSource('supervisor'),
  agent: buildSource('agent'),
} as const;

for (const role of ['owner', 'supervisor', 'agent'] as const) {
  registerSessionSource({
    source: sources[role],
    grantedRole: role,
    grantCeiling: CEILINGS[role],
  });
}

function previewContext(
  role: TrustedRole,
  tenantId: string,
  actorId: string,
  conversationRef: string,
): TenantContext {
  const claims = {
    session_id: 'sess_preview_0001',
    tenant_id: tenantId,
    actor_id: actorId,
    conversation_ref: conversationRef,
    authenticated: true,
  };
  ROLES.set(claims, role);
  return resolveTenantContext(claims, { source: sources[role as keyof typeof sources] });
}

function previewEnvelope(options: {
  messageRef: string;
  conversationRef: string;
  occurredAt: string;
  direction?: 'inbound' | 'outbound';
  body: string;
}): MessageEnvelope {
  return {
    schema_version: '1',
    message_ref: options.messageRef,
    channel: 'preview',
    direction: options.direction ?? 'inbound',
    from: 'participant-preview-0001@example.invalid',
    to: 'participant-preview-0101@example.invalid',
    body: options.body,
    occurred_at: options.occurredAt,
    locale: 'ar-EG',
    attributes: { synthetic: 'true' },
    conversation_ref: options.conversationRef,
  };
}

// ============================================================
// ⭐ التوقيتات — ⭐ **مثبَّتة** ⇒ ⇒ نفس المدخلات ⇒ نفس البايت (حتمية).
// ============================================================

export const PREVIEW_NOW = '2026-01-05T12:00:00.000Z';
export const PREVIEW_TENANT = 'tnt_preview_0001';

const CHANGE_TIMES = [
  '2026-01-05T11:00:00.000Z',
  '2026-01-05T11:10:00.000Z',
  '2026-01-05T11:20:00.000Z',
  '2026-01-05T11:30:00.000Z',
  '2026-01-05T11:40:00.000Z',
];

/** ⭐ نص رسالة اصطناعي — ⭐ **لا يدخل اللقطة أبداً** (فحص منع التسريب). */
export const SYNTHETIC_BODIES = [
  'مساء الخير — محتاج مساعدة في الفاتورة.',
  'تمام — هبعتلك البيانات دلوقتي.',
  'وصلت البيانات — سنراجعها.',
  'استفسار سريع لو سمحت.',
  'رسالة مستأجر ثانٍ — لا تظهر للمستأجر الأول.',
] as const;

// ============================================================
// ⭐ بناء اللقطة
// ============================================================

export interface PreviewSnapshot {
  readonly schema_version: '1';
  readonly synthetic: true;
  readonly product: string;
  readonly generated_at: string;
  readonly notice: string;
  readonly idle_threshold_minutes: number;
  readonly agent_queue: PreviewQueue;
  readonly supervisor_queue: PreviewQueue;
  readonly metrics: PreviewMetrics;
  readonly isolation: {
    readonly tenant_id: string;
    readonly other_tenant_ref: string;
    readonly first_tenant_total: number;
    readonly other_tenant_own_total: number;
    readonly leaked_total: number;
    readonly note: string;
  };
  readonly decisions: readonly { readonly title: string; readonly detail: string }[];
  readonly guardrails: readonly string[];
}

interface PreviewQueue {
  readonly title: string;
  readonly scope_note: string;
  readonly items: readonly {
    readonly conversation_ref: string;
    readonly state: string;
    readonly assignee_actor_id: string | null;
    readonly category: string;
    readonly message_count: number;
    readonly first_occurred_at: string;
    readonly last_activity_at: string;
    readonly idle_minutes: number;
    readonly is_idle_over_threshold: boolean;
  }[];
  readonly pagination: {
    readonly returned: number;
    readonly total: number;
    readonly idle_threshold_minutes: number;
  };
}

interface PreviewMetrics {
  readonly conversations_total: number;
  readonly by_state: Readonly<Record<string, number>>;
  readonly unassigned_total: number;
  readonly idle_over_threshold_total: number;
  readonly first_response_minutes: number | null;
  readonly resolution_minutes: number | null;
  readonly load_per_employee: readonly { readonly actor_id: string; readonly open_count: number }[];
  readonly note: string;
}

/** ⭐ يبني المشهد الاصطناعي ثم يقرأ الطابور والمؤشرات **من النواة الحقيقية**. */
export function buildSnapshot(): PreviewSnapshot {
  const audit = new AuditLog({ now: () => PREVIEW_NOW });
  const readAudit = new ReadAuditLog({ now: () => PREVIEW_NOW });
  const store = new MessageStore({ now: () => PREVIEW_NOW, audit });
  const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
  const states = new ConversationStateStore({ now: () => PREVIEW_NOW });
  let changeClock = 0;
  const changes = new ConversationChangeLog({
    now: () => CHANGE_TIMES[Math.min(changeClock++, CHANGE_TIMES.length - 1)],
  });
  const deps: ConversationStateDependencies = {
    store,
    states,
    changes,
    readAudit,
    employees: {
      isEmployee(tenantId: string, actorId: string): boolean {
        const roster: Record<string, readonly string[]> = {
          tnt_preview_0001: ['actor_preview_0007', 'actor_preview_0008'],
          tnt_preview_0002: ['actor_preview_0009'],
        };
        return (roster[tenantId] ?? []).includes(actorId);
      },
    },
  };

  const ownerCtx = previewContext('owner', PREVIEW_TENANT, 'actor_preview_0001', 'conv_preview_0001');
  const ownerCtx2 = previewContext('owner', PREVIEW_TENANT, 'actor_preview_0001', 'conv_preview_0002');
  const ownerCtx3 = previewContext('owner', PREVIEW_TENANT, 'actor_preview_0001', 'conv_preview_0003');
  const supervisorCtx = previewContext(
    'supervisor',
    PREVIEW_TENANT,
    'actor_preview_0002',
    'conv_preview_0001',
  );
  const agentCtx = previewContext(
    'agent',
    PREVIEW_TENANT,
    'actor_preview_0007',
    'conv_preview_0001',
  );
  const otherTenantCtx = previewContext(
    'owner',
    'tnt_preview_0002',
    'actor_preview_0002',
    'conv_preview_0009',
  );

  // ⭐ محادثة ١: وارد فقط ⇒ **بلا أول رد** ⇒ ⇒ المؤشر لا يخترع قيمة.
  layer.process(
    ownerCtx,
    previewEnvelope({
      messageRef: 'preview-msg-000001',
      conversationRef: 'conv_preview_0001',
      occurredAt: '2026-01-05T08:00:00.000Z',
      body: SYNTHETIC_BODIES[0],
    }),
  );
  // ⭐ محادثة ٢: وارد ٠٩:٠٠ + صادر ٠٩:٣٠ ⇒ أول رد = ٣٠ دقيقة.
  layer.process(
    ownerCtx2,
    previewEnvelope({
      messageRef: 'preview-msg-000002',
      conversationRef: 'conv_preview_0002',
      occurredAt: '2026-01-05T09:00:00.000Z',
      body: SYNTHETIC_BODIES[1],
    }),
  );
  layer.process(
    ownerCtx2,
    previewEnvelope({
      messageRef: 'preview-msg-000003',
      conversationRef: 'conv_preview_0002',
      direction: 'outbound',
      occurredAt: '2026-01-05T09:30:00.000Z',
      body: SYNTHETIC_BODIES[2],
    }),
  );
  // ⭐ محادثة ٣: وارد ١١:٥٠ ⇒ خمول ٢٠ دقيقة ⇒ دون المعيار.
  layer.process(
    ownerCtx3,
    previewEnvelope({
      messageRef: 'preview-msg-000004',
      conversationRef: 'conv_preview_0003',
      occurredAt: '2026-01-05T11:50:00.000Z',
      body: SYNTHETIC_BODIES[3],
    }),
  );
  // ⭐ مستأجر ثانٍ — ⭐ لإثبات العزل.
  layer.process(
    otherTenantCtx,
    previewEnvelope({
      messageRef: 'preview-msg-000005',
      conversationRef: 'conv_preview_0009',
      occurredAt: '2026-01-05T10:00:00.000Z',
      body: SYNTHETIC_BODIES[4],
    }),
  );

  // ⭐ الإسناد: محادثة ١ ← الوكيل · محادثة ٢ ← موظف آخر · ٣ بلا إسناد.
  updateConversationState(ownerCtx, 'conv_preview_0001', 'open', deps, { reason: 'فتح الطلب' });
  assignConversation(ownerCtx, 'conv_preview_0001', 'actor_preview_0007', deps, {
    reason: 'توزيع على خدمة العملاء',
  });
  updateConversationState(ownerCtx2, 'conv_preview_0002', 'open', deps, { reason: 'فتح الطلب' });
  assignConversation(ownerCtx2, 'conv_preview_0002', 'actor_preview_0008', deps, {
    reason: 'توزيع على موظف آخر',
  });
  updateConversationState(ownerCtx3, 'conv_preview_0003', 'open', deps, { reason: 'فتح الطلب' });

  const agentQueue = listWorkQueue(agentCtx, deps, { now: PREVIEW_NOW });
  const supervisorQueue = listWorkQueue(supervisorCtx, deps, { now: PREVIEW_NOW });
  const metrics = getServiceMetrics(supervisorCtx, deps, { now: PREVIEW_NOW });
  const otherQueue = listWorkQueue(otherTenantCtx, deps, { now: PREVIEW_NOW });

  return {
    schema_version: '1',
    synthetic: true,
    product: 'WASL AI',
    generated_at: PREVIEW_NOW,
    notice:
      'معاينة صناعية بالكامل — بيانات اصطناعية بالكامل — لا حساب ولا خادم ولا شبكة خلف هذه الصفحة',
    idle_threshold_minutes: supervisorQueue.pagination.idle_threshold_minutes,
    agent_queue: {
      title: 'طابور الوكيل — «محادثاته فقط»',
      scope_note:
        'نطاق الموظف = محادثاته المسنَدة إليه فقط (قرار المالك · D-058) — صلاحية «conversation.queue.read»',
      items: agentQueue.items.map((item) => ({
        conversation_ref: item.conversation_ref,
        state: item.state,
        assignee_actor_id: item.assignee_actor_id,
        category: item.category,
        message_count: item.message_count,
        first_occurred_at: item.first_occurred_at,
        last_activity_at: item.last_activity_at,
        idle_minutes: item.idle_minutes,
        is_idle_over_threshold: item.is_idle_over_threshold,
      })),
      pagination: {
        returned: agentQueue.pagination.returned,
        total: agentQueue.pagination.total,
        idle_threshold_minutes: agentQueue.pagination.idle_threshold_minutes,
      },
    },
    supervisor_queue: {
      title: 'طابور المشرف — «كل موظفي المستأجر نفسه»',
      scope_note:
        'نطاق المشرف = كل موظفي ومحادثات المستأجر نفسه (قرار C2(أ)) — ولا فرق فرعية (لا كيان «فريق» في النموذج)',
      items: supervisorQueue.items.map((item) => ({
        conversation_ref: item.conversation_ref,
        state: item.state,
        assignee_actor_id: item.assignee_actor_id,
        category: item.category,
        message_count: item.message_count,
        first_occurred_at: item.first_occurred_at,
        last_activity_at: item.last_activity_at,
        idle_minutes: item.idle_minutes,
        is_idle_over_threshold: item.is_idle_over_threshold,
      })),
      pagination: {
        returned: supervisorQueue.pagination.returned,
        total: supervisorQueue.pagination.total,
        idle_threshold_minutes: supervisorQueue.pagination.idle_threshold_minutes,
      },
    },
    metrics: {
      conversations_total: metrics.conversations_total,
      by_state: metrics.by_state,
      unassigned_total: metrics.unassigned_total,
      idle_over_threshold_total: metrics.idle_over_threshold_total,
      // ⭐ القيم غير المحسوبة ⇒ `null` **صراحةً** ⇒ ⇒ (لا صفر بديل · ولا مفتاح غائب).
      first_response_minutes: metrics.first_response_minutes ?? null,
      resolution_minutes: metrics.resolution_minutes ?? null,
      load_per_employee: metrics.load_per_employee.map((row) => ({
        actor_id: row.actor_id,
        open_count: row.open_count,
      })),
      note:
        '«الخمول منذ آخر نشاط» = الآن − آخر نشاط — وليس زمن انتظار العميل، ولا يُستعمل لتقييم سرعة الرد أو الموظف',
    },
    isolation: {
      tenant_id: 'tnt_preview_0002',
      other_tenant_ref: 'conv_preview_0009',
      first_tenant_total: supervisorQueue.pagination.total,
      other_tenant_own_total: otherQueue.pagination.total,
      // ⭐⭐ **إثبات العزل بالأرقام**: ⭐ كم محادثة من المستأجر الثاني ظهرت
      //   في طابور المستأجر الأول؟ ⇒ ⇒ **الجواب يجب أن يكون صفراً**.
      leaked_total:
        supervisorQueue.items.filter((item) => item.conversation_ref === 'conv_preview_0009')
          .length +
        agentQueue.items.filter((item) => item.conversation_ref === 'conv_preview_0009').length,
      note:
        'محادثة المستأجر الثاني (conv_preview_0009) لا تظهر في أي طابور أو مؤشر للمستأجر الأول — والعزل مُثبَت بالأرقام لا بالادّعاء',
    },
    decisions: [
      {
        title: 'زمن أول الرد (C1)',
        detail:
          'يُحتسب من أول وارد إلى أول صادرة بعده — الصادرة الأسبق تُتجاهل — ولا قيمة بلا ردّ صحيح',
      },
      {
        title: 'نطاق المشرف (C2(أ))',
        detail: 'كل موظفي ومحادثات المستأجر نفسه — قرار نطاق، وليس تصريحاً بالوصول إلى مستأجر آخر',
      },
      {
        title: 'تسمية الخمول (C3)',
        detail: '«الخمول منذ آخر نشاط» بدل «التأخير» — لأن المؤشر خمول لا انتظار عميل',
      },
      {
        title: 'حدود الذرّية (C4)',
        detail: 'الضمان محلي: تشغيل متسلسل بلا await + تخزين في الذاكرة + تراجع مُعوَّض لا معاملة إنتاجية',
      },
    ],
    guardrails: [
      'قراءة فقط: لا أزرار كتابة ولا حالة تُعدَّل ولا سجل تغييرات يُكتب',
      'بلا نص رسائل: المخرجات معرّفات وأرقام وتوقيتات فقط',
      'بلا شبكة: لا fetch ولا CDN ولا خط خارجي — الصفحة تعمل من file://',
      'بلا حساب ولا خادم ولا قاعدة بيانات: كل شيء داخل الملف',
      'بيانات اصطناعية بالكامل: المستأجرون والمحادثات والأرقام مُصطنعة',
      'بلا ترقية جاهزية: هذه معاينة عرض، لا إصدار منشور',
    ],
  };
}

/** ⭐ JSON **حتمي** — ⭐ نفس المدخلات ⇒ نفس البايت. */
export function serializeSnapshot(snapshot: PreviewSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

// ============================================================
// ⭐ صفحة المعاينة — ⭐ ملف واحد مستقل (RTL · بلا build · بلا CDN · بلا شبكة).
// ⭐ **JSON مضمَّن** داخل الصفحة ⇒ ⇒ فلا `fetch` ولا ملف خارجي.
// ============================================================

export function renderPreviewHtml(snapshot: PreviewSnapshot): string {
  const json = serializeSnapshot(snapshot);
  // ⭐ حماية HTML: ⭐ نصوص المصفوفة داخل `<script type="application/json">` ⇒
  // ⇒ ⇒ نمنع أي `</script>` داخل البيانات ⇒ ⇒ (سلامة JSON مضمونة).
  const safeJson = json.replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>WASL AI — معاينة مركز العمل (اصطناعية)</title>
<style>
  :root {
    --bg: #0e1117;
    --panel: #161b22;
    --line: #2a323d;
    --ink: #e6edf3;
    --muted: #9aa7b4;
    --accent: #4c8dff;
    --warn: #f0a132;
    --ok: #3fb950;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 16px; }
  header.banner {
    background: var(--warn);
    color: #241a05;
    font-weight: 700;
    padding: 10px 16px;
    text-align: center;
  }
  h1 { font-size: 1.35rem; margin: 20px 0 4px; }
  h2 { font-size: 1.05rem; margin: 0 0 6px; }
  .sub { color: var(--muted); font-size: .86rem; margin: 0 0 16px; }
  section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th, td { text-align: right; padding: 7px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: .8rem; }
  td.num { font-variant-numeric: tabular-nums; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; }
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .scroll > table { min-width: 640px; }
  .card {
    background: #10151c;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    min-width: 150px;
    flex: 1 1 150px;
  }
  .card .k { color: var(--muted); font-size: .76rem; }
  .card .v { font-size: 1.3rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .flag { color: var(--warn); font-weight: 700; }
  .none { color: var(--muted); font-style: italic; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  ul { margin: 6px 0 0; padding-inline-start: 20px; }
  li { margin-bottom: 4px; font-size: .87rem; }
  .dec { margin-bottom: 10px; }
  .dec b { color: var(--accent); }
  footer { color: var(--muted); font-size: .78rem; text-align: center; padding: 8px 0 24px; }
  @media (max-width: 640px) {
    .card { min-width: 130px; }
    th, td { padding: 6px 4px; font-size: .8rem; }
  }
</style>
</head>
<body>
<header class="banner">⚠ معاينة اصطناعية بالكامل — بيانات مُصطنعة — لا حساب ولا خادم ولا شبكة</header>
<div class="wrap">
  <h1>WASL AI — معاينة مركز عمل الوكيل ومؤشرات الخدمة</h1>
  <p class="sub" id="meta"></p>

  <section id="queue-agent">
    <h2>طابور الوكيل</h2>
    <p class="sub" id="queue-agent-note"></p>
    <div id="queue-agent-body"></div>
  </section>

  <section id="queue-supervisor">
    <h2>طابور المشرف</h2>
    <p class="sub" id="queue-supervisor-note"></p>
    <div id="queue-supervisor-body"></div>
  </section>

  <section id="metrics">
    <h2>مؤشرات الخدمة</h2>
    <p class="sub" id="metrics-note"></p>
    <div id="metrics-body"></div>
  </section>

  <section id="isolation">
    <h2>إثبات العزل بين المستأجرين</h2>
    <div id="isolation-body"></div>
  </section>

  <section id="decisions">
    <h2>القرارات التي تعكسها هذه المعاينة</h2>
    <div id="decisions-body"></div>
  </section>

  <section id="guardrails">
    <h2>حدود هذه المعاينة</h2>
    <ul id="guardrails-body"></ul>
  </section>

  <footer id="footer"></footer>
</div>

<script type="application/json" id="wasl-snapshot">${safeJson}</script>
<script>
(function () {
  'use strict';
  var raw = document.getElementById('wasl-snapshot');
  if (!raw) { return; }
  var data = JSON.parse(raw.textContent || '{}');

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    if (cls) { node.className = cls; }
    return node;
  }
  function stamp(value) {
    if (!value) { return '—'; }
    return String(value).replace('T', ' ').replace('.000Z', '').replace('Z', '');
  }
  function card(key, value) {
    var box = el('div', null, 'card');
    box.appendChild(el('div', key, 'k'));
    box.appendChild(el('div', value, 'v'));
    return box;
  }
  function table(headers, rows) {
    var t = el('table');
    var thead = el('thead');
    var hrow = el('tr');
    for (var i = 0; i < headers.length; i += 1) {
      hrow.appendChild(el('th', headers[i]));
    }
    thead.appendChild(hrow);
    t.appendChild(thead);
    var tbody = el('tbody');
    for (var r = 0; r < rows.length; r += 1) {
      var row = el('tr');
      for (var c = 0; c < rows[r].length; c += 1) {
        var cell = rows[r][c];
        if (cell && cell.nodeType) { row.appendChild(cell); }
        else if (cell && typeof cell === 'object' && 'text' in cell) {
          row.appendChild(el('td', cell.text, cell.cls || 'num'));
        }
        else { row.appendChild(el('td', cell, 'num')); }
      }
      tbody.appendChild(row);
    }
    t.appendChild(tbody);
    // ⭐ حاوية تمرير أفقي ⇒ ⇒ (الجدول العريض لا يكسر تخطيط الموبايل).
    var scroll = el('div', null, 'scroll');
    scroll.appendChild(t);
    return scroll;
  }
  function renderQueue(prefix, queue) {
    document.getElementById(prefix + '-note').textContent =
      queue.scope_note + ' — معيار الخمول: ' + queue.pagination.idle_threshold_minutes + ' دقيقة';
    var host = document.getElementById(prefix + '-body');
    if (!queue.items.length) {
      host.appendChild(el('p', 'لا عناصر في هذا الطابور.', 'none'));
      return;
    }
    var rows = queue.items.map(function (item) {
      var flag = el(
        'td',
        item.is_idle_over_threshold ? 'تجاوز المعيار' : 'دون المعيار',
        item.is_idle_over_threshold ? 'flag' : '',
      );
      return [
        item.conversation_ref,
        item.category,
        item.state,
        item.assignee_actor_id === null ? 'بلا إسناد' : item.assignee_actor_id,
        String(item.message_count),
        { text: stamp(item.last_activity_at), cls: 'ltr' },
        String(item.idle_minutes),
        flag,
      ];
    });
    host.appendChild(
      table(
        ['المحادثة', 'التصنيف', 'الحالة', 'الموظف', 'الرسائل', 'آخر نشاط', 'الخمول (دقيقة)', 'المعيار'],
        rows,
      ),
    );
    host.appendChild(
      el(
        'p',
        'صفوف: ' + queue.pagination.returned + '/' + queue.pagination.total,
        'sub',
      ),
    );
  }
  function renderMetrics(metrics) {
    document.getElementById('metrics-note').textContent = metrics.note;
    var host = document.getElementById('metrics-body');
    var cards = el('div', null, 'cards');
    cards.appendChild(card('إجمالي المحادثات', metrics.conversations_total));
    cards.appendChild(card('بلا مُسندة', metrics.unassigned_total));
    cards.appendChild(card('تجاوز معيار الخمول', metrics.idle_over_threshold_total));
    cards.appendChild(
      card(
        'متوسط زمن أول رد (دقيقة)',
        metrics.first_response_minutes === null || metrics.first_response_minutes === undefined
          ? 'غير محسوب'
          : metrics.first_response_minutes,
      ),
    );
    cards.appendChild(
      card(
        'متوسط زمن الحل (دقيقة)',
        metrics.resolution_minutes === null || metrics.resolution_minutes === undefined
          ? 'غير محسوب'
          : metrics.resolution_minutes,
      ),
    );
    host.appendChild(cards);
    var stateRows = Object.keys(metrics.by_state).map(function (key) {
      return [key, String(metrics.by_state[key])];
    });
    host.appendChild(el('h2', 'عدد المحادثات لكل حالة'));
    host.appendChild(table(['الحالة', 'العدد'], stateRows));
    host.appendChild(el('h2', 'العبء لكل موظف'));
    if (!metrics.load_per_employee.length) {
      host.appendChild(el('p', 'لا عبء مسجَّل.', 'none'));
    } else {
      host.appendChild(
        table(
          ['الموظف', 'محادثات مفتوحة'],
          metrics.load_per_employee.map(function (row) {
            return [row.actor_id, String(row.open_count)];
          }),
        ),
      );
    }
  }
  function renderIsolation(isolation) {
    var host = document.getElementById('isolation-body');
    var cards = el('div', null, 'cards');
    cards.appendChild(card('محادثات المستأجر الأول', isolation.first_tenant_total));
    cards.appendChild(card('محادثات المستأجر الثاني (الخاص به)', isolation.other_tenant_own_total));
    cards.appendChild(card('محادثات مسرَّبة للمستأجر الأول', isolation.leaked_total));
    host.appendChild(cards);
    var note = el('p');
    note.appendChild(document.createTextNode('المحادثة '));
    note.appendChild(el('span', isolation.other_tenant_ref, 'ltr'));
    note.appendChild(document.createTextNode(' تخص المستأجر '));
    note.appendChild(el('span', isolation.tenant_id, 'ltr'));
    note.appendChild(
      document.createTextNode(
        ' — و«المحادثات المسرَّبة» = الصفر — ' + isolation.note,
      ),
    );
    host.appendChild(note);
  }
  function renderDecisions(decisions) {
    var host = document.getElementById('decisions-body');
    decisions.forEach(function (item) {
      var box = el('div', null, 'dec');
      box.appendChild(el('b', item.title));
      box.appendChild(el('span', ' — ' + item.detail));
      host.appendChild(box);
    });
  }
  function renderGuardrails(guardrails) {
    var host = document.getElementById('guardrails-body');
    guardrails.forEach(function (line) {
      host.appendChild(el('li', line));
    });
  }

  var meta = document.getElementById('meta');
  meta.textContent = 'لقطة ';
  meta.appendChild(el('span', data.generated_at, 'ltr'));
  meta.appendChild(
    document.createTextNode(
      ' — اصطناعية: ' + (data.synthetic ? 'نعم' : 'لا') + ' — ' + data.notice,
    ),
  );
  renderQueue('queue-agent', data.agent_queue);
  renderQueue('queue-supervisor', data.supervisor_queue);
  renderMetrics(data.metrics);
  renderIsolation(data.isolation);
  renderDecisions(data.decisions);
  renderGuardrails(data.guardrails);
  document.getElementById('footer').textContent =
    'ملف واحد مستقل — بلا fetch ولا CDN ولا شبكة — يمكن فتحه مباشرة من file://';
})();
</script>
</body>
</html>
`;
}

// ============================================================
// ⭐ الكتابة على القرص + التشغيل كسطر أوامر
// ============================================================

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const SNAPSHOT_PATH = path.join(REPO_ROOT, 'docs', 'wasl-workbench-snapshot.json');
export const PREVIEW_PATH = path.join(REPO_ROOT, 'docs', 'wasl-workbench-preview.html');

export function writeArtifacts(): { snapshot: string; preview: string } {
  const snapshot = buildSnapshot();
  fs.writeFileSync(SNAPSHOT_PATH, serializeSnapshot(snapshot), 'utf8');
  fs.writeFileSync(PREVIEW_PATH, renderPreviewHtml(snapshot), 'utf8');
  return { snapshot: SNAPSHOT_PATH, preview: PREVIEW_PATH };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const written = writeArtifacts();
  console.log('⭐ كُتبت لقطة مركز العمل (بيانات اصطناعية · بلا شبكة · بلا حساب):');
  console.log(`  • ${path.relative(REPO_ROOT, written.snapshot)}`);
  console.log(`  • ${path.relative(REPO_ROOT, written.preview)}`);
}
