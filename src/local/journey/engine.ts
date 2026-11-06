// ============================================================
// WASL AI — محاكي رحلة خدمة العملاء (محاكاة محلية · D-065)
// ------------------------------------------------------------
// ⭐⭐⭐ **هذا ليس نظام خدمة عملاء** ⇒ ⭐ محاكاة صناعية محلية بالكامل.
// ⭐⭐ **قاعدة إعادة الاستخدام**: ⭐ **لا نسخة موازية** من منطق النواة ⇒
//   ⭐⇒⇒ **كل قرار يمرّ على دوال النواة نفسها** (الطبقة · التخزين ·
//   الصلاحيات · انتقالات الحالة · سجل التغييرات) ⇒ ⭐⇒⇒⇒ **فما يظهر في
//   الرحلة هو ما تفعله النواة فعلاً — لا ما نريد أن تدّعيه.**
// ⭐⭐ **هوية المالك (M54)**: ⭐ كل عملية تبدأ بـ**إثبات هوية صادر من
//   المصدر المحلي** ⇒ ⭐⇒⇒ **ونجاح تقييمه هو شرط التنفيذ**.
// ⛔ بلا شبكة · ⛔ بلا تخزين دائم · ⛔ بلا إرسال فعلي · ⛔ بلا استدعاء خارجي.
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
  assignConversation,
  authorizeLocalRequest,
  createLocalIdentitySources,
  updateConversationState,
  type ConversationStateDependencies,
  type LocalAuthorizationOperation,
  type LocalIdentitySources,
  type MessageEnvelope,
  type TenantContext,
} from '../../core/index.ts';
// ⭐⭐⭐ **إصدار سلطة الإدارة غير مُصدَّر من السطح العام** ⇒ ⭐ استيراد مباشر.
import { issueIdentityAdminAuthority } from '../../core/identity.ts';
// ⭐⭐⭐ **إصدار إثبات الهوية غير مُصدَّر من السطح العام** ⇒ ⭐ استيراد مباشر
//    ⇒ ⭐⇒⇒ **فلا جهة خارجية تستطيع إصدار إثبات هوية لهذا المسار.**
import {
  evaluateIdentityAttestation,
  issueLocalTestAttestation,
} from '../../core/identity-source-contract.ts';
import { classifyJourneyMessage, renderJourneyReply } from './classification.ts';
import type {
  JourneyOutcome,
  JourneyPriority,
  JourneyIntent,
  JourneyStep,
  JourneyStepKind,
} from './types.ts';

/** ⭐⭐⭐ **لحظة القياس المثبَّتة** — ⭐ نفس المدخل ⇒ نفس النتيجة. */
export const JOURNEY_NOW = '2026-01-05T12:00:00.000Z';

/** ⭐⭐⭐ **المستأجر الأول** — ⭐ (نطاق الاختبار فقط). */
export const JOURNEY_TENANT = 'tnt_journey_0001';

/** ⭐⭐⭐ **المستأجر الثاني** — ⭐ لاختبار العزل. */
export const JOURNEY_OTHER_TENANT = 'tnt_journey_0002';

/** ⭐⭐⭐ **الأدوار التي تلعب في الرحلة**. */
export type JourneyActor = 'owner' | 'supervisor' | 'agent';

const ACTOR_IDENTITIES: Readonly<Record<JourneyActor, string>> = Object.freeze({
  owner: 'journey-ident-owner',
  supervisor: 'journey-ident-supervisor',
  agent: 'journey-ident-agent',
});

const ACTOR_ACTORS: Readonly<Record<JourneyActor, string>> = Object.freeze({
  owner: 'actor_journey_0001',
  supervisor: 'actor_journey_0002',
  agent: 'actor_journey_0003',
});

export interface JourneySimulatorOptions {
  readonly now?: () => string;
  readonly tenantId?: string;
}

/**
 * ⭐⭐⭐⭐⭐ **محاكي الرحلة** — ⭐ **الحالة كلها في الذاكرة**.
 * ⭐ إغلاق العملية = ضياع كل شيء ⇒ ⭐⇒⇒ **لا أثر دائم ولا بيانات عميل.**
 */
