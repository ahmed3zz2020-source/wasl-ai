// ============================================================
// WASL AI — FOUNDATION BUILD 01 — local HTTP API
// ------------------------------------------------------------
// ⭐ A local backend that USES the core (it never re-implements it):
//   the core decides the capability and the state machine, this layer
//   only moves data in and out of PostgreSQL.
// ⭐ Every request:
//   1) resolves the session (database proof, not a client claim)
//   2) loads the tenant memberships (role comes from the database)
//   3) asks the core for a decision (authorizeLocalRequest)
//   4) runs the core operation
//   5) persists the result in ONE transaction
// ⛔ Bind address is 127.0.0.1 only. There is no public route and no
//   outbound call except the local PostgreSQL connection.
// ============================================================

import http from 'node:http';
import crypto from 'node:crypto';
import type { ServerConfig } from '../config.ts';
import type { PgPool } from '../db/pool.ts';
import { UnitOfWork } from '../db/unit-of-work.ts';
import {
  createBundle,
  resetCaptures,
  type TenantBundle,
} from '../db/repositories/core-bundle.ts';
import {
  hydrateConversation,
  hydrateEmployees,
  persistBundle,
} from '../db/repositories/persistence.ts';
import {
  buildMirror,
  membershipSignature,
  type MembershipRow,
  type TenantIdentityMirror,
} from '../auth/registry.ts';
import { login, resolveSession, revokeSession, SessionError } from '../auth/sessions.ts';
import {
  assertCapability,
  authorizeLocalRequest,
  updateConversationState,
  assignConversation,
  type LocalAuthorizationOperation,
  type TenantContext,
  type TrustedRole,
} from '../../src/core/index.ts';
import { classifyJourneyMessage, renderJourneyReply } from '../../src/local/journey/classification.ts';
import {
  exportTenantData,
  executeDeletion,
  previewDeletion,
  upsertRetentionPolicy,
  listRetentionPolicies,
  type DataClass,
} from '../policy/retention.ts';

const MAX_BODY_BYTES = 64 * 1024;
const SCOPE_REF = 'tenant-scope';

export interface ApiServerOptions {
  readonly config: ServerConfig;
  readonly pool: PgPool;
}

interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

interface RequestContext {
  readonly session: {
    sessionId: string;
    tenantId: string;
    userId: string;
    membershipId: string;
    role: string;
    actorId: string;
    expiresAt: string;
  };
  readonly bundle: TenantBundle;
  readonly mirror: TenantIdentityMirror;
  readonly memberships: MembershipRow[];
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw: string): unknown {
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('json_invalid');
  }
}

/** ⭐ Map a database error to a safe, declared answer (no SQL text leaks). */
function databaseStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  if (code === '23503') return 409; // foreign key violation
  if (code === '23505') return 409; // unique violation
  if (code === '23502' || code === '23514') return 400; // not null / check violation
  if (code === '22P02' || code === '22007') return 400; // invalid input syntax
  return null;
}

