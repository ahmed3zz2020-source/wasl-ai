// ============================================================
// WASL AI — مُشغِّل المعاينة التفاعلية (Slice 07 · P0)
// ------------------------------------------------------------
// ⭐ **هذا هو قلب المعاينة** ⇒ ⭐ وهو **يستدعي منطق النواة نفسه**
//   (قواعد الصلاحيات · خريطة الانتقالات · عمليات التعديل · سجل التغييرات)
//   ⇒ ⇒⇒ **وليس نسخة موازية**.
// ⭐ ⭐ **محاكاة الأدوار (M11)**: ⭐ **مصدر لكل دور** بنطاق `test`
//   ⇒ ⇒⇒ والدور **يُقرأ من سجلّ المصدر داخلياً** ولا يُقرأ من حمولة
//   العميل أبداً ⇒ ⇒⇒ ⇒ **تبديل الدور = اختيار مصدر آخر**، لا ادّعاء هوية.
// ⭐ ⛔ كل شيء **في الذاكرة** ⇒ ⭐ إغلاق الصفحة = ضياع كل شيء.
// ⛔ لا شبكة · لا تخزين دائم · لا بيانات حقيقية · لا مفاتيح.
// ============================================================

import {
  AuditLog,
  ConversationChangeLog,
  ConversationStateStore,
  LocalIdentityRegistry,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  ALLOWED_TRANSITIONS,
  CONVERSATION_STATES,
  TERMINAL_CONVERSATION_STATES,
  assignConversation,
  authorizeLocalRequest,
  createLocalIdentitySources,
  isTerminalState,
  listWorkQueue,
  readConversationChanges,
  unassignConversation,
  updateConversationState,
} from '../src/core/index.ts';
// ⭐⭐ Slice 08 — ⭐ **إصدار سلطة الإدارة ليس في السطح العام** ⇒ ⭐ استيراده مباشرة.
//    ⇒ ⭐⇒⇒ **السطح العام لا يستطيع تسجيل هوية أو إلغاؤها.**
import { issueIdentityAdminAuthority } from '../src/core/identity.ts';
import type {
  ConversationStateDependencies,
  MessageEnvelope,
  TenantContext,
  TrustedRole,
} from '../src/core/index.ts';

// ⭐⭐ D-065 · المسار C — ⭐ محاكاة الرحلة الصناعية (شجرة المحلي · بلا شبكة).
import { JourneySimulator } from '../src/local/journey/index.ts';

// ============================================================
// ⭐ الثوابت
// ============================================================

/** ⭐ لحظة القياس المثبَّتة — ⇒ نفس المدخل ⇒ نفس النتيجة. */
export const PREVIEW_NOW = '2026-01-05T12:00:00.000Z';

/** ⭐ الأدوار التجريبية المتاحة (وفق الأدوار الموجودة بالنواة). */
export const PREVIEW_ROLES: readonly TrustedRole[] = ['supervisor', 'agent', 'owner', 'viewer'];

/** ⭐ **الدور الافتراضي عند الفتح — مشرف تجريبي** (قرار المالك). */
export const PREVIEW_DEFAULT_ROLE: TrustedRole = 'supervisor';

/** ⭐ المستأجر الأساسي للتجربة. */
export const PREVIEW_TENANT = 'tnt_preview_0001';

/** ⭐ مستأجر ثانٍ — لاختبار العزل. */
export const PREVIEW_OTHER_TENANT = 'tnt_preview_0002';

/** ⭐ موظفو المستأجر الأول. */
export const PREVIEW_EMPLOYEES: readonly string[] = ['actor_preview_0007', 'actor_preview_0008'];

/** ⭐ موظف المستأجر الثاني — ⭐ إسناده من المستأجر الأول **مرفوض**. */
export const PREVIEW_OTHER_TENANT_EMPLOYEE = 'actor_preview_0009';

/** ⭐ ⭐ محادثة المستأجر الثاني — ⭐ **يجب ألا تظهر إطلاقاً** في رؤية المستأجر الأول. */
export const PREVIEW_OTHER_TENANT_CONVERSATION = 'conv_preview_0009';

// ============================================================
// ⭐⭐ Slice 08 — ⭐ **بذور الهوية المحلية** (محاكاة محلية · بلا تسجيل دخول)
// ⭐⭐ (المستأجر · الدور · المنفّذ) ⇒ ⭐⇒⇒ **والدور لا يُقرأ من العميل أبداً**
//   ⇒ ⭐⇒⇒ **وكل هوية تُربط بمستأجر واحد ودور واحد عند التسجيل.**
interface PreviewIdentitySeed {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
}

