// ============================================================
// WASL AI — عرض تجريبي محلي (Slice 05: مركز عمل الوكيل + مؤشرات الخدمة)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-agent-queue-demo.ts`
// ⭐ **كل البيانات اصطناعية بالكامل** — ⭐ لا حساب · ⭐ لا شبكة · ⭐ لا نشر.
// ⛔ لا يستورد من شجرة الاختبار (⇒ الملف مستقل تماماً).
// ⛔ ليس واجهة عامة ولا API — ⭐ مخرجات على الطرفية فقط.
// ⭐ **يعرض**: طابور الوكيل (محادثاته فقط) · طابور فريق المشرف ·
//   مؤشرات الخدمة (للمشرف والمالك) · رفض المؤشرات على الوكيل · إثبات العزل.
// ============================================================

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
  updateConversationState,
  resolveTenantContext,
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

const DEMO_ROLES = new WeakMap<object, TrustedRole>();

function markDemoInput<T extends object>(claims: T, role: TrustedRole): T {
  DEMO_ROLES.set(claims, role);
  return claims;
}

function buildDemoSource(role: TrustedRole): SessionSource {
  return {
    id: `test-agent-queue-demo-${role}`,
    scope: 'test',
    description: 'مصدر محلي للعرض التجريبي فقط — بيانات اصطناعية بالكامل',
    verify(input: unknown): VerifiedIdentity | null {
      if (!input || typeof input !== 'object') return null;
      if (DEMO_ROLES.get(input as object) !== role) return null;
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
  owner: buildDemoSource('owner'),
  supervisor: buildDemoSource('supervisor'),
  agent: buildDemoSource('agent'),
} as const;

for (const role of ['owner', 'supervisor', 'agent'] as const) {
  registerSessionSource({
    source: sources[role],
    grantedRole: role,
    grantCeiling: CEILINGS[role],
  });
}

function demoContext(
  role: TrustedRole,
  tenantId: string,
  actorId: string,
  conversationRef: string,
): TenantContext {
  const claims = markDemoInput(
    {
      session_id: 'sess_demo_0001',
      tenant_id: tenantId,
      actor_id: actorId,
      conversation_ref: conversationRef,
      authenticated: true,
    },
    role,
  );
  return resolveTenantContext(claims, { source: sources[role as keyof typeof sources] });
}

function demoEnvelope(options: {
  messageRef: string;
  conversationRef: string;
  occurredAt: string;
  direction?: 'inbound' | 'outbound';
  body: string;
}): MessageEnvelope {
  return {
    schema_version: '1',
    message_ref: options.messageRef,
    channel: 'demo',
    direction: options.direction ?? 'inbound',
    from: 'participant-demo-0001@example.invalid',
    to: 'participant-demo-0101@example.invalid',
    body: options.body,
    occurred_at: options.occurredAt,
    locale: 'ar-EG',
    attributes: { synthetic: 'true' },
    conversation_ref: options.conversationRef,
  };
}

function line(char = '─'): string {
  return char.repeat(64);
}

const NOW = '2026-01-05T12:00:00.000Z';

// ============================================================
// ⭐ المشهد
// ============================================================

const audit = new AuditLog({ now: () => NOW });
const readAudit = new ReadAuditLog({ now: () => NOW });
const store = new MessageStore({ now: () => NOW, audit });
const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
const states = new ConversationStateStore({ now: () => NOW });
// ⭐ ساعة التغيّيرات — ⭐ **تتدرّج** (كل تغيير بعد سابقه) ⇒ ⭐ أزمنة انتظار متنوّعة.
const CHANGE_TIMES = [
  '2026-01-05T11:00:00.000Z',
  '2026-01-05T11:10:00.000Z',
  '2026-01-05T11:20:00.000Z',
  '2026-01-05T11:30:00.000Z',
  '2026-01-05T11:40:00.000Z',
];
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
        tnt_demo_0001: ['actor_demo_0007', 'actor_demo_0008'],
        tnt_demo_0002: ['actor_demo_0009'],
      };
      return (roster[tenantId] ?? []).includes(actorId);
    },
  },
};

const ownerCtx = demoContext('owner', 'tnt_demo_0001', 'actor_demo_0001', 'conv_demo_0001');
const ownerCtx2 = demoContext('owner', 'tnt_demo_0001', 'actor_demo_0001', 'conv_demo_0002');
const ownerCtx3 = demoContext('owner', 'tnt_demo_0001', 'actor_demo_0001', 'conv_demo_0003');
const supervisorCtx = demoContext(
  'supervisor',
  'tnt_demo_0001',
  'actor_demo_0002',
  'conv_demo_0001',
);
const agentCtx = demoContext('agent', 'tnt_demo_0001', 'actor_demo_0007', 'conv_demo_0001');
const otherTenantCtx = demoContext('owner', 'tnt_demo_0002', 'actor_demo_0002', 'conv_demo_0001');