export class JourneySimulator {
  readonly #registry: LocalIdentityRegistry;
  readonly #sources: LocalIdentitySources;
  readonly #layer: ProcessingLayer;
  readonly #deps: ConversationStateDependencies;
  readonly #steps: JourneyStep[] = [];
  readonly #tenantId: string;
  #seq = 0;
  #messages = 0;
  #conversations = 0;
  #last: JourneyOutcome | null = null;

  constructor(options: JourneySimulatorOptions = {}) {
    const now = options.now ?? (() => JOURNEY_NOW);
    this.#tenantId = options.tenantId ?? JOURNEY_TENANT;

    const audit = new AuditLog({ now });
    const readAudit = new ReadAuditLog({ now });
    const store = new MessageStore({ now, audit });
    const states = new ConversationStateStore({ now });
    const changes = new ConversationChangeLog({ now });
    this.#layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });

    // ⭐⭐⭐ **سجلّ الهوية المحلي** — ⭐ (تسجيل صريح · بلا افتراضي).
    this.#registry = new LocalIdentityRegistry({ now });
    const ownerSeed = {
      identity_id: ACTOR_IDENTITIES.owner,
      tenant_id: this.#tenantId,
      actor_id: ACTOR_ACTORS.owner,
      role: 'owner' as const,
      expires_at: null,
    };
    const ownerAuthority = issueIdentityAdminAuthority({
      ...ownerSeed,
      status: 'active',
      expires_at: null,
    });
    this.#registry.register(ownerSeed, ownerAuthority);
    this.#registry.register(
      {
        identity_id: ACTOR_IDENTITIES.supervisor,
        tenant_id: this.#tenantId,
        actor_id: ACTOR_ACTORS.supervisor,
        role: 'supervisor',
        expires_at: null,
      },
      ownerAuthority,
    );
    this.#registry.register(
      {
        identity_id: ACTOR_IDENTITIES.agent,
        tenant_id: this.#tenantId,
        actor_id: ACTOR_ACTORS.agent,
        role: 'agent',
        expires_at: null,
      },
      ownerAuthority,
    );
    this.#registry.register(
      {
        identity_id: 'journey-ident-other-owner',
        tenant_id: JOURNEY_OTHER_TENANT,
        actor_id: 'actor_journey_0004',
        role: 'owner',
        expires_at: null,
      },
      ownerAuthority,
    );
    this.#sources = createLocalIdentitySources(this.#registry);

    const roster: Record<string, readonly string[]> = {
      [this.#tenantId]: [ACTOR_ACTORS.supervisor, ACTOR_ACTORS.agent],
      [JOURNEY_OTHER_TENANT]: ['actor_journey_0004'],
    };
    this.#deps = {
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
  }

  // ── ⭐ مساعدات داخلية ──

  #record(kind: JourneyStepKind, detail: string, code: string | null): void {
    this.#seq += 1;
    this.#steps.push({ seq: this.#seq, kind, detail, code });
  }

  #codeOf(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return 'journey_unknown_error';
  }

  #nextConversationRef(): string {
    this.#conversations += 1;
    return `conv_journey_${String(this.#conversations).padStart(4, '0')}`;
  }

  /**
   * ⭐⭐⭐⭐⭐ **بوّابة الهوية (M54)** — ⭐ **شرط التنفيذ الأول في كل عملية**.
   * ⭐⭐⭐ **الفصل**: ⭐ الفحص البنيوي وحده ⛔ لا يكفي ⇒ ⭐⇒⇒ **فلا بدّ من
   *   إثبات صادر من المصدر المحلي + إعادة تحقّق من السجلّ.**
   */
  #identityGate(actor: JourneyActor): boolean {
    const identityId = ACTOR_IDENTITIES[actor];
    let attestation;
    try {
      attestation = issueLocalTestAttestation(identityId, { registry: this.#registry });
    } catch (error) {
      const code = this.#codeOf(error);
      this.#record('reject', `تعذّر إصدار إثبات هوية «${actor}»`, code);
      return false;
    }
    const decision = evaluateIdentityAttestation(attestation, { registry: this.#registry });
    if (!decision.trusted) {
      this.#record('reject', `إثبات هوية «${actor}» مرفوض ⇒ لا تنفيذ`, decision.code);
      return false;
    }
    this.#record('identity', `هوية «${actor}» موثّقة (${decision.claim.role})`, null);
    return true;
  }

  /** ⭐⭐⭐ **بناء السياق** — ⭐ **من طبقة التفويض القائمة** (بلا نسخة موازية). */
  #context(
    actor: JourneyActor,
    conversationRef: string,
    operation: LocalAuthorizationOperation,
  ): TenantContext | null {
    const decision = authorizeLocalRequest(
      {
        identity_id: ACTOR_IDENTITIES[actor],
        conversation_ref: conversationRef,
        operation,
      },
      { registry: this.#registry, sources: this.#sources },
    );
    if (!decision.allowed) {
      this.#record('reject', `العملية «${operation}» مرفوضة لـ«${actor}»`, decision.code);
      return null;
    }
    return decision.context;
  }

  /** ⭐⭐⭐ **رسالة صناعية** — ⭐ (بلا بريد · بلا بيانات حقيقية). */
  #envelope(conversationRef: string, direction: 'inbound' | 'outbound', body: string): MessageEnvelope {
    this.#messages += 1;
    // ⭐⭐⭐ **أزمنة متصاعدة بثانية واحدة** ⇒ ⭐⇒⇒ **فلا تعارض في الترتيب**
    //   (لحظة واحدة لرسالتين = مؤجَّلة) ⇒ ⭐⇒⇒⇒ **والتسلسل يبقى حتمياً.**
    const occurredAt = new Date(
      Date.parse(JOURNEY_NOW) + this.#messages * 1000,
    ).toISOString();
    return {
      schema_version: '1',
      message_ref: `journey-msg-${String(this.#messages).padStart(4, '0')}`,
      channel: 'journey',
      direction,
      from: 'participant_journey_0001',
      to: 'participant_journey_0101',
      body,
      occurred_at: occurredAt,
      locale: 'ar-EG',
      attributes: { journey: 'true' },
      conversation_ref: conversationRef,
    };
  }

  #outcome(
    ok: boolean,
    code: string | null,
    conversationRef: string,
    fromStep: number,
    intent: JourneyIntent | null = null,
    priority: JourneyPriority | null = null,
    reply: string | null = null,
    state: string | null = null,
    assignee: string | null = null,
  ): JourneyOutcome {
    const outcome: JourneyOutcome = {
      ok,
      code,
      conversation_ref: conversationRef,
      intent,
      priority,
      reply,
      state,
      assignee_actor_id: assignee,
      steps: this.#steps.slice(fromStep),
    };
    this.#last = outcome;
    return outcome;
  }

// ============================================================
// ⭐⭐⭐⭐⭐ **المسار الصناعي للرحلة** — ⭐ **باستخدام دوال النواة نفسها**
// ============================================================

/**
 * ⭐⭐⭐⭐⭐ **استقبال رسالة عميل** — ⭐ **المسار الكامل**:
 * ⭐ ① بوّابة الهوية ⇒ ② استقبال الرسالة ⇒ ③ التصنيف الحتمي
 * ⭐ ⇒ ④ ردّ بقالب ثابت ⇒ ⑤ الإسناد ⇒ ⑥ التقدّم إلى `pending`.
 * ⭐⭐⭐ **الردّ يُخزَّن محلياً فقط** ⇒ ⭐⇒⇒ **ولا يُرسل إلى أي جهة.**
 */
receive(text: string, options: { conversationRef?: string } = {}): JourneyOutcome {
  const fromStep = this.#steps.length;
  const conversationRef = options.conversationRef ?? this.#nextConversationRef();

  // ① بوّابة الهوية (المالك يستقبل الطلب).
  if (!this.#identityGate('owner')) {
    return this.#outcome(false, 'identity_issuer_unverified', conversationRef, fromStep);
  }

  // ② استقبال الرسالة — عبر طبقة المعالجة (لا تخزين مباشر).
  const ownerCtx = this.#context('owner', conversationRef, 'conversation.read');
  if (!ownerCtx) {
    return this.#outcome(false, 'context_denied', conversationRef, fromStep);
  }
  const processed = this.#layer.process(
    ownerCtx,
    this.#envelope(conversationRef, 'inbound', String(text ?? '')),
  );
  if (processed.decision !== 'accepted') {
    this.#record('reject', 'الرسالة مرفوضة من طبقة المعالجة', processed.reason_code);
    return this.#outcome(false, processed.reason_code, conversationRef, fromStep);
  }
  this.#record('receive', 'استُقبلت رسالة العميل وخُزّنت محلياً', null);

  // ③ التصنيف — حتمي (جدول كلمات ثابت).
  const classification = classifyJourneyMessage(text);
  this.#record(
    'classify',
    `النية «${classification.intent}» · الأولوية «${classification.priority}»`,
    null,
  );

  // ④ الردّ —الموظّف يكتب ردّه بقالب ثابت (محلي · بلا إرسال).
  const reply = renderJourneyReply(classification.intent, classification.priority);
  if (!this.#identityGate('agent')) {
    return this.#outcome(
      false,
      'identity_issuer_unverified',
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
    );
  }
  const agentCtx = this.#context('agent', conversationRef, 'conversation.read');
  if (!agentCtx) {
    return this.#outcome(
      false,
      'context_denied',
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
    );
  }
  const replied = this.#layer.process(
    agentCtx,
    this.#envelope(conversationRef, 'outbound', reply),
  );
  if (replied.decision !== 'accepted') {
    this.#record('reject', 'الردّ مرفوض من طبقة المعالجة', replied.reason_code);
    return this.#outcome(
      false,
      replied.reason_code,
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
    );
  }
  this.#record('reply', 'حُرّر ردّ بقالب ثابت (لم يُرسل)', null);

  // ⑤ فتح المحادثة ثم إسنادها — المالك فقط (صلاحية `conversation.assign`).
  const openCtx = this.#context('owner', conversationRef, 'conversation.state.update');
  if (!openCtx) {
    return this.#outcome(
      false,
      'context_denied',
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
      reply,
    );
  }
  try {
    updateConversationState(openCtx, conversationRef, 'open', this.#deps, {
      reason: 'فتح الطلب الوارد',
    });
  } catch (error) {
    const code = this.#codeOf(error);
    this.#record('reject', 'تعذّر فتح المحادثة', code);
    return this.#outcome(
      false,
      code,
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
      reply,
    );
  }

  const escalated = classification.priority === 'high';
  const assignee = escalated ? ACTOR_ACTORS.supervisor : ACTOR_ACTORS.agent;
  const assignCtx = this.#context('owner', conversationRef, 'conversation.assign');
  if (!assignCtx) {
    return this.#outcome(
      false,
      'context_denied',
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
      reply,
    );
  }
  try {
    assignConversation(assignCtx, conversationRef, assignee, this.#deps, {
      reason: escalated ? 'تصعيد الطلب العاجل' : 'توزيع على خدمة العملاء',
    });
  } catch (error) {
    const code = this.#codeOf(error);
    this.#record('reject', 'تعذّر إسناد المحادثة', code);
    return this.#outcome(
      false,
      code,
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
      reply,
    );
  }
  this.#record(
    'assign',
    escalated ? 'صُعّد الطلب إلى المشرف (أولوية عالية)' : 'أُسندت المحادثة إلى الموظّف',
    null,
  );

  // ⑥ التقدّم إلى `pending` — المشرف (صلاحية `conversation.state.update`).
  const advanceCtx = this.#context('supervisor', conversationRef, 'conversation.state.update');
  if (!advanceCtx) {
    return this.#outcome(
      false,
      'context_denied',
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
      reply,
      'assigned',
      assignee,
    );
  }
  try {
    updateConversationState(advanceCtx, conversationRef, 'pending', this.#deps, {
      reason: 'بانتظار ردّ العميل',
    });
  } catch (error) {
    const code = this.#codeOf(error);
    this.#record('reject', 'تعذّر تحديث حالة المحادثة', code);
    return this.#outcome(
      false,
      code,
      conversationRef,
      fromStep,
      classification.intent,
      classification.priority,
      reply,
      'assigned',
      assignee,
    );
  }
  this.#record('advance', 'تقدّمت الحالة إلى «pending»', null);

  return this.#outcome(
    true,
    null,
    conversationRef,
    fromStep,
    classification.intent,
    classification.priority,
    reply,
    'pending',
    assignee,
  );
}