/** ⭐ The declared code of an error (machine readable), never a raw message. */
function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return error instanceof Error ? error.message : 'internal_error';
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldInvalidate(error: unknown): boolean {
  // ⭐ A database error (no declared code) means the write did not
  //   happen, so the in-memory bundle may be ahead of the database.
  // ⭐ A core rejection carries a code: it is an answer, not a fault.
  if (typeof error !== 'object' || error === null) return true;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return true;
  return code === 'state_conflict';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class WaslApiServer {
  readonly #config: ServerConfig;
  readonly #pool: PgPool;
  readonly #bundles = new Map<string, TenantBundle>();
  readonly #mirrors = new Map<string, TenantIdentityMirror>();
  #server: http.Server | null = null;

  constructor(options: ApiServerOptions) {
    this.#config = options.config;
    this.#pool = options.pool;
  }

  // ------------------------------------------------------------ lifecycle
  async listen(): Promise<{ host: string; port: number }> {
    const server = http.createServer((req, res) => {
      void this.#dispatch(req, res);
    });
    server.on('clientError', (_err, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#config.port, this.#config.host, () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : this.#config.port;
    return { host: this.#config.host, port };
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ------------------------------------------------------------- helpers
  #bundleFor(tenantId: string): TenantBundle {
    let bundle = this.#bundles.get(tenantId);
    if (!bundle) {
      bundle = createBundle(tenantId);
      this.#bundles.set(tenantId, bundle);
    }
    return bundle;
  }

  /** ⭐ Drop the in-memory bundle (used when a write could not be persisted). */
  #invalidate(tenantId: string): void {
    this.#bundles.delete(tenantId);
    this.#mirrors.delete(tenantId);
  }

  async #loadMemberships(tenantId: string): Promise<MembershipRow[]> {
    return UnitOfWork.run(this.#pool, tenantId, async (uow) => {
      const result = await uow.query<{
        membership_id: string;
        user_id: string;
        role: string;
        status: string;
      }>(
        `select id as membership_id, user_id, role, status from memberships where tenant_id = $1`,
        [tenantId],
      );
      return result.rows.map((row) => ({
        membership_id: row.membership_id,
        user_id: row.user_id,
        role: row.role as TrustedRole,
        status: row.status,
      }));
    });
  }

  #mirrorFor(tenantId: string, memberships: readonly MembershipRow[]): TenantIdentityMirror {
    const signature = membershipSignature(tenantId, memberships);
    const existing = this.#mirrors.get(tenantId);
    if (existing && existing.signature === signature) return existing;
    const built = buildMirror(tenantId, memberships);
    if (!built) {
      throw new SessionError('membership_owner_missing', 403, 'tenant has no active owner');
    }
    this.#mirrors.set(tenantId, built);
    return built;
  }

  async #requestContext(req: http.IncomingMessage): Promise<RequestContext> {
    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw || !raw.toLowerCase().startsWith('bearer ')) {
      throw new SessionError('token_missing', 401, 'bearer token is required');
    }
    const token = raw.slice(7).trim();
    const session = await resolveSession(this.#pool, token);
    const memberships = await this.#loadMemberships(session.tenantId);
    const mirror = this.#mirrorFor(session.tenantId, memberships);
    const bundle = this.#bundleFor(session.tenantId);
    return { session, bundle, mirror, memberships };
  }

  /**
   * ⭐ Ask the core for the decision. The client never names a role.
   */
  #authorize(
    context: RequestContext,
    operation: LocalAuthorizationOperation,
    conversationRef: string,
    extra?: Record<string, unknown>,
  ): { allowed: true; context: TenantContext } | { allowed: false; code: string; reason: string } {
    const decision = authorizeLocalRequest(
      {
        identity_id: context.session.membershipId,
        conversation_ref: conversationRef,
        operation,
        declared_tenant_id: context.session.tenantId,
        ...(extra ?? {}),
      },
      {
        registry: context.mirror.registry,
        sources: context.mirror.sources,
        now: () => new Date().toISOString(),
      },
    );
    if (decision.allowed) return { allowed: true, context: decision.context };
    return { allowed: false, code: decision.code, reason: decision.reason };
  }

  async #audit(
    tenantId: string,
    actorId: string,
    sessionId: string | null,
    operation: string,
    result: 'allowed' | 'denied',
    code: string | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await UnitOfWork.run(this.#pool, tenantId, async (uow) => {
      await uow.query(
        `insert into audit_events (tenant_id, actor_id, session_id, operation, result, code, detail)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [tenantId, actorId, sessionId, operation, result, code, JSON.stringify(detail)],
      );
    });
  }

  // ------------------------------------------------------------ dispatch
  async #dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      const response = await this.#route(method, url, req);
      this.#send(res, response.status, response.body);
    } catch (error) {
      const database = databaseStatus(error);
      const status =
        error instanceof SessionError
          ? error.status
          : error instanceof Error && error.message === 'json_invalid'
            ? 400
            : error instanceof Error && error.message === 'body_too_large'
              ? 413
              : database ?? 500;
      const code = errorCodeOf(error);
      this.#send(res, status, { ok: false, error: { code, message: errorMessageOf(error) } });
    }
  }

  #send(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    });
    res.end(payload);
  }

  async #route(method: string, url: URL, req: http.IncomingMessage): Promise<JsonResponse> {
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'GET' && (path === '/' || path === '/health')) {
      return { status: 200, body: { ok: true, service: 'wasl-local-api', scope: 'local-test' } };
    }
    if (method === 'GET' && path === '/ui' || path === '/ui/') {
      return { status: 200, body: { ok: true, ui: '/ui/index.html' } };
    }
    if (method === 'POST' && path === '/api/session') {
      return this.#login(req);
    }

    const segments = path.split('/').filter((part) => part.length > 0);
    if (segments[0] !== 'api') {
      return { status: 404, body: { ok: false, error: { code: 'route_not_found', message: path } } };
    }

    const context = await this.#requestContext(req);

    if (method === 'GET' && path === '/api/session') {
      return {
        status: 200,
        body: {
          ok: true,
          session: {
            tenant_id: context.session.tenantId,
            user_id: context.session.userId,
            membership_id: context.session.membershipId,
            role: context.session.role,
            expires_at: context.session.expiresAt,
          },
        },
      };
    }
    if (method === 'DELETE' && path === '/api/session') {
      const revoked = await revokeSession(
        this.#pool,
        context.session.tenantId,
        context.session.sessionId,
        'logout',
      );
      return { status: 200, body: { ok: true, revoked } };
    }
    if (method === 'GET' && path === '/api/conversations') {
      return this.#listConversations(context);
    }
    if (method === 'POST' && path === '/api/conversations') {
      return this.#createConversation(context, req);
    }
    if (method === 'GET' && path === '/api/customers') {
      return this.#listCustomers(context);
    }
    if (method === 'POST' && path === '/api/customers') {
      return this.#createCustomer(context, req);
    }
    if (method === 'GET' && path === '/api/audit') {
      return this.#readAudit(context);
    }
    if (method === 'GET' && path === '/api/retention') {
      return this.#readRetention(context);
    }
    if (method === 'POST' && path === '/api/retention') {
      return this.#writeRetention(context, req);
    }
    if (method === 'POST' && path === '/api/privacy/export') {
      return this.#exportData(context);
    }
    if (method === 'POST' && path === '/api/privacy/deletion/preview') {
      return this.#previewDeletion(context, req);
    }
    if (method === 'POST' && path === '/api/privacy/deletion/execute') {
      return this.#executeDeletion(context, req);
    }

    if (segments[1] === 'conversations' && segments[2]) {
      const ref = decodeURIComponent(segments[2]);
      if (method === 'GET' && segments.length === 3) {
        return this.#readConversation(context, ref);
      }
      if (method === 'GET' && segments[3] === 'messages') {
        return this.#readMessages(context, ref);
      }
      if (method === 'POST' && segments[3] === 'messages') {
        return this.#appendMessage(context, ref, req);
      }
      if (method === 'GET' && segments[3] === 'changes') {
        return this.#readChanges(context, ref);
      }
      if (method === 'POST' && segments[3] === 'state') {
        return this.#updateState(context, ref, req);
      }
      if (method === 'POST' && segments[3] === 'assign') {
        return this.#assign(context, ref, req);
      }
    }

    return { status: 404, body: { ok: false, error: { code: 'route_not_found', message: path } } };
  }

  // ------------------------------------------------------------ handlers
  async #login(req: http.IncomingMessage): Promise<JsonResponse> {
    const body = asRecord(parseJson(await readBody(req)));
    const tenantId = asString(body['tenant_id']);
    const userId = asString(body['user_id']);
    const passcode = asString(body['passcode']);
    if (!tenantId || !userId || !passcode) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'login_input_invalid', message: 'tenant_id, user_id and passcode are required' } },
      };
    }
    const result = await login(this.#pool, { tenantId, userId, passcode }, this.#config.sessionTtlSeconds);
    return {
      status: 200,
      body: {
        ok: true,
        token: result.token,
        session: {
          tenant_id: result.session.tenantId,
          user_id: result.session.userId,
          membership_id: result.session.membershipId,
          role: result.session.role,
          expires_at: result.session.expiresAt,
        },
      },
    };
  }

  async #listConversations(context: RequestContext): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.list', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.list', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const rows = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(
        `select ref, state, assignee_actor_id, version, updated_at from conversations order by updated_at desc limit 200`,
      );
      return result.rows;
    });
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.list', 'allowed', null, { count: rows.length });
    return { status: 200, body: { ok: true, conversations: rows } };
  }

  async #readConversation(context: RequestContext, ref: string): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.read', ref);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.read', 'denied', decision.code, { target: ref });
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const row = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(
        `select ref, customer_id, state, assignee_actor_id, version, updated_at from conversations where ref = $1`,
        [ref],
      );
      return result.rows[0] ?? null;
    });
    if (!row) {
      return { status: 404, body: { ok: false, error: { code: 'conversation_not_found', message: ref } } };
    }
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.read', 'allowed', null, { target: ref });
    return { status: 200, body: { ok: true, conversation: row } };
  }

  async #readMessages(context: RequestContext, ref: string): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.read', ref);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.read', 'denied', decision.code, { target: ref });
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const rows = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(
        `select message_ref, conversation_ref, channel, direction, sender, recipient, body, occurred_at, stored_at
           from messages where conversation_ref = $1 order by occurred_at asc`,
        [ref],
      );
      return result.rows;
    });
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.read', 'allowed', null, { target: ref, count: rows.length });
    return { status: 200, body: { ok: true, messages: rows } };
  }

  async #readChanges(context: RequestContext, ref: string): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.changes', ref);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.changes', 'denied', decision.code, { target: ref });
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const rows = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(
        `select id, conversation_ref, operation, from_state, to_state, actor_id, reason, occurred_at
           from conversation_changes where conversation_ref = $1 order by id asc`,
        [ref],
      );
      return result.rows;
    });
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.changes', 'allowed', null, { target: ref, count: rows.length });
    return { status: 200, body: { ok: true, changes: rows } };
  }

  async #readAudit(context: RequestContext): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.audit', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.audit', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const rows = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(
        `select id, actor_id, session_id, operation, result, code, detail, occurred_at
           from audit_events order by id desc limit 200`,
      );
      return result.rows;
    });
    return { status: 200, body: { ok: true, audit: rows } };
  }

  async #listCustomers(context: RequestContext): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.list', SCOPE_REF);
    if (!decision.allowed) {
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const rows = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(`select id, display_name, data_class, created_at from customers order by id asc`);
      return result.rows;
    });
    return { status: 200, body: { ok: true, customers: rows } };
  }

  async #createCustomer(context: RequestContext, req: http.IncomingMessage): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'customer.create', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'customer.create', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const displayName = asString(body['display_name']);
    if (!displayName) {
      return { status: 400, body: { ok: false, error: { code: 'display_name_required', message: 'display_name is required' } } };
    }
    const dataClass = asString(body['data_class']) ?? 'standard';
    const id = asString(body['id']) ?? `cus_${crypto.randomBytes(6).toString('hex')}`;
    const row = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const result = await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class) values ($1,$2,$3,$4)
         on conflict (id) do update set display_name = excluded.display_name, data_class = excluded.data_class
         returning id, display_name, data_class, created_at`,
        [id, context.session.tenantId, displayName, dataClass],
      );
      return result.rows[0] ?? null;
    });
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'customer.create', 'allowed', null, { id });
    return { status: 201, body: { ok: true, customer: row } };
  }

  async #createConversation(context: RequestContext, req: http.IncomingMessage): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.create', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.create', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const ref = asString(body['conversation_ref']) ?? `conv_${crypto.randomBytes(6).toString('hex')}`;
    const customerId = asString(body['customer_id']);
    const message = asRecord(body['message']);

    const bundle = context.bundle;
    resetCaptures(bundle);
    try {
      const created = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        const inserted = await uow.query(
          `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
           values ($1,$2,$3,'new',1, now())
           on conflict (tenant_id, ref) do nothing
           returning ref, customer_id, state, assignee_actor_id, version, updated_at`,
          [context.session.tenantId, ref, customerId],
        );
        if (inserted.rowCount === 0) {
          throw new Error('conversation_exists');
        }
        bundle.states.ensure(decision.context, ref);
        const hasMessage = Object.keys(message).length > 0;
        const text = asString(message['body']);
        if (hasMessage) {
          // ⭐ The core contract validates the envelope: an empty body
          //   is refused, and the whole unit of work rolls back.
          const outcome = bundle.store.append(decision.context, {
            schema_version: '1',
            message_ref: asString(message['message_ref']) ?? `msg_${crypto.randomBytes(8).toString('hex')}`,
            conversation_ref: ref,
            declared_tenant_id: context.session.tenantId,
            channel: 'web',
            direction: 'inbound',
            from: asString(message['from']) ?? 'customer@example.invalid',
            to: 'agent@example.invalid',
            body: text,
            occurred_at: new Date().toISOString(),
            locale: 'ar',
            attributes: { source: 'api' },
          });
          if (outcome.status !== 'accepted') {
            throw new Error(`message_${outcome.status}`);
          }
          await persistBundle(uow, bundle);
        }
        return inserted.rows[0] ?? null;
      });
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.create', 'allowed', null, { ref });
      return { status: 201, body: { ok: true, conversation: created } };
    } catch (error) {
      // ⭐ A rejection by the core is a business answer, not a broken
      //   write: the in-memory bundle stays valid. Only a persistence
      //   failure drops it, so the next request re-hydrates.
      if (shouldInvalidate(error)) this.#invalidate(context.session.tenantId);
      const code = errorCodeOf(error);
      const status = code === 'conversation_exists' ? 409 : 500;
      return { status, body: { ok: false, error: { code, message: code } } };
    }
  }

  async #appendMessage(
    context: RequestContext,
    ref: string,
    req: http.IncomingMessage,
  ): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.write', ref);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.write', 'denied', decision.code, { target: ref });
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const text = asString(body['body']);
    if (!text) {
      return { status: 400, body: { ok: false, error: { code: 'body_required', message: 'body is required' } } };
    }
    const bundle = context.bundle;
    resetCaptures(bundle);

    const classification = classifyJourneyMessage(text);
    const reply = renderJourneyReply(classification);

    try {
      const result = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        await hydrateEmployees(uow, bundle);
        const exists = await hydrateConversation(uow, bundle, decision.context, ref);
        if (!exists) {
          throw new Error('conversation_not_found');
        }
        const inbound = bundle.store.append(decision.context, {
          schema_version: '1',
          message_ref: asString(body['message_ref']) ?? `msg_${crypto.randomBytes(8).toString('hex')}`,
          conversation_ref: ref,
          declared_tenant_id: context.session.tenantId,
          channel: 'web',
          direction: 'inbound',
          from: asString(body['from']) ?? 'customer@example.invalid',
          to: 'agent@example.invalid',
          body: text,
          occurred_at: new Date().toISOString(),
          locale: 'ar',
          attributes: { source: 'api' },
        });
        if (inbound.status !== 'accepted') {
          throw new Error(`message_${inbound.status}`);
        }
        // The local reply is STORED, never sent: no external call exists.
        const outbound = bundle.store.append(decision.context, {
          schema_version: '1',
          message_ref: `reply_${crypto.randomBytes(8).toString('hex')}`,
          conversation_ref: ref,
          declared_tenant_id: context.session.tenantId,
          channel: 'web',
          direction: 'outbound',
          from: 'agent@example.invalid',
          to: 'customer@example.invalid',
          body: reply,
          occurred_at: new Date().toISOString(),
          locale: 'ar',
          attributes: { source: 'local-rules', sent: 'false' },
        });
        if (outbound.status !== 'accepted') {
          throw new Error(`message_${outbound.status}`);
        }
        await persistBundle(uow, bundle);
        return { inbound: inbound.message, outbound: outbound.status === 'accepted' ? outbound.message : null };
      });
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.write', 'allowed', null, { target: ref });
      return {
        status: 201,
        body: {
          ok: true,
          message: result.inbound,
          reply: result.outbound,
          reply_sent: false,
          classification: {
            intent: classification.intent,
            priority: classification.priority,
            engine: 'local-rules (not an AI model)',
          },
        },
      };
    } catch (error) {
      // ⭐ A rejection by the core is a business answer, not a broken
      //   write: the in-memory bundle stays valid. Only a persistence
      //   failure drops it, so the next request re-hydrates.
      if (shouldInvalidate(error)) this.#invalidate(context.session.tenantId);
      const code = errorCodeOf(error);
      const status = code === 'conversation_not_found' ? 404 : 500;
      return { status, body: { ok: false, error: { code, message: code } } };
    }
  }

  async #updateState(
    context: RequestContext,
    ref: string,
    req: http.IncomingMessage,
  ): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.state.update', ref);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.state.update', 'denied', decision.code, { target: ref });
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const to = asString(body['to']);
    if (!to) {
      return { status: 400, body: { ok: false, error: { code: 'target_state_required', message: 'to is required' } } };
    }
    const expected = typeof body['expected_version'] === 'number' ? body['expected_version'] : null;
    const bundle = context.bundle;
    resetCaptures(bundle);

    try {
      const view = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        await hydrateEmployees(uow, bundle);
        const exists = await hydrateConversation(uow, bundle, decision.context, ref);
        if (!exists) {
          throw new Error('conversation_not_found');
        }
        if (expected !== null) {
          const current = await uow.query<{ version: number }>(
            `select version from conversations where tenant_id = $1 and ref = $2 for update`,
            [context.session.tenantId, ref],
          );
          const version = current.rows[0]?.version ?? null;
          if (version === null) {
            throw new Error('conversation_not_found');
          }
          if (version !== expected) {
            throw new Error('state_conflict');
          }
        }
        const memory = bundle.states.get(decision.context, ref);
        const updated = updateConversationState(
          decision.context,
          ref,
          to as never,
          {
            store: bundle.store,
            states: bundle.states,
            changes: bundle.changes,
            readAudit: bundle.readAudit,
            employees: bundle.employees,
          },
          { reason: asString(body['reason']) ?? '', ...(memory ? { expectedVersion: memory.version } : {}) },
        );
        await persistBundle(uow, bundle);
        return updated;
      });
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.state.update', 'allowed', null, { target: ref, to });
      return { status: 200, body: { ok: true, conversation: view } };
    } catch (error) {
      // ⭐ A rejection by the core is a business answer, not a broken
      //   write: the in-memory bundle stays valid. Only a persistence
      //   failure drops it, so the next request re-hydrates.
      if (shouldInvalidate(error)) this.#invalidate(context.session.tenantId);
      const code = errorCodeOf(error);
      const status =
        code === 'conversation_not_found'
          ? 404
          : code === 'state_conflict'
            ? 409
            : code === 'transition_not_allowed' || code === 'state_terminal' || code === 'transition_requires_assignee'
              ? 409
              : 400;
      return { status, body: { ok: false, error: { code, message: code } } };
    }
  }

  async #assign(
    context: RequestContext,
    ref: string,
    req: http.IncomingMessage,
  ): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.assign', ref);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.assign', 'denied', decision.code, { target: ref });
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const assignee = asString(body['actor_id']);
    if (!assignee) {
      return { status: 400, body: { ok: false, error: { code: 'actor_id_required', message: 'actor_id is required' } } };
    }
    const bundle = context.bundle;
    resetCaptures(bundle);

    try {
      const view = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        await hydrateEmployees(uow, bundle);
        const exists = await hydrateConversation(uow, bundle, decision.context, ref);
        if (!exists) {
          throw new Error('conversation_not_found');
        }
        const updated = assignConversation(
          decision.context,
          ref,
          assignee,
          {
            store: bundle.store,
            states: bundle.states,
            changes: bundle.changes,
            readAudit: bundle.readAudit,
            employees: bundle.employees,
          },
          { reason: asString(body['reason']) ?? '' },
        );
        await persistBundle(uow, bundle);
        return updated;
      });
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'conversation.assign', 'allowed', null, { target: ref, assignee });
      return { status: 200, body: { ok: true, conversation: view } };
    } catch (error) {
      // ⭐ A rejection by the core is a business answer, not a broken
      //   write: the in-memory bundle stays valid. Only a persistence
      //   failure drops it, so the next request re-hydrates.
      if (shouldInvalidate(error)) this.#invalidate(context.session.tenantId);
      const code = errorCodeOf(error);
      const status =
        code === 'conversation_not_found'
          ? 404
          : code === 'assignee_not_in_tenant' || code === 'transition_not_allowed' || code === 'state_terminal'
            ? 409
            : 400;
      return { status, body: { ok: false, error: { code, message: code } } };
    }
  }

  async #readRetention(context: RequestContext): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'retention.read', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'retention.read', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const policies = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) => listRetentionPolicies(uow));
    return { status: 200, body: { ok: true, policies, note: 'synthetic test values, not approved retention periods' } };
  }

  async #writeRetention(context: RequestContext, req: http.IncomingMessage): Promise<JsonResponse> {
    // The retention configuration is an owner-only privacy administration
    // operation, so it shares the owner-only privacy capability.
    const decision = this.#authorize(context, 'privacy.delete', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'retention.write', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const policy = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) =>
      upsertRetentionPolicy(uow, context.session.tenantId, {
        dataClass: asString(body['data_class']) as DataClass,
        retentionDays: Number(body['retention_days'] ?? 0),
        onCancel: body['on_cancel'] === 'delete' ? 'delete' : 'retain',
      }),
    );
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'retention.write', 'allowed', null, { data_class: policy.dataClass });
    return { status: 200, body: { ok: true, policy } };
  }

  async #exportData(context: RequestContext): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'privacy.export', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'privacy.export', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const bundle = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) => exportTenantData(uow, context.session.tenantId));
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'privacy.export', 'allowed', null, { messages: bundle.messages.length });
    return { status: 200, body: { ok: true, export: bundle } };
  }

  async #previewDeletion(context: RequestContext, req: http.IncomingMessage): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'privacy.delete', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'privacy.delete.preview', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const scope = asString(body['scope']) ?? 'tenant_data';
    const preview = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      previewDeletion(uow, context.session.tenantId, context.session.actorId, scope),
    );
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'privacy.delete.preview', 'allowed', null, { scope });
    return { status: 200, body: { ok: true, preview } };
  }

  async #executeDeletion(context: RequestContext, req: http.IncomingMessage): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'privacy.delete', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'privacy.delete.execute', 'denied', decision.code, {});
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const requestId = asString(body['request_id']);
    if (!requestId) {
      return { status: 400, body: { ok: false, error: { code: 'request_id_required', message: 'request_id is required' } } };
    }
    const removed = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      executeDeletion(uow, context.session.tenantId, requestId, context.session.actorId),
    );
    this.#invalidate(context.session.tenantId);
    await this.#audit(context.session.tenantId, context.session.actorId, context.session.sessionId, 'privacy.delete.execute', 'allowed', null, { request_id: requestId });
    return { status: 200, body: { ok: true, removed } };
  }
}
