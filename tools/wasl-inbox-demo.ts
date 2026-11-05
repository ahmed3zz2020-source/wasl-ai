// ============================================================
// WASL AI — عرض تجريبي محلي (Slice 03 + Slice 04)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-inbox-demo.ts`
// ⭐ **كل البيانات اصطناعية بالكامل** — ⭐ لا حساب · ⭐ لا شبكة · ⭐ لا نشر.
// ⛔ لا يستورد من شجرة الاختبار (⇒ الملف مستقل تماماً).
// ⛔ ليس واجهة عامة ولا API — ⭐ مخرجات على الطرفية فقط.
// ⭐ **يعرض**: قراءة المحادثات (Slice 03) + حالة المحادثة وإسنادها وسجل التغييرات (Slice 04).
// ============================================================

import {
  AuditLog,
  CONVERSATION_CHANGE_STATES,
  ConversationChangeLog,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  getConversation,
  getConversationState,
  listConversations,
  readConversationAudit,
  readConversationChanges,
  resolveTenantContext,
  updateConversationState,
  type ConversationStateDependencies,
  type SessionSource,
  type TenantContext,
  type TrustedRole,
  type VerifiedIdentity,
} from '../src/core/index.ts';
// ⭐ تسجيل المصدر داخليّ من `src/core/index.ts` ⇒ ⭐ لأنّ يستوريس من السطح العام.
import { registerSessionSource } from '../src/core/session.ts';

// ============================================================
// ⭐ مصدر جلسات محلي — ⭐ نطاقه `test` ⇒ أي مسار إنتاجي يرفضه بنيوياً.
// ⭐ **الدور من سجلّ داخلي** (سلطة المصدر) ⇒ ⭐ لا يُقرأ من حمولة العميل.
// ============================================================

const DEMO_ROLES = new WeakMap<object, TrustedRole>();

function markDemoInput<T extends object>(claims: T, role: TrustedRole): T {
  DEMO_ROLES.set(claims, role);
  return claims;
}