/**
 * ⭐⭐⭐⭐⭐ **تغيير حالة المحادثة** — ⭐ **المشرف أو المالك** (بحسب الصلاحية).
 * ⭐⭐⭐ **انتقال غير مسموح أو حالة نهائية ⇒ رفض من النواة** (لا منطق موازٍ).
 */
advance(
  conversationRef: string,
  to: string,
  actor: JourneyActor = 'supervisor',
): JourneyOutcome {
  const fromStep = this.#steps.length;
  if (!this.#identityGate(actor)) {
    return this.#outcome(false, 'identity_issuer_unverified', conversationRef, fromStep);
  }
  const ctx = this.#context(actor, conversationRef, 'conversation.state.update');
  if (!ctx) {
    return this.#outcome(false, 'context_denied', conversationRef, fromStep);
  }
  try {
    updateConversationState(ctx, conversationRef, to as never, this.#deps, {
      reason: 'تحديث حالة الرحلة',
    });
  } catch (error) {
    const code = this.#codeOf(error);
    this.#record('reject', `تعذّر الانتقال إلى «${to}»`, code);
    return this.#outcome(false, code, conversationRef, fromStep);
  }
  this.#record('advance', `تقدّمت الحالة إلى «${to}»`, null);
  return this.#outcome(true, null, conversationRef, fromStep, null, null, null, to, null);
}