/** ⭐⭐ هويات المستأجر الأول — ⭐ واحد لكل دور · ⭐ ومستأجر ثانٍ للتأكد من العزل. */
const PREVIEW_IDENTITIES: readonly PreviewIdentitySeed[] = Object.freeze([
  { identity_id: 'preview-ident-owner', tenant_id: PREVIEW_TENANT, actor_id: 'actor_preview_0001', role: 'owner' },
  { identity_id: 'preview-ident-supervisor', tenant_id: PREVIEW_TENANT, actor_id: 'actor_preview_0002', role: 'supervisor' },
  { identity_id: 'preview-ident-agent', tenant_id: PREVIEW_TENANT, actor_id: 'actor_preview_0007', role: 'agent' },
  { identity_id: 'preview-ident-viewer', tenant_id: PREVIEW_TENANT, actor_id: 'actor_preview_0003', role: 'viewer' },
  { identity_id: 'preview-ident-other-owner', tenant_id: PREVIEW_OTHER_TENANT, actor_id: 'actor_preview_0002', role: 'owner' },
]);

// ============================================================
// ⭐ أنواع الواجهة العامة للمعاينة
// ============================================================

export interface PreviewOperationResult {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  readonly state: string | null;
  readonly assignee_actor_id: string | null;
}

export interface PreviewQueueRow {
  readonly conversation_ref: string;
  readonly state: string;
  readonly assignee_actor_id: string | null;
  readonly category: string;
  readonly message_count: number;
  readonly idle_minutes: number;
  readonly last_activity_at: string;
}

export interface PreviewChangeRow {
  readonly ts: string;
  readonly operation: string;
  readonly from_state: string;
  readonly to_state: string;
  readonly reason: string;
  readonly assignee_from: string | null;
  readonly assignee_to: string | null;
  readonly actor_id: string;
}

export interface PreviewDetail {
  readonly conversation_ref: string;
  readonly state: string;
  readonly assignee_actor_id: string | null;
  readonly version: number;
  readonly is_terminal: boolean;
  /** ⭐ **الانتقالات المسموحة — مُستخرجة من `ALLOWED_TRANSITIONS` في النواة** (M12). */
  readonly allowed_next: readonly string[];
  readonly employees: readonly string[];
  readonly can_assign: boolean;
  readonly can_unassign: boolean;
  readonly can_update: boolean;
  /** ⭐⭐ **قدرات الدور الحالي — من النواة** (لا قائمة موازية). */
  readonly capabilities: readonly string[];
  readonly changes: readonly PreviewChangeRow[];
}

// ⭐⭐ D-065 · المسار C — ⭐ **مشهد الرحلة الصناعية داخل المعاينة**
//    (محاكاة محلية · بلا شبكة · بلا تخزين دائم · بلا إرسال فعلي)
// ============================================================

/** ⭐⭐⭐ **خطوة واحدة في مشهد الرحلة** — ⭐ (ترجمة فقط · بلا منطق). */
export interface PreviewJourneyStep {
  readonly seq: number;
  readonly kind: string;
  readonly detail: string;
  readonly code: string | null;
}

/** ⭐⭐⭐ **نتيجة مشهد الرحلة** — ⭐ (بلا منطق · ناتجة من المحاكاة). */
export interface PreviewJourneyResult {
  readonly ok: boolean;
  readonly code: string | null;
  readonly conversation_ref: string;
  readonly intent: string | null;
  readonly priority: string | null;
  readonly reply: string | null;
  readonly state: string | null;
  readonly assignee_actor_id: string | null;
  readonly steps: readonly PreviewJourneyStep[];
}