// ⭐ محادثة ١: وارد ٠٨:٠٠ ⇒ الأطول انتظاراً.
layer.process(
  ownerCtx,
  demoEnvelope({
    messageRef: 'demo-msg-000001',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T08:00:00.000Z',
    body: 'مساء الخير — محتاج مساعدة في الفاتورة.',
  }),
);
// ⭐ محادثة ٢: وارد ٠٩:٠٠ + صادر ٠٩:٣٠ ⇒ أول رد = ٣٠ دقيقة.
layer.process(
  ownerCtx2,
  demoEnvelope({
    messageRef: 'demo-msg-000002',
    conversationRef: 'conv_demo_0002',
    occurredAt: '2026-01-05T09:00:00.000Z',
    body: 'تمام — هبعتلك البيانات دلوقتي.',
  }),
);
layer.process(
  ownerCtx2,
  demoEnvelope({
    messageRef: 'demo-msg-000003',
    conversationRef: 'conv_demo_0002',
    direction: 'outbound',
    occurredAt: '2026-01-05T09:30:00.000Z',
    body: 'وصلت البيانات — سنراجعها.',
  }),
);
// ⭐ محادثة ٣: وارد ١١:٥٠ ⇒ متأخرة (≥ ٣٠ دقيقة).
layer.process(
  ownerCtx3,
  demoEnvelope({
    messageRef: 'demo-msg-000004',
    conversationRef: 'conv_demo_0003',
    occurredAt: '2026-01-05T11:50:00.000Z',
    body: 'استفسار سريع لو سمحت.',
  }),
);
// ⭐ مستأجر ثانٍ (لإثبات العزل).
layer.process(
  otherTenantCtx,
  demoEnvelope({
    messageRef: 'demo-msg-000005',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T10:00:00.000Z',
    body: 'رسالة مستأجر ثانٍ — لا تظهر للمستأجر الأول.',
  }),
);

// ⭐ إسناد: محادثة ١ للوكيل · محادثة ٢ لموظف آخر · ٣ بلا إسناد.
updateConversationState(ownerCtx, 'conv_demo_0001', 'open', deps, { reason: 'فتح الطلب' });
assignConversation(ownerCtx, 'conv_demo_0001', 'actor_demo_0007', deps, { reason: 'توزيع على خدمة العملاء' });
updateConversationState(ownerCtx2, 'conv_demo_0002', 'open', deps, { reason: 'فتح الطلب' });
assignConversation(ownerCtx2, 'conv_demo_0002', 'actor_demo_0008', deps, { reason: 'توزيع على فريق آخر' });
updateConversationState(ownerCtx3, 'conv_demo_0003', 'open', deps, { reason: 'فتح الطلب' });

// ============================================================
// ⭐ العرض
// ============================================================

console.log(line('═'));
console.log('⭐ WASL AI — عرض تجريبي محلي: مركز عمل الوكيل + مؤشرات الخدمة (Slice 05)');
console.log('⭐ كل البيانات اصطناعية · بلا شبكة · بلا حساب · بلا نشر');
console.log(line('═'));

const agentQueue = listWorkQueue(agentCtx, deps, { now: NOW });
console.log('\n⭐⭐ طابور الوكيل (قرار المالك: «الموظف يرى محادثاته فقط»)');
console.log(line());
for (const item of agentQueue.items) {
  console.log(
    `• ${item.conversation_ref} · ${item.category} · ${item.state} · مُسندة: ${item.assignee_actor_id ?? '—'} · انتظار: ${item.waiting_minutes} دقيقة · متأخرة: ${item.is_late ? 'نعم' : 'لا'}`,
  );
}
console.log(
  `  (صفوف: ${agentQueue.pagination.returned}/${agentQueue.pagination.total} · معيار التأخير: ${agentQueue.pagination.late_threshold_minutes} دقيقة)`,
);

const teamQueue = listWorkQueue(supervisorCtx, deps, { now: NOW });
console.log('\n⭐⭐ طابور فريق المشرف (قرار: «المشرف يرى طابور فريق شركته»)');
console.log(line());
for (const item of teamQueue.items) {
  console.log(
    `• ${item.conversation_ref} · ${item.category} · ${item.state} · مُسندة: ${item.assignee_actor_id ?? '—'} · رسائل: ${item.message_count} · انتظار: ${item.waiting_minutes} دقيقة · متأخرة: ${item.is_late ? 'نعم' : 'لا'}`,
  );
}
console.log(`  (صفوف: ${teamQueue.pagination.returned}/${teamQueue.pagination.total})`);

const metrics = getServiceMetrics(supervisorCtx, deps, { now: NOW });
console.log('\n⭐⭐ مؤشرات الخدمة (قرار: «للمشرف والمالك فقط»)');
console.log(line());
console.log(`• إجمالي المحادثات: ${metrics.conversations_total}`);
console.log(
  `• لكل حالة: ${Object.entries(metrics.by_state)
    .map(([state, count]) => `${state}=${count}`)
    .join(' · ')}`,
);
console.log(`• بلا مُسندة: ${metrics.unassigned_total} · متأخرة: ${metrics.late_total}`);
console.log(
  `• متوسط زمن أول رد: ${metrics.first_response_minutes ?? 'غير محسوب'} دقيقة · متوسط زمن الحل: ${metrics.resolution_minutes ?? 'غير محسوب'} دقيقة`,
);
console.log(
  `• العبء لكل موظف: ${
    metrics.load_per_employee
      .map((row) => `${row.actor_id}=${row.open_count}`)
      .join(' · ') || '(لا عبء)'
  }`,
);

let agentMetrics = 'مرفوض (بلا صلاحية)';
try {
  getServiceMetrics(agentCtx, deps, { now: NOW });
  agentMetrics = 'قُرئ (خطأ — المفترض رفض)';
} catch (error) {
  agentMetrics = `مرفوض ⇒ ${(error as { code?: string }).code ?? 'غير معروف'}`;
}
console.log(`\n⭐ محاولة قراءة المؤشرات بدور «الموظف» ⇒ ${agentMetrics}`);

const otherQueue = listWorkQueue(otherTenantCtx, deps, { now: NOW });
console.log('\n⭐ إثبات العزل: طابور المستأجر tnt_demo_0002');
console.log(line());
console.log(`• عدد المحادثات: ${otherQueue.pagination.total} (لا يظهر شيء من المستأجر الأول)`);

console.log(line('═'));
console.log('⭐ انتهى العرض — بيانات اصطناعية بالكامل · صفر اتصال · صفر حساب');