function buildDemoSource(role: TrustedRole): SessionSource {
  return {
    id: `test-inbox-demo-${role}`,
    scope: 'test',
    description: 'مصدر محلي للعرض التجريبي فقط — بيانات اصطناعية بالكامل',
    verify(input: unknown): VerifiedIdentity | null {
      if (!input || typeof input !== 'object') return null;
      const granted = DEMO_ROLES.get(input as object);
      if (!granted) return null;
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

const demoSource = buildDemoSource('owner');
registerSessionSource({
  source: demoSource,
  grantedRole: 'owner',
  grantCeiling: [
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.assign',
  ],
});

function demoContext(
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
    'owner',
  );
  return resolveTenantContext(claims, { source: demoSource });
}

function demoEnvelope(options: {
  messageRef: string;
  conversationRef: string;
  occurredAt: string;
  body: string;
}) {
  return {
    schema_version: '1',
    message_ref: options.messageRef,
    channel: 'demo',
    direction: 'inbound' as const,
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

// ============================================================
// ⭐ المشهد
// ============================================================

const audit = new AuditLog();
const readAudit = new ReadAuditLog();
const store = new MessageStore({ audit });
const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
const deps = { store, audit, readAudit };
const states = new ConversationStateStore();
const changes = new ConversationChangeLog();
const stateDeps: ConversationStateDependencies = {
  store,
  states,
  changes,
  readAudit,
  // ⭐⭐ دليل الموظفين الاصطناعي — ⭐ authority خارجية موثوقة (لا نظام مستخدمين).
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

const tenantA = demoContext('tnt_demo_0001', 'actor_demo_0001', 'conv_demo_0001');
const tenantAConv2 = demoContext('tnt_demo_0001', 'actor_demo_0001', 'conv_demo_0002');
const tenantB = demoContext('tnt_demo_0002', 'actor_demo_0002', 'conv_demo_0001');

// ⭐ رسائل مستأجر ١ · محادثة ١
layer.process(
  tenantA,
  demoEnvelope({
    messageRef: 'demo-msg-000001',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T09:00:00.000Z',
    body: 'مساء الخير — محتاج مساعدة في الفاتورة.',
  }),
);
layer.process(
  tenantA,
  demoEnvelope({
    messageRef: 'demo-msg-000002',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T09:05:00.000Z',
    body: 'تمام — هبعتلك البيانات دلوقتي.',
  }),
);
// ⭐ رسالة بتوقيت أقدم ⇒ مؤجَّلة (لا تُخزَّن)
layer.process(
  tenantA,
  demoEnvelope({
    messageRef: 'demo-msg-000003',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T08:00:00.000Z',
    body: 'رسالة قديمة — يفترض أن تتأجّل.',
  }),
);
// ⭐ نفس المعرّف ⇒ مرفوضة (تكرار)
layer.process(
  tenantA,
  demoEnvelope({
    messageRef: 'demo-msg-000001',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T09:10:00.000Z',
    body: 'تكرار — يفترض أن يُرفض.',
  }),
);
// ⭐ محادثة ثانية لنفس المستأجر
layer.process(
  tenantAConv2,
  demoEnvelope({
    messageRef: 'demo-msg-000004',
    conversationRef: 'conv_demo_0002',
    occurredAt: '2026-01-05T10:00:00.000Z',
    body: 'استفسار من محادثة تانية.',
  }),
);
// ⭐ مستأجر ثانٍ (لإثبات العزل)
layer.process(
  tenantB,
  demoEnvelope({
    messageRef: 'demo-msg-000005',
    conversationRef: 'conv_demo_0001',
    occurredAt: '2026-01-05T11:00:00.000Z',
    body: 'رسالة مستأجر ثانٍ — لا تظهر للمستأجر الأول.',
  }),
);

// ============================================================
// ⭐⭐ إدارة الحالة والإسناد (Slice 04)
// ============================================================

// ⭐ فتح المحادثة
updateConversationState(tenantA, 'conv_demo_0001', 'open', stateDeps, { reason: 'فتح الطلب' });
// ⭐ إسنادها لموظف
assignConversation(tenantA, 'conv_demo_0001', 'actor_demo_0007', stateDeps, { reason: 'توزيع على خدمة العملاء' });
// ⭐ تحويلها إلى «بانتظار ردّ»
updateConversationState(tenantA, 'conv_demo_0001', 'pending', stateDeps, { reason: 'بانتظار بيانات العميل' });
// ⭐ محاولة ممنوعة: إسناد موظف من مستأجر آخر ⇒ مرفوضة
let crossTenantAssign = 'لم تُنفَّذ';
try {
  assignConversation(tenantB, 'conv_demo_0001', 'actor_demo_0007', stateDeps);
} catch (error) {
  crossTenantAssign = (error as { code?: string }).code ?? 'غير معروف';
}

// ============================================================
// ⭐ العرض
// ============================================================

console.log(line('═'));
console.log('⭐ WASL AI — عرض تجريبي محلي: محادثات المستأجر + حالة المحادثة وإسنادها');
console.log('⭐ كل البيانات اصطناعية · بلا شبكة · بلا حساب · بلا نشر');
console.log(line('═'));

const inbox = listConversations(tenantA, deps);
console.log('\n⭐ قائمة محادثات المستأجر tnt_demo_0001');
console.log(line());
for (const summary of inbox.summaries) {
  console.log(
    `• ${summary.conversation_ref} — رسائل: ${summary.message_count} — أول: ${summary.first_occurred_at} — آخر: ${summary.last_occurred_at}`,
  );
}
console.log(
  `  (صفحة: ${inbox.pagination.returned}/${inbox.pagination.total} · حدّ ${inbox.pagination.limit})`,
);

const thread = getConversation(tenantA, 'conv_demo_0001', deps);
console.log('\n⭐ محادثة conv_demo_0001 (الرسائل المخزَّنة فقط)');
console.log(line());
for (const message of thread.messages) {
  console.log(`• [${message.occurred_at}] ${message.direction} — ${message.body}`);
}

const decisions = readConversationAudit(tenantA, 'conv_demo_0001', deps);
console.log('\n⭐ قرارات المعالجة في المحادثة (من سجل التدقيق — بلا نصوص)');
console.log(line());
for (const entry of decisions.entries) {
  console.log(
    `• ${entry.outcome} · ${entry.reason_code} · ${entry.meta?.message_ref ?? '—'} · محادثة ${entry.meta?.conversation_ref ?? '—'}`,
  );
}

const state = getConversationState(tenantA, 'conv_demo_0001', stateDeps);
console.log('\n⭐⭐ حالة المحادثة (Slice 04)');
console.log(line());
console.log(`• الحالة: ${state.state} · الموظف المسنَد: ${state.assignee_actor_id ?? '—'} · النسخة: ${state.version}`);
console.log(`• الحالات المغلقة: ${CONVERSATION_CHANGE_STATES.join(' · ')}`);

const changePage = readConversationChanges(tenantA, 'conv_demo_0001', stateDeps);
console.log('\n⭐⭐ سجل تغييرات المحادثة (سجل مستقل — بلا نصوص رسائل)');
console.log(line());
for (const entry of changePage.entries) {
  console.log(
    `• ${entry.operation} · ${entry.from_state} ⇒ ${entry.to_state} · ${entry.assignee_from ?? '—'} ⇒ ${entry.assignee_to ?? '—'} · ${entry.reason || '(بلا سبب)'}`,
  );
}
console.log(`  (سطور: ${changePage.pagination.returned}/${changePage.pagination.total})`);
console.log(`• محاولة إسناد موظف من مستأجر آخر ⇒ ${crossTenantAssign}`);

console.log('\n⭐ سجل أحداث القراءة (مسار منفصل عن سجل المعالجة)');
console.log(line());
for (const event of readAudit.eventsFor(tenantA)) {
  console.log(
    `• ${event.operation} · ${event.capability} · ${event.result}${event.count !== undefined ? ` · صفوف ${event.count}` : ''}`,
  );
}

const other = listConversations(tenantB, deps);
console.log('\n⭐ إثبات العزل: قائمة المستأجر tnt_demo_0002');
console.log(line());
console.log(`• عدد المحادثات: ${other.summaries.length} (لا يظهر شيء من المستأجر الأول)`);

console.log(line('═'));
console.log('⭐ انتهى العرض — بيانات اصطناعية بالكامل · صفر اتصال · صفر حساب');