export interface PreviewRuntime {
  readonly roles: readonly TrustedRole[];
  readonly default_role: TrustedRole;
  readonly now: string;
  getRole(): TrustedRole;
  setRole(role: TrustedRole): void;
  listQueue(): PreviewQueueRow[];
  listAll(): PreviewQueueRow[];
  getDetail(conversationRef: string): PreviewDetail | null;
  applyTransition(conversationRef: string, to: string, reason: string): PreviewOperationResult;
  assign(conversationRef: string, assigneeActorId: string, reason: string): PreviewOperationResult;
  unassign(conversationRef: string, reason: string): PreviewOperationResult;
  getChanges(conversationRef: string): PreviewChangeRow[];
  getIsolationProof(): { first_tenant_total: number; other_tenant_own_total: number; leaked_total: number };
  getStates(): readonly string[];
  getTerminalStates(): readonly string[];
  /** ⭐⭐ قدرات الدور الحالي — ⭐ **مُشتقّة من النواة** (حدّ الثقة). */
  getCapabilities(): readonly string[];
  /** ⭐⭐ الموظفين المتاحون في المستأجر الحالي. */
  getEmployees(): readonly string[];
  /** ⭐⭐ موظف من مستأجر آخر — ⭐ لاختبار رفض الإسناد. */
  getForeignEmployee(): string;
  /** ⭐⭐ D-065 — ⭐ تشغيل مشهد الرحلة الصناعية (محاكاة محلية). */
  runJourney(text: string): PreviewJourneyResult;
}

// ============================================================
// ⭐ بناء المحرّك
// ============================================================

function syntheticEnvelope(options: {
  messageRef: string;
  conversationRef: string;
  occurredAt: string;
  direction?: 'inbound' | 'outbound';
}): MessageEnvelope {
  return {
    schema_version: '1',
    message_ref: options.messageRef,
    channel: 'preview',
    direction: options.direction ?? 'inbound',
    from: 'participant-preview-0001@example.invalid',
    to: 'participant-preview-0101@example.invalid',
    body: 'preview-body',
    occurred_at: options.occurredAt,
    locale: 'ar-EG',
    attributes: { synthetic: 'true' },
    conversation_ref: options.conversationRef,
  };
}

/**
 * ⭐⭐ يُنشئ بيئة المعاينة كاملة — ⭐ **بالحالة في الذاكرة فقط**.
 */