/**
 * ⭐⭐⭐⭐⭐ **إغلاق المحادثة** — ⭐ `resolved ⇒ closed` ⇒ ⭐ **حالة نهائية**.
 */
close(conversationRef: string): JourneyOutcome {
  const fromStep = this.#steps.length;
  if (!this.#identityGate('owner')) {
    return this.#outcome(false, 'identity_issuer_unverified', conversationRef, fromStep);
  }
  const ctx = this.#context('owner', conversationRef, 'conversation.state.update');
  if (!ctx) {
    return this.#outcome(false, 'context_denied', conversationRef, fromStep);
  }
  try {
    updateConversationState(ctx, conversationRef, 'closed', this.#deps, {
      reason: 'إغلاق نهائي بعد الحل',
    });
  } catch (error) {
    const code = this.#codeOf(error);
    this.#record('reject', 'تعذّر الإغلاق', code);
    return this.#outcome(false, code, conversationRef, fromStep);
  }
  this.#record('advance', 'أُغلقت المحادثة (حالة نهائية)', null);
  return this.#outcome(true, null, conversationRef, fromStep, null, null, null, 'closed', null);
}

/** ⭐⭐⭐ **سجلّ الخطوات** — ⭐ (نسخة · في الذاكرة). */
steps(): readonly JourneyStep[] {
  return this.#steps.map((step) => ({ ...step }));
}

/** ⭐⭐⭐ **آخر نتيجة** — ⭐ (نسخة). */
lastOutcome(): JourneyOutcome | null {
  return this.#last;
}

/** ⭐⭐⭐ **حالة المحادثة** — ⭐ (من متجر الحالة). */
conversationState(conversationRef: string): string | null {
  const ctx = this.#context('owner', conversationRef, 'conversation.state.read');
  if (!ctx) return null;
  try {
    return this.#deps.states.get(ctx, conversationRef)?.state ?? null;
  } catch {
    return null;
  }
}

/** ⭐⭐⭐ **رسائل المحادثة** — ⭐ (نصّ محلي · لأغراض الفحص فقط). */
messages(conversationRef: string): readonly { direction: string; body: string }[] {
  const ctx = this.#context('owner', conversationRef, 'conversation.read');
  if (!ctx) return [];
  return this.#deps.store
    .list(ctx, { limit: 100 })
    .filter((row) => row.conversation_ref === conversationRef)
    .map((row) => ({ direction: row.direction, body: row.body }));
}
}
