// ============================================================
// WASL AI — عرض تجريبي محلي لطبقة قراءة المحادثات (Slice 03)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-inbox-demo.ts`
// ⭐ **كل البيانات اصطناعية بالكامل** — ⭐ لا حساب · ⭐ لا شبكة · ⭐ لا نشر.
// ⛔ لا يستورد من شجرة الاختبار (⇒ الملف مستقل تماماً).
// ⛔ ليس واجهة عامة ولا API — ⭐ مخرجات على الطرفية فقط.
// ============================================================

import {
  AuditLog,
  CONVERSATION_AUDIT_CAPABILITY,
  CONVERSATION_LIST_CAPABILITY,
  CONVERSATION_READ_CAPABILITY,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  getConversation,
  listConversations,
  readConversationAudit,
  resolveTenantContext,
  type SessionClaims,
  type SessionSource,
  type TenantContext,
} from '../src/core/index.ts';

// ============================================================
// ⭐ مصدر جلسات محلي — ⭐ نطاقه `test` ⇒ أي مسار إنتاجي يرفضه بنيوياً.
// ⭐ مُعرّفه يبدأ بـ`test-` ⇒ لا يمكن التعبير عنه بمعرّف إنتاجي.
// ============================================================

const DEMO_INPUTS = new WeakSet<object>();

function markDemoInput<T extends SessionClaims>(claims: T): T {
  DEMO_INPUTS.add(claims);
  return claims;
}

const demoSessionSource: SessionSource = {
  id: 'test-inbox-demo',
  scope: 'test',
  description: 'مصدر محلي للعرض التجريبي فقط — بيانات اصطناعية بالكامل',
  verify(input: unknown): SessionClaims | null {
    if (!input || typeof input !== 'object') return null;
    if (!DEMO_INPUTS.has(input as object)) return null;
    const claims = input as SessionClaims;
    return claims.authenticated === true ? claims : null;
  },
};

const CAPABILITIES = [
  CONVERSATION_LIST_CAPABILITY,
  CONVERSATION_READ_CAPABILITY,
  CONVERSATION_AUDIT_CAPABILITY,
];

function demoContext(
  tenantId: string,
  actorId: string,
  conversationRef: string,
  capabilities: readonly string[] = CAPABILITIES,
): TenantContext {
  const claims = markDemoInput({
    session_id: 'sess_demo_0001',
    tenant_id: tenantId,
    actor_id: actorId,
    conversation_ref: conversationRef,
    authenticated: true,
    capabilities: [...capabilities],
  });
  return resolveTenantContext(claims, { source: demoSessionSource });
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
// ⭐ العرض
// ============================================================

console.log(line('═'));
console.log('⭐ WASL AI — عرض تجريبي محلي: شاشة محادثات المستأجر (Slice 03)');
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