export function createPreviewRuntime(): PreviewRuntime {
  const audit = new AuditLog({ now: () => PREVIEW_NOW });
  const readAudit = new ReadAuditLog({ now: () => PREVIEW_NOW });
  const store = new MessageStore({ now: () => PREVIEW_NOW, audit });
  const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
  const states = new ConversationStateStore({ now: () => PREVIEW_NOW });
  // ⭐ ساعة تدرّج ⇒ أزمنة متنوّعة (بلا تجميد).
  const CHANGE_TIMES = [
    '2026-01-05T11:00:00.000Z',
    '2026-01-05T11:10:00.000Z',
    '2026-01-05T11:20:00.000Z',
    '2026-01-05T11:30:00.000Z',
    '2026-01-05T11:40:00.000Z',
    '2026-01-05T11:50:00.000Z',
    '2026-01-05T12:00:00.000Z',
  ];
  let changeClock = 0;
  const changes = new ConversationChangeLog({
    now: () => CHANGE_TIMES[Math.min(changeClock++, CHANGE_TIMES.length - 1)],
  });

  const roster: Record<string, readonly string[]> = {
    [PREVIEW_TENANT]: PREVIEW_EMPLOYEES,
    [PREVIEW_OTHER_TENANT]: [PREVIEW_OTHER_TENANT_EMPLOYEE],
  };

  const deps: ConversationStateDependencies = {
    store,
    states,
    changes,
    readAudit,
    employees: {
      isEmployee(tenantId: string, actorId: string): boolean {
        return (roster[tenantId] ?? []).includes(actorId);
      },
    },
  };

  // ⭐⭐⭐ Slice 08 — ⭐ **سجلّ الهوية المحلي** (تسجيل صريح · بلا افتراضي).
  const identityRegistry = new LocalIdentityRegistry({ now: () => PREVIEW_NOW });
  const ownerSeed = PREVIEW_IDENTITIES[0];
  const ownerAuthority = issueIdentityAdminAuthority({
    ...ownerSeed,
    status: 'active',
    expires_at: null,
  });
  // ⭐ التأسيس: ⭐ المالك يسجّل نفسه ⇒ ثم يسجّل البقية.
  identityRegistry.register(ownerSeed, ownerAuthority);
  for (const seed of PREVIEW_IDENTITIES.slice(1)) {
    identityRegistry.register(seed, ownerAuthority);
  }
  const identitySources = createLocalIdentitySources(identityRegistry);

  const identityIdFor = (role: TrustedRole, tenantId: string): string =>
    PREVIEW_IDENTITIES.find((seed) => seed.role === role && seed.tenant_id === tenantId)
      ?.identity_id ?? '';

  // ⭐⭐⭐ **السياق يبنيه طبقة التفويض** ⇒ ⭐⇒⇒ **الدور من السجلّ لا من الطلب**.
  const contextFor = (role: TrustedRole, tenantId: string, conversationRef: string): TenantContext => {
    const decision = authorizeLocalRequest(
      {
        identity_id: identityIdFor(role, tenantId),
        conversation_ref: conversationRef,
        operation: 'conversation.read',
      },
      { registry: identityRegistry, sources: identitySources },
    );
    if (!decision.allowed) {
      throw new Error(`تعذّر بناء السياق: ${decision.code}`);
    }
    return decision.context;
  };

  const ownerCtx = contextFor('owner', PREVIEW_TENANT, 'conv_preview_0001');
  const otherCtx = contextFor('owner', PREVIEW_OTHER_TENANT, PREVIEW_OTHER_TENANT_CONVERSATION);

  // ── ⭐ التوليد: كل محادثة تُبنى عبر **عمليات النواة نفسها** ──
  const seed = (ref: string, actorId: string, msgs: Array<{ at: string; dir?: 'inbound' | 'outbound' }>): void => {
    const ctx = contextFor('owner', PREVIEW_TENANT, ref);
    msgs.forEach((msg, index) => {
      layer.process(
        ctx,
        syntheticEnvelope({
          messageRef: `preview-msg-${ref}-${String(index + 1).padStart(3, '0')}`,
          conversationRef: ref,
          occurredAt: msg.at,
          direction: msg.dir ?? 'inbound',
        }),
      );
    });
    void actorId;
  };

  // ① محادثة مُسندة — عامل.
  seed('conv_preview_0001', 'actor_preview_0007', [{ at: '2026-01-05T08:00:00.000Z' }]);
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0001'), 'conv_preview_0001', 'open', deps, { reason: 'فتح الطلب' });
  assignConversation(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0001'), 'conv_preview_0001', 'actor_preview_0007', deps, { reason: 'توزيع على خدمة العملاء' });

  // ② محادثة قيد المعالجة.
  seed('conv_preview_0002', 'actor_preview_0008', [
    { at: '2026-01-05T09:00:00.000Z' },
    { at: '2026-01-05T09:30:00.000Z', dir: 'outbound' },
  ]);
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0002'), 'conv_preview_0002', 'open', deps, { reason: 'فتح الطلب' });
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0002'), 'conv_preview_0002', 'pending', deps, { reason: 'بانتظار رد العميل' });

  // ③ محادثة مفتوحة بلا إسناد.
  seed('conv_preview_0003', 'actor_preview_0001', [{ at: '2026-01-05T11:50:00.000Z' }]);
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0003'), 'conv_preview_0003', 'open', deps, { reason: 'فتح الطلب' });

  // ④ محادثة قابلة للإغلاق (`resolved`).
  seed('conv_preview_0004', 'actor_preview_0001', [{ at: '2026-01-05T10:00:00.000Z' }]);
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0004'), 'conv_preview_0004', 'open', deps, { reason: 'فتح الطلب' });
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0004'), 'conv_preview_0004', 'resolved', deps, { reason: 'تم الحل' });

  // ⑤ محادثة مغلقة — **نهائية** (لا تُعدَّل ولا تُسند).
  seed('conv_preview_0005', 'actor_preview_0001', [{ at: '2026-01-05T07:00:00.000Z' }]);
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0005'), 'conv_preview_0005', 'open', deps, { reason: 'فتح الطلب' });
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0005'), 'conv_preview_0005', 'resolved', deps, { reason: 'تم الحل' });
  updateConversationState(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0005'), 'conv_preview_0005', 'closed', deps, { reason: 'إغلاق نهائي' });

  // ⑥ محادثة المستأجر الثاني — **يجب ألا تظهر في رؤية المستأجر الأول**.
  layer.process(
    otherCtx,
    syntheticEnvelope({
      messageRef: 'preview-msg-other-0001',
      conversationRef: PREVIEW_OTHER_TENANT_CONVERSATION,
      occurredAt: '2026-01-05T10:00:00.000Z',
    }),
  );

  // ── ⭐ حالة الدور الحالي ──
  let currentRole: TrustedRole = PREVIEW_DEFAULT_ROLE;

  // ⭐⭐ **سياق الدور الحالي** ⇒ ⭐⇒⇒ **من هوية الدور نفسه** (بلا تصعيد).
  const context = (role: TrustedRole, conversationRef: string): TenantContext =>
    contextFor(role, PREVIEW_TENANT, conversationRef);

  const toRows = (items: readonly unknown[]): PreviewQueueRow[] =>
    (items as Array<Record<string, unknown>>).map((item) => ({
      conversation_ref: String(item.conversation_ref),
      state: String(item.state),
      assignee_actor_id: (item.assignee_actor_id as string | null) ?? null,
      category: String(item.category),
      message_count: Number(item.message_count),
      idle_minutes: Number(item.idle_minutes),
      last_activity_at: String(item.last_activity_at),
    }));

  const changeRows = (entries: readonly unknown[]): PreviewChangeRow[] =>
    (entries as Array<Record<string, unknown>>).map((entry) => ({
      ts: String(entry.ts),
      operation: String(entry.operation),
      from_state: String(entry.from_state),
      to_state: String(entry.to_state),
      reason: String(entry.reason ?? ''),
      assignee_from: (entry.assignee_from as string | null) ?? null,
      assignee_to: (entry.assignee_to as string | null) ?? null,
      actor_id: String(entry.actor_id),
    }));

  const fail = (error: unknown): PreviewOperationResult => {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown_error';
    const message =
      error instanceof Error ? error.message : 'خطأ غير متوقع أثناء تنفيذ العملية';
    return { ok: false, code, message, state: null, assignee_actor_id: null };
  };

  // ⭐⭐⭐ **محاكي الرحلة** — ⭐ (الحالة كلّها في الذاكرة).
  const journey = new JourneySimulator();

  const runtime: PreviewRuntime = {
    roles: PREVIEW_ROLES,
    default_role: PREVIEW_DEFAULT_ROLE,
    now: PREVIEW_NOW,

    getRole(): TrustedRole {
      return currentRole;
    },

    setRole(role: TrustedRole): void {
      if (!PREVIEW_ROLES.includes(role)) return;
      currentRole = role;
    },

    listQueue(): PreviewQueueRow[] {
      try {
        const page = listWorkQueue(context(currentRole, 'conv_preview_0001'), deps, { now: PREVIEW_NOW });
        return toRows(page.items);
      } catch {
        return [];
      }
    },

    listAll(): PreviewQueueRow[] {
      // ⭐⭐ **بلا تصعيد** ⇒ ⭐⇒⇒ **سياق الدور الحالي نفسه** (لا دور أعلى).
      try {
        const page = listWorkQueue(context(currentRole, 'conv_preview_0001'), deps, {
          now: PREVIEW_NOW,
        });
        return toRows(page.items);
      } catch {
        return [];
      }
    },

    getDetail(conversationRef: string): PreviewDetail | null {
      const ctx = context(currentRole, conversationRef);
      const view = states.get(ctx, conversationRef);
      if (!view) return null;
      const queue = runtime.listQueue();
      const row = queue.find((item) => item.conversation_ref === conversationRef);
      // ⭐⭐ **الانتقالات المسموحة من خريطة النواة نفسها** (M12 · §1).
      const allowed = ALLOWED_TRANSITIONS[view.state] ?? [];
      const terminal = isTerminalState(view.state);
      // ⭐⭐ **الصلاحية من قدرات السياق المعتمدة** (من النواة) — ⭐ لا قائمة موازية.
      const capabilities = ctx.capabilities;
      const canUpdate = capabilities.includes('conversation.state.update');
      const canAssign = capabilities.includes('conversation.assign');
      const changesForRef = changeRows(
        changes.changesFor(ctx, conversationRef) as unknown as readonly unknown[],
      );
      return {
        conversation_ref: view.conversation_ref,
        state: view.state,
        assignee_actor_id: view.assignee_actor_id,
        version: view.version,
        is_terminal: terminal,
        allowed_next: allowed,
        employees: PREVIEW_EMPLOYEES,
        can_assign: canAssign && !terminal && allowed.includes('assigned'),
        can_unassign: canAssign && !terminal && view.assignee_actor_id !== null,
        can_update: canUpdate && !terminal && allowed.length > 0,
        capabilities,
        changes: changesForRef,
      };
    },

    applyTransition(conversationRef: string, to: string, reason: string): PreviewOperationResult {
      try {
        const ctx = context(currentRole, conversationRef);
        const view = updateConversationState(ctx, conversationRef, to as never, deps, { reason });
        return {
          ok: true,
          code: 'ok',
          message: 'تم تنفيذ الانتقال',
          state: view.state,
          assignee_actor_id: view.assignee_actor_id,
        };
      } catch (error) {
        return fail(error);
      }
    },

    assign(conversationRef: string, assigneeActorId: string, reason: string): PreviewOperationResult {
      try {
        const ctx = context(currentRole, conversationRef);
        const view = assignConversation(ctx, conversationRef, assigneeActorId, deps, { reason });
        return {
          ok: true,
          code: 'ok',
          message: 'تم الإسناد',
          state: view.state,
          assignee_actor_id: view.assignee_actor_id,
        };
      } catch (error) {
        return fail(error);
      }
    },

    unassign(conversationRef: string, reason: string): PreviewOperationResult {
      try {
        const ctx = context(currentRole, conversationRef);
        const view = unassignConversation(ctx, conversationRef, deps, { reason });
        return {
          ok: true,
          code: 'ok',
          message: 'تم إلغاء الإسناد',
          state: view.state,
          assignee_actor_id: view.assignee_actor_id,
        };
      } catch (error) {
        return fail(error);
      }
    },

    getChanges(conversationRef: string): PreviewChangeRow[] {
      try {
        const ctx = context(currentRole, conversationRef);
        const page = readConversationChanges(ctx, conversationRef, deps, { limit: 50 });
        return changeRows(page.entries as unknown as readonly unknown[]);
      } catch {
        return [];
      }
    },

    getIsolationProof(): {
      first_tenant_total: number;
      other_tenant_own_total: number;
      leaked_total: number;
    } {
      // ⭐⭐ **تشخيص صريح**: ⭐ هوية **المالك** (لكل المستأجر) ⇒ ⭐⇒⇒ رقمان قابلان للمقارنة.
      const firstTenantRefs = new Set(
        listWorkQueue(contextFor('owner', PREVIEW_TENANT, 'conv_preview_0001'), deps, {
          now: PREVIEW_NOW,
        }).items.map((item) => item.conversation_ref),
      );
      const otherCtx = contextFor('owner', PREVIEW_OTHER_TENANT, PREVIEW_OTHER_TENANT_CONVERSATION);
      let otherTotal = 0;
      try {
        otherTotal = listWorkQueue(otherCtx, deps, { now: PREVIEW_NOW }).pagination.total;
      } catch {
        otherTotal = 0;
      }
      const leaked = firstTenantRefs.has(PREVIEW_OTHER_TENANT_CONVERSATION) ? 1 : 0;
      return {
        first_tenant_total: firstTenantRefs.size,
        other_tenant_own_total: otherTotal,
        leaked_total: leaked,
      };
    },

    /**
     * ⭐⭐⭐ **مشهد الرحلة الصناعية (D-065)** — ⭐ **محاكاة محلية**:
     * ⭐ تستدعي `JourneySimulator` ⇒ ⭐⇒⇒ **وكل رفض فيها صادر من النواة نفسها**
     * ⭐⇒⇒⇒ (لا نسخة موازية · لا ردّ مُولَّد · لا إرسال).
     */
    runJourney(text: string): PreviewJourneyResult {
      const outcome = journey.receive(text);
      return {
        ok: outcome.ok,
        code: outcome.code,
        conversation_ref: outcome.conversation_ref,
        intent: outcome.intent,
        priority: outcome.priority,
        reply: outcome.reply,
        state: outcome.state,
        assignee_actor_id: outcome.assignee_actor_id,
        steps: outcome.steps.map((step) => ({
          seq: step.seq,
          kind: step.kind,
          detail: step.detail,
          code: step.code,
        })),
      };
    },

    getStates(): readonly string[] {
      return CONVERSATION_STATES;
    },

    getTerminalStates(): readonly string[] {
      return TERMINAL_CONVERSATION_STATES;
    },

    getCapabilities(): readonly string[] {
      return context(currentRole, 'conv_preview_0001').capabilities;
    },

    getEmployees(): readonly string[] {
      return PREVIEW_EMPLOYEES;
    },

    getForeignEmployee(): string {
      return PREVIEW_OTHER_TENANT_EMPLOYEE;
    },
  };

  return runtime;
}
