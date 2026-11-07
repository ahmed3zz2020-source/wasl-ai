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
import fs from 'node:fs';
import nodePath from 'node:path';
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
  lockConversationRow,
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
  admitLoginAttempt,
  clearLoginFailures,
  readRateLimitState,
  recordLoginFailure,
} from '../auth/rate-limit.ts';
import { createLogger, type Logger } from '../log.ts';
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
import { ALLOWED_TRANSITIONS } from '../../src/core/conversation-state.ts';
import {
  isInboxState,
  listInboxAgents,
  listInboxConversations,
  readInboxConversation,
  type InboxFilters,
  type InboxState,
} from '../inbox/queries.ts';
import {
  listCustomers,
  readCustomer,
  updateCustomer,
  type CrmCustomerFilters,
} from '../crm/queries.ts';
import {
  exportTenantData,
  executeDeletion,
  previewDeletion,
  readDeletionReceipt,
  upsertRetentionPolicy,
  listRetentionPolicies,
  type DataClass,
} from '../policy/retention.ts';
import {
  listTickets,
  readTicket,
  readTicketChanges,
  readCustomerTickets,
  readTicketForUpdate,
  readTicketByRef,
  type TicketFilters,
  type TicketScope,
} from '../tickets/queries.ts';
import {
  assertTicketTransition,
  isTicketPriority,
  isTicketState,
  TicketStateError,
} from '../tickets/states.ts';
import {
  coreOperationOf,
  TicketPolicyError,
} from '../tickets/policy.ts';

const MAX_BODY_BYTES = 64 * 1024;

/** ⭐ A wait that does not block the event loop (the admission control). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
const SCOPE_REF = 'tenant-scope';

/**
 * ⭐ The local console is served by the same process that serves the
 * API, so the page is connected to the real backend and not a static
 * preview. The file list is an allow list: no path traversal.
 */
const UI_FILES: Readonly<Record<string, { file: string; type: string }>> = Object.freeze({
  '/ui/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/ui/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/ui/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
  // ⭐⭐ D-070: the customer inbox (the work surface of the service).
  '/ui/inbox.html': { file: 'inbox.html', type: 'text/html; charset=utf-8' },
  '/ui/inbox.js': { file: 'inbox.js', type: 'text/javascript; charset=utf-8' },
  '/ui/inbox.css': { file: 'inbox.css', type: 'text/css; charset=utf-8' },
  // ⭐⭐ D-071: the customer CRM (the second page of the work).
  '/ui/crm.html': { file: 'crm.html', type: 'text/html; charset=utf-8' },
  '/ui/crm.js': { file: 'crm.js', type: 'text/javascript; charset=utf-8' },
  '/ui/crm.css': { file: 'crm.css', type: 'text/css; charset=utf-8' },

  // ⭐⭐ D-073: the support tickets.
  '/ui/tickets.html': { file: 'tickets.html', type: 'text/html; charset=utf-8' },
  '/ui/tickets.js': { file: 'tickets.js', type: 'text/javascript; charset=utf-8' },
  '/ui/tickets.css': { file: 'tickets.css', type: 'text/css; charset=utf-8' },
});

const UI_DIR = nodePath.join(nodePath.resolve(import.meta.dirname, '..'), 'ui');

export interface ApiServerOptions {
  readonly config: ServerConfig;
  readonly pool: PgPool;
}

interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
  readonly contentType?: string;
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

/** ⭐ Map a policy error to a declared status. */
function policyStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as { name?: unknown }).name;
  if (name !== 'PolicyError') return null;
  const code = (error as { code?: unknown }).code;
  if (code === 'deletion_request_unknown') return 404;
  if (code === 'deletion_already_executed') return 409;
  return 400;
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

/**
 * ⭐⭐ D-069 / M67: the peer address of the SOCKET.
 * ⛔ X-Forwarded-For (and every other client sent header) is NEVER
 *   read: the client chooses its value, so trusting it would move the
 *   limit to the attacker. The only address this server sees is the
 *   one of the TCP peer.
 */
function peerAddressOf(req: http.IncomingMessage): string | null {
  const address = req.socket.remoteAddress;
  if (typeof address !== 'string' || address === '') return null;
  // The IPv4 mapped IPv6 form of the loopback is normalized.
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/** ⭐ The request id: the caller's one when it is safe, a new one otherwise. */
function requestIdOf(req: http.IncomingMessage): string {
  const header = req.headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value)) return value;
  return `req_${crypto.randomBytes(8).toString('hex')}`;
}

export class WaslApiServer {
  readonly #config: ServerConfig;
  readonly #pool: PgPool;
  /**
   * ⭐⭐ D-069 / M66: there is NO per company bundle any more.
   *   The bundle used to live for the whole life of the PROCESS, so a
   *   conversation that was hydrated once was never read again and a
   *   second backend instance worked on a stale conversation.
   *   ⭐ The bundle is now a PER OPERATION scratchpad: it is created
   *     for one request, filled from PostgreSQL inside the request
   *     transaction and thrown away with it.
   *   ⭐ Nothing that is shared between two requests is kept in memory:
   *     the messages, the state, the version and the membership roles
   *     are read from the database every time.
   */
  readonly #mirrors = new Map<string, TenantIdentityMirror>();
  /** ⭐ One queue per company (the in-memory bundle is per company). */
  readonly #tenantLocks = new Map<string, Promise<void>>();
  /** ⭐ The structured log (one JSON line per request). */
  readonly #logger: Logger;
  /** ⭐ When the process started (the health check reports the uptime). */
  readonly #startedAt = Date.now();
  #server: http.Server | null = null;

  constructor(options: ApiServerOptions) {
    this.#config = options.config;
    this.#pool = options.pool;
    this.#logger = createLogger({
      level: options.config.logLevel,
      service: 'wasl-local-api',
    });
    // ⭐ A dropped connection is an event, not a crash: without this
    //   listener the pool would raise an unhandled error and could stop
    //   the process. The log carries the event and nothing else.
    options.pool.on('error', () => {
      this.#logger.error('pool_error', { code: 'pool_error' });
    });
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
  /**
   * ⭐⭐ D-069 / M66: a FRESH bundle per operation.
   *   ⭐ The bundle is a scratchpad, not a cache: it holds what the
   *     core produced during this operation and it dies with it.
   *   ⭐ The memory is never reused across requests, so no request can
   *     read a value that another instance has already replaced.
   */
  #newBundle(tenantId: string): TenantBundle {
    return createBundle(tenantId);
  }

  /**
   * ⭐ Drop the cached identity mirror (the memberships are re-read on
   *   every request, so the mirror is rebuilt when they change).
   */
  #invalidate(tenantId: string): void {
    this.#mirrors.delete(tenantId);
  }

  /**
   * ⭐⭐ Serialize the operations of ONE company.
   * ⭐ The in-memory bundle is a per tenant structure: its state rows
   *   and its capture buffers are mutated in place. Two requests of the
   *   same company running at the same time would read and clear each
   *   other's captures, so a valid update could be refused with a
   *   conflict that never existed (measured: both requests answered
   *   `state_conflict` and nothing was written).
   * ⭐ The lock is per tenant: two companies still run in parallel.
   */
  async #withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#tenantLocks.get(tenantId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tenantLocks.set(tenantId, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.#tenantLocks.get(tenantId) === current) this.#tenantLocks.delete(tenantId);
    }
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
    return { session, mirror, memberships };
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

  /**
   * ⭐⭐ M-76: the scope of the role on one conversation.
   * ⭐⭐ The rule is READ from the core work queue (`agent-queue.ts`):
   *   an AGENT reaches the conversations that are assigned to them,
   *   and nothing else. ⛔ It is not a new permission: the owner and
   *   the supervisor still reach the whole company, and the viewer
   *   keeps the read-only access the core grants.
   */
  #withinRoleScope(context: RequestContext, assigneeActorId: string | null): boolean {
    if (context.session.role !== 'agent') return true;
    return assigneeActorId === context.session.actorId;
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
    const startedAt = Date.now();
    const requestId = requestIdOf(req);
    try {
      const response = await this.#route(method, url, req);
      this.#send(res, response.status, response.body, response.contentType, requestId);
      this.#logger.info('http_request', {
        request_id: requestId,
        method,
        path: url.pathname,
        status: response.status,
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      const database = databaseStatus(error);
      const policy = policyStatus(error);
      const status =
        error instanceof SessionError
          ? error.status
          : error instanceof Error && error.message === 'json_invalid'
            ? 400
            : error instanceof Error && error.message === 'body_too_large'
              ? 413
              : policy ?? database ?? 500;
      const code = errorCodeOf(error);
      this.#send(res, status, { ok: false, error: { code, message: errorMessageOf(error) } }, requestId);
      // ⭐ The log carries the code and the status, never the message
      //   body and never the request content.
      // ⭐ A 4xx is an answer (the request was refused), a 5xx is a
      //   failure of the service: the two are not logged the same way.
      const fields = {
        request_id: requestId,
        method,
        path: url.pathname,
        status,
        code,
        duration_ms: Date.now() - startedAt,
      };
      if (status >= 500) this.#logger.error('http_request', fields);
      else this.#logger.warn('http_request', fields);
    }
  }

  #send(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    contentType?: string,
    requestId?: string,
  ): void {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string | number> = {
      'content-type': contentType ?? 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
      // ⛔ No CORS header: the API is not a public browser API.
    };
    if (requestId) headers['x-request-id'] = requestId;
    res.writeHead(status, headers);
    res.end(payload);
  }

  async #route(method: string, url: URL, req: http.IncomingMessage): Promise<JsonResponse> {
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'GET' && (path === '/' || path === '/health' || path === '/api/health')) {
      return this.#health();
    }
    // ⭐⭐ D-069 / M70: the readiness probe.
    // ⭐ Liveness (/health) answers "the process is alive".
    //   Readiness (/ready) answers "the service can serve a request":
    //   the database answers AND the schema is in place.
    // ⭐ The two are separate on purpose: a database that is down
    //   must not restart the process in a loop.
    if (method === 'GET' && (path === '/ready' || path === '/api/ready')) {
      return this.#ready();
    }
    if (method === 'GET' && (path === '/ui' || path === '/ui/')) {
      return { status: 200, body: { ok: true, ui: '/ui/index.html', connected: true } };
    }
    if (method === 'GET' && UI_FILES[path]) {
      const entry = UI_FILES[path]!;
      const content = fs.readFileSync(nodePath.join(UI_DIR, entry.file));
      return { status: 200, body: content.toString('utf8'), contentType: entry.type };
    }
    if (method === 'POST' && path === '/api/session') {
      return this.#login(req);
    }
    // ⭐⭐ D-069 / M68: the receipt of a deletion.
    // ⭐ It is answered BEFORE the session is resolved, because the
    //   full deletion removes the tenant with its session: the client
    //   that lost the answer has no session any more.
    // ⭐ The request id IS the capability: 128 random bits, never
    //   guessable, so the answer exposes nothing to anybody else.
    // ⛔ The answer holds no data of the tenant: only the state of
    //   the request and the proof of the deletion.
    if (method === 'POST' && path === '/api/privacy/deletion/status') {
      return this.#deletionStatus(req);
    }

    const segments = path.split('/').filter((part) => part.length > 0);
    if (segments[0] !== 'api') {
      return { status: 404, body: { ok: false, error: { code: 'route_not_found', message: path } } };
    }

    // ⭐⭐ D-069 / M68: the execution of a deletion accepts a
    //   session OR the request id alone.
    //   ⭐ With a valid session the deletion is executed (the owner).
    //   ⭐ Without one the answer is the RECEIPT of the request and
    //     NOTHING is deleted: the request id is the capability of the
    //     receipt, never of the execution. ⭐ A re-sent request after a
    //     deletion (the session is gone with the deletion) therefore
    //     gets the CONFIRMED answer of the first execution.
    if (method === 'POST' && path === '/api/privacy/deletion/execute') {
      try {
        const owner = await this.#requestContext(req);
        return await this.#withTenantLock(owner.session.tenantId, () =>
          this.#executeDeletion(owner, req),
        );
      } catch (error) {
        if (error instanceof SessionError && (error.status === 401 || error.status === 403)) {
          return this.#deletionReceiptOnly(req);
        }
        throw error;
      }
    }

    const context = await this.#requestContext(req);

    // ⭐ The routes that mutate the in-memory bundle of a company run
    //   one after the other: the bundle is a per company structure and
    //   two concurrent requests of the same company would read and
    //   clear each other's captures.
    const locked = (fn: () => Promise<JsonResponse>): Promise<JsonResponse> =>
      this.#withTenantLock(context.session.tenantId, fn);

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
      return locked(() => this.#createConversation(context, req));
    }
    if (method === 'GET' && path === '/api/customers') {
      return this.#listCustomers(context);
    }
    if (method === 'POST' && path === '/api/customers') {
      return locked(() => this.#createCustomer(context, req));
    }
    if (method === 'GET' && path === '/api/audit') {
      return this.#readAudit(context);
    }
    if (method === 'GET' && path === '/api/retention') {
      return this.#readRetention(context);
    }
    if (method === 'POST' && path === '/api/retention') {
      return locked(() => this.#writeRetention(context, req));
    }
    if (method === 'POST' && path === '/api/privacy/export') {
      return this.#exportData(context);
    }
    if (method === 'POST' && path === '/api/privacy/deletion/preview') {
      return locked(() => this.#previewDeletion(context, req));
    }

    // ⭐⭐ D-070: the customer inbox.
    // ⭐ The decisions are taken by the core (the same capabilities of
    //   the other routes): the inbox adds no permission of its own.
    if (segments[1] === 'inbox') {
      if (method === 'GET' && segments[2] === 'conversations' && segments.length === 3) {
        return this.#listInbox(context, url);
      }
      if (method === 'GET' && segments[2] === 'agents' && segments.length === 3) {
        return this.#listInboxAgents(context);
      }
      if (segments[2] === 'conversations' && segments[3]) {
        const ref = decodeURIComponent(segments[3]);
        if (method === 'GET' && segments.length === 4) {
          return this.#readInboxConversation(context, ref, url);
        }
        if (method === 'POST' && segments[4] === 'replies') {
          return locked(() => this.#sendReply(context, ref, req));
        }
        // ⭐ The assignment and the state reuse the handlers of the
        //   other routes: the core decides, exactly once.
        if (method === 'POST' && segments[4] === 'assign') {
          return locked(() => this.#assign(context, ref, req));
        }
        if (method === 'POST' && segments[4] === 'state') {
          return locked(() => this.#updateState(context, ref, req));
        }
      }
    }

    // ⭐⭐ D-071: the customer CRM.
    // ⭐ The decisions are taken by the core: `conversation.list` and
    //   `conversation.read` to read, and `customer.manage` (the core
    //   operation `customer.create`) to edit a customer.
    if (segments[1] === 'crm' && segments[2] === 'customers') {
      if (method === 'GET' && segments.length === 3) {
        return this.#listCrmCustomers(context, url);
      }
      if (segments[3]) {
        const customerId = decodeURIComponent(segments[3]);
        if (method === 'GET' && segments.length === 4) {
          return this.#readCrmCustomer(context, customerId);
        }
        if (method === 'PATCH' && segments.length === 4) {
          return locked(() => this.#updateCrmCustomer(context, customerId, req));
        }
      }
    }

    // ⭐⭐ D-073: the Customer Support Tickets.
    // ⭐ The decisions are taken by the core: the operation of the
    //   ticket is translated into a core operation (`tickets/policy.ts`)
    //   ⇒ ⭐⭐ the core decides the capability and the interface never
    //   does.
    if (segments[1] === 'tickets') {
      if (method === 'GET' && segments.length === 2) {
        return this.#listTickets(context, url);
      }
      if (method === 'POST' && segments.length === 2) {
        return locked(() => this.#createTicket(context, req));
      }
      if (segments[2]) {
        const ref = decodeURIComponent(segments[2]);
        if (method === 'GET' && segments.length === 3) {
          return this.#readTicketHandler(context, ref);
        }
        if (method === 'PATCH' && segments.length === 3) {
          return locked(() => this.#updateTicket(context, ref, req));
        }
      }
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
        return locked(() => this.#appendMessage(context, ref, req));
      }
      if (method === 'GET' && segments[3] === 'changes') {
        return this.#readChanges(context, ref);
      }
      if (method === 'POST' && segments[3] === 'state') {
        return locked(() => this.#updateState(context, ref, req));
      }
      if (method === 'POST' && segments[3] === 'assign') {
        return locked(() => this.#assign(context, ref, req));
      }
    }

    return { status: 404, body: { ok: false, error: { code: 'route_not_found', message: path } } };
  }

  // ------------------------------------------------------------ handlers
  /**
   * ⭐ The health check: the profile, the database state and the schema
   *   version. It needs no session (a probe has none) and it exposes
   *   nothing sensitive: no host, no credential, no data.
   */
  async #health(): Promise<JsonResponse> {
    let dbOk = false;
    let schemaVersion: string | null = null;
    try {
      const result = await this.#pool.query<{ version: string }>(
        `select version from wasl_schema_migrations order by applied_at desc limit 1`,
      );
      schemaVersion = result.rows[0]?.version ?? null;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const body = {
      ok: dbOk,
      service: 'wasl-local-api',
      scope: 'local-test',
      profile: this.#config.profile,
      db_ok: dbOk,
      schema_version: schemaVersion,
      uptime_ms: Date.now() - this.#startedAt,
      rate_limit: {
        max_account_attempts: this.#config.rateLimit.maxAccountAttempts,
        max_tenant_attempts: this.#config.rateLimit.maxTenantAttempts,
        max_global_attempts: this.#config.rateLimit.maxGlobalAttempts,
        max_peer_attempts: this.#config.rateLimit.maxPeerAttempts,
        window_seconds: this.#config.rateLimit.windowSeconds,
        trust_peer_address: this.#config.rateLimit.trustPeerAddress,
        // ⭐⭐ D-070 / M-73: the admission control is the real ceiling.
        global_rate_per_second: this.#config.rateLimit.globalRatePerSecond,
        global_burst: this.#config.rateLimit.globalBurst,
        tenant_rate_per_second: this.#config.rateLimit.tenantRatePerSecond,
        tenant_burst: this.#config.rateLimit.tenantBurst,
        degraded_wait_ms: this.#config.rateLimit.degradedWaitMs,
        max_wait_ms: this.#config.rateLimit.maxWaitMs,
      },
    };
    return { status: dbOk ? 200 : 503, body };
  }

  /**
   * ⭐⭐ D-069 / M70: the readiness answer.
   * ⭐ The service is ready when the database answers and the schema
   *   is applied (at least one migration is in place).
   * ⛔ It exposes nothing sensitive: no host, no credential, no data.
   */
  async #ready(): Promise<JsonResponse> {
    let dbOk = false;
    let schemaVersion: string | null = null;
    let migrations = 0;
    try {
      const result = await this.#pool.query<{ version: string }>(
        `select version from wasl_schema_migrations order by applied_at desc limit 1`,
      );
      schemaVersion = result.rows[0]?.version ?? null;
      const count = await this.#pool.query<{ count: string }>(
        `select count(*)::text as count from wasl_schema_migrations`,
      );
      migrations = Number(count.rows[0]?.count ?? '0');
      dbOk = schemaVersion !== null;
    } catch {
      dbOk = false;
    }
    const body = {
      ok: dbOk,
      service: 'wasl-local-api',
      scope: 'local-test',
      profile: this.#config.profile,
      db_ok: dbOk,
      schema_version: schemaVersion,
      migrations,
      uptime_ms: Date.now() - this.#startedAt,
    };
    return { status: dbOk ? 200 : 503, body };
  }

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
    // ⭐⭐ D-069 / M67 — the peer address comes from the socket.
    const peerAddress = peerAddressOf(req);
    // ⭐ The counters live in PostgreSQL, so the limit is the same for
    //   every backend instance.
    const limit = await readRateLimitState(
      this.#pool,
      tenantId,
      userId,
      this.#config.rateLimit,
      peerAddress,
    );
    // ⭐⭐ D-070 / M-73: the ADMISSION CONTROL. ⭐ It never refuses
    //   because of the platform: it bounds the number of key derivations
    //   per second (the real ceiling of the CPU) and it makes the
    //   attempt wait when the platform is under pressure.
    const admission = await admitLoginAttempt(
      this.#pool,
      tenantId,
      this.#config.rateLimit,
      limit.degraded,
    );
    if (admission.refused) {
      // ⛔ The LAST RESORT: the wait is longer than the ceiling, so the
      //   installation is completely flooded. ⭐ This is the only
      //   refusal that the platform level can cause, and it is honest
      //   about it: the answer says the platform is saturated.
      this.#logger.warn('login_platform_saturated', {
        tenant_id: tenantId,
        user_id: userId,
        code: 'login_platform_saturated',
      });
      return {
        status: 429,
        body: {
          ok: false,
          error: {
            code: 'login_platform_saturated',
            message: 'the login service is saturated, retry in a moment',
          },
        },
      };
    }
    if (admission.waitMs > 0) {
      // ⭐ The attempt waits: the flood is slowed down, nobody is
      //   switched off.
      await sleep(admission.waitMs);
    }

    try {
      const result = await login(
        this.#pool,
        { tenantId, userId, passcode },
        this.#config.sessionTtlSeconds,
      );
      // ⭐ A successful login clears the failures of that account.
      await clearLoginFailures(this.#pool, tenantId, userId);
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
    } catch (error) {
      // ⭐ Only a credential failure counts as a guess: a malformed
      //   request or a disabled account is an answer, not an attempt.
      if (error instanceof SessionError && error.code === 'credentials_invalid') {
        await recordLoginFailure(this.#pool, tenantId, userId, peerAddress);
        this.#logger.warn('login_failed', {
          tenant_id: tenantId,
          user_id: userId,
          code: 'credentials_invalid',
        });
        // ⭐⭐ D-069 / M67.7: the guess budget of the account (or of
        //   the company) refuses the GUESS, never the legitimate user.
        //   ⭐ The passcode was verified above: a CORRECT credential is
        //   always accepted, so a deliberate attack on an account can
        //   not lock its owner out. Only the guess itself is refused.
        // ⭐⭐ D-070 / M-73: the peer budget refuses the guesses of one
        //   address too. ⭐⭐ The PLATFORM level is NOT here any more:
        //   it never refuses, it only slows the flood down.
        if (limit.limited || limit.peerLimited) {
          return {
            status: 429,
            body: {
              ok: false,
              error: { code: 'login_rate_limited', message: 'too many failed login attempts' },
            },
          };
        }
      }
      throw error;
    }
  }

  /**
   * ⭐⭐ D-069 / M68: the receipt of a deletion request.
   * ⭐ The answer tells the client whether the deletion happened:
   *   `executed` (the proof exists), `previewed` (the request is known
   *   and was not executed) or `unknown` (there is no trace).
   * ⭐ The `verified` flag is the tamper detection: the content hash
   *   of the evidence is recomputed inside the database and compared.
   */
  async #deletionStatus(req: http.IncomingMessage): Promise<JsonResponse> {
    const body = asRecord(parseJson(await readBody(req)));
    const requestId = asString(body['request_id']);
    if (!requestId) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'request_id_required', message: 'request_id is required' } },
      };
    }
    // ⛔ The tenant context is a placeholder: the receipt function
    //   reads the evidence (which has no forced RLS) and restores the
    //   context before it returns.
    const receipt = await UnitOfWork.run(this.#pool, 'wasl_platform', (uow) =>
      readDeletionReceipt(uow, requestId),
    );
    this.#logger.info('deletion_receipt', {
      request_id: requestId.slice(0, 12),
      status: receipt.status,
      code: 'deletion_receipt',
    });
    return {
      status: 200,
      body: {
        ok: true,
        request_id: receipt.requestId,
        status: receipt.status,
        evidence_id: receipt.evidenceId,
        scope: receipt.scope,
        occurred_at: receipt.occurredAt,
        content_hash: receipt.contentHash,
        verified: receipt.verified,
      },
    };
  }

  /**
   * ⭐⭐ D-069 / M68: the receipt of a deletion request, without a
   * session. ⭐ It NEVER deletes anything: it only reports what
   *   happened to the request.
   */
  async #deletionReceiptOnly(req: http.IncomingMessage): Promise<JsonResponse> {
    const body = asRecord(parseJson(await readBody(req)));
    const requestId = asString(body['request_id']);
    if (!requestId) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'request_id_required', message: 'request_id is required' } },
      };
    }
    const receipt = await UnitOfWork.run(this.#pool, 'wasl_platform', (uow) =>
      readDeletionReceipt(uow, requestId),
    );
    this.#logger.info('deletion_receipt', {
      request_id: requestId.slice(0, 12),
      status: receipt.status,
      code: 'deletion_receipt',
    });
    return {
      status: 200,
      body: {
        ok: true,
        request_id: receipt.requestId,
        status: receipt.status,
        evidence_id: receipt.evidenceId,
        scope: receipt.scope,
        occurred_at: receipt.occurredAt,
        content_hash: receipt.contentHash,
        verified: receipt.verified,
        already_executed: receipt.status === 'executed',
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

    const bundle = this.#newBundle(context.session.tenantId);
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
    const bundle = this.#newBundle(context.session.tenantId);
    resetCaptures(bundle);

    const classification = classifyJourneyMessage(text);
    const reply = renderJourneyReply(classification);

    try {
      const result = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        // ⭐⭐ D-069 / M66: the row lock comes FIRST. Everything that
        //   is read below (the messages and the state) is the
        //   committed state at the moment of the lock, so the core
        //   never decides on a stale conversation and two instances
        //   cannot write the same conversation at the same time.
        const lockedRow = await lockConversationRow(uow, context.session.tenantId, ref);
        if (!lockedRow) {
          throw new Error('conversation_not_found');
        }
        // ⭐⭐ M-76: the scope of the role — the rule of the core work
        //   queue (`agent-queue.ts`): an AGENT reaches the conversations
        //   that are assigned to them, and nothing else. ⭐ It is
        //   applied to EVERY path (the detail and every write) ⇒ ⭐ a
        //   path can never be wider than the list.
        if (!this.#withinRoleScope(context, lockedRow.assignee_actor_id)) {
          throw new Error('conversation_not_found');
        }
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
      // ⭐ D-069 / M66: a duplicate message and a refused write are
      //   ANSWERS (409), not server faults: the caller is told the
      //   truth instead of receiving a 500 for a refused write.
      const status =
        code === 'conversation_not_found'
          ? 404
          : code === 'message_duplicate' || code === 'message_conflict'
            ? 409
            : 500;
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
    const bundle = this.#newBundle(context.session.tenantId);
    resetCaptures(bundle);

    try {
      const view = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        // ⭐⭐ D-069 / M66: the database row lock comes FIRST and the
        //   conversation is hydrated AFTER it. The messages and the
        //   state that the core reads are therefore the committed ones:
        //   the write is serialized across the backend instances, not
        //   only inside one process, and no instance ever decides on a
        //   stale conversation.
        const lockedRow = await lockConversationRow(uow, context.session.tenantId, ref);
        if (!lockedRow) {
          throw new Error('conversation_not_found');
        }
        // ⭐⭐ M-76: the scope of the role — the rule of the core work
        //   queue (`agent-queue.ts`): an AGENT reaches the conversations
        //   that are assigned to them, and nothing else. ⭐ It is
        //   applied to EVERY path (the detail and every write) ⇒ ⭐ a
        //   path can never be wider than the list.
        if (!this.#withinRoleScope(context, lockedRow.assignee_actor_id)) {
          throw new Error('conversation_not_found');
        }
        await hydrateEmployees(uow, bundle);
        const exists = await hydrateConversation(uow, bundle, decision.context, ref);
        if (!exists) {
          throw new Error('conversation_not_found');
        }
        if (expected !== null) {
          const version = bundle.states.get(decision.context, ref)?.version ?? null;
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
    const bundle = this.#newBundle(context.session.tenantId);
    resetCaptures(bundle);

    try {
      const view = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        // ⭐⭐ D-069 / M66: the same gate as the state update — the row
        //   lock first, the hydration after it.
        const lockedRow = await lockConversationRow(uow, context.session.tenantId, ref);
        if (!lockedRow) {
          throw new Error('conversation_not_found');
        }
        // ⭐⭐ M-76: the scope of the role — the rule of the core work
        //   queue (`agent-queue.ts`): an AGENT reaches the conversations
        //   that are assigned to them, and nothing else. ⭐ It is
        //   applied to EVERY path (the detail and every write) ⇒ ⭐ a
        //   path can never be wider than the list.
        if (!this.#withinRoleScope(context, lockedRow.assignee_actor_id)) {
          throw new Error('conversation_not_found');
        }
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


  // ------------------------------------------------------------ the tickets
  /**
   * ⭐⭐ D-073: the scope of the ROLE on the tickets.
   * ⭐ The rule is the one of the core work queue: an AGENT reaches the
   *   tickets that are assigned to them ⇒ ⭐⭐ and the derived data
   *   (the count of the open tickets) follows the SAME scope (the
   *   lesson of M-83).
   */
  #ticketScope(context: RequestContext): TicketScope {
    return { role: context.session.role, actorId: context.session.actorId };
  }

  /**
   * ⭐⭐ M-86: MAY THIS ROLE WRITE A TICKET? ⭐⭐ The answer is the
   *   decision of the CORE (the authorization of the core) ⇒ ⭐⭐ and
   *   the interface only shows what the server allows.
   */
  #mayWriteTickets(context: RequestContext): boolean {
    return this.#authorizeTicket(context, 'ticket.update', SCOPE_REF).allowed;
  }

  /**
   * ⭐⭐ M-86: MAY THIS ROLE ASSIGN A TICKET? ⭐⭐ The assignment is
   *   the owner's alone (the fact M-84 corrected) ⇒ ⭐⭐ the answer is
   *   the decision of the core and nothing else.
   */
  #mayAssignTickets(context: RequestContext): boolean {
    return this.#authorizeTicket(context, 'ticket.assign', SCOPE_REF).allowed;
  }

  /**
   * ⭐⭐ D-073: authorize a ticket operation.
   * ⭐ The operation of the ticket is translated into a CORE operation
   *   ⇒ ⭐⭐ the core decides the capability ⇒ ⭐⭐ an operation that is
   *   not declared is refused (the default is the refusal).
   */
  #authorizeTicket(
    context: RequestContext,
    ticketOperation: string,
    conversationRef: string,
  ): { allowed: true; context: TenantContext } | { allowed: false; code: string; reason: string } {
    let coreOperation;
    try {
      coreOperation = coreOperationOf(ticketOperation);
    } catch (error) {
      if (error instanceof TicketPolicyError) {
        return { allowed: false, code: error.code, reason: error.message };
      }
      throw error;
    }
    return this.#authorize(context, coreOperation, conversationRef);
  }

  /**
   * ⭐⭐ D-073: the list of the tickets of a company.
   * ⭐ The pagination is real (the total comes with the page) ⇒ ⭐ a
   *   company with more than a hundred tickets sees all of them.
   */
  async #listTickets(context: RequestContext, url: URL): Promise<JsonResponse> {
    const decision = this.#authorizeTicket(context, 'ticket.list', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'ticket.list',
        'denied',
        decision.code,
        {},
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const state = url.searchParams.get('state');
    const priority = url.searchParams.get('priority');
    const filters: TicketFilters = {
      ...(url.searchParams.get('q') !== null ? { query: url.searchParams.get('q') as string } : {}),
      ...(state !== null ? { state } : {}),
      ...(priority !== null ? { priority } : {}),
      ...(url.searchParams.get('assignee') !== null
        ? { assignee: url.searchParams.get('assignee') as string }
        : {}),
      ...(url.searchParams.get('customer_id') !== null
        ? { customerId: url.searchParams.get('customer_id') as string }
        : {}),
      ...(url.searchParams.get('conversation_ref') !== null
        ? { conversationRef: url.searchParams.get('conversation_ref') as string }
        : {}),
      // ⭐ The order is a closed list: an unknown value falls back to
      //   the recent one, and nothing of the client reaches SQL.
      sort: ['recent', 'priority', 'state'].includes(url.searchParams.get('sort') ?? '')
        ? (url.searchParams.get('sort') as 'recent' | 'priority' | 'state')
        : 'recent',
      limit: Number(url.searchParams.get('limit') ?? '25'),
      offset: Number(url.searchParams.get('offset') ?? '0'),
    };
    const page = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      listTickets(uow, context.session.tenantId, this.#ticketScope(context), filters),
    );
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'ticket.list',
      'allowed',
      null,
      { count: page.rows.length },
    );
    return {
      status: 200,
      body: {
        ok: true,
        tickets: page.rows,
        total: page.total,
        limit: filters.limit,
        offset: filters.offset,
        // ⭐⭐ M-86: the rights come from the AUTHORIZATION of the core
        //   ⇒ ⭐⭐ and not from a table of permissions beside it.
        may_write: this.#mayWriteTickets(context),
        may_assign: this.#mayAssignTickets(context),
      },
    };
  }

  /** ⭐⭐ D-073: the detail of one ticket and its activity. */
  async #readTicketHandler(context: RequestContext, ref: string): Promise<JsonResponse> {
    const decision = this.#authorizeTicket(context, 'ticket.read', ref);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'ticket.read',
        'denied',
        decision.code,
        { target: ref },
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const detail = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const ticket = await readTicket(uow, context.session.tenantId, ref, this.#ticketScope(context));
      if (!ticket) return null;
      const changes = await readTicketChanges(uow, context.session.tenantId, ref);
      return { ticket, changes };
    });
    if (!detail) {
      return {
        status: 404,
        body: { ok: false, error: { code: 'ticket_not_found', message: ref } },
      };
    }
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'ticket.read',
      'allowed',
      null,
      { target: ref },
    );
    return {
      status: 200,
      body: {
        ok: true,
        ticket: detail.ticket,
        changes: detail.changes,
        // ⭐⭐ M-86: the rights come from the AUTHORIZATION of the core.
        may_write: this.#mayWriteTickets(context),
        may_assign: this.#mayAssignTickets(context),
      },
    };
  }

  /**
   * ⭐⭐ D-073: create a ticket.
   * ⭐⭐ THE CREATION IS IDEMPOTENT: the same reference inside the same
   *   company returns the first ticket instead of a second one ⇒ ⭐⭐ a
   *   retried request (a lost answer) never duplicates the work.
   */
  async #createTicket(context: RequestContext, req: http.IncomingMessage): Promise<JsonResponse> {
    const decision = this.#authorizeTicket(context, 'ticket.create', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'ticket.create',
        'denied',
        decision.code,
        {},
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const subject = asString(body['subject']);
    if (!subject || subject.length > 200) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'subject_invalid', message: 'the subject is required' } },
      };
    }
    const customerId = asString(body['customer_id']);
    if (!customerId) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'customer_required', message: 'customer_id is required' } },
      };
    }
    const state = asString(body['state']) ?? 'open';
    if (!isTicketState(state)) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'state_invalid', message: 'the state is not declared' } },
      };
    }
    const priority = asString(body['priority']) ?? 'normal';
    if (!isTicketPriority(priority)) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'priority_invalid', message: 'the priority is not declared' } },
      };
    }
    const description = asString(body['description']) ?? '';
    const conversationRef = asString(body['conversation_ref']);
    const assignee = asString(body['assignee_actor_id']);
    const ref = asString(body['ref']) ?? `tkt_${crypto.randomBytes(6).toString('hex')}`;

    try {
      const created = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        // ⭐⭐ The customer must exist in THIS company ⇒ ⭐ a ticket
        //   cannot point at a customer of another company.
        const customer = await uow.query<{ id: string }>(
          `select id from customers where tenant_id = $1 and id = $2`,
          [context.session.tenantId, customerId],
        );
        if (customer.rowCount === 0) {
          throw new Error('customer_not_found');
        }
        // ⭐⭐ The conversation (when there is one) must exist in THIS
        //   company ⇒ ⭐⭐ and it must be one the employee may SEE.
        if (conversationRef) {
          const conversation = await uow.query<{ ref: string }>(
            `select ref from conversations where tenant_id = $1 and ref = $2`,
            [context.session.tenantId, conversationRef],
          );
          if (conversation.rowCount === 0) {
            throw new Error('conversation_not_found');
          }
        }
        // ⭐⭐ The idempotency: the same reference ⇒ the first ticket.
        const existing = await readTicketByRef(uow, context.session.tenantId, ref);
        if (existing) {
          const row = await readTicket(uow, context.session.tenantId, ref, this.#ticketScope(context));
          return { row, created: false };
        }
        const inserted = await uow.query(
          `insert into support_tickets
             (tenant_id, ref, customer_id, conversation_ref, subject, description, state, priority,
              assignee_actor_id, version, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1, now(), now())
           on conflict (tenant_id, ref) do nothing
           returning ref`,
          [
            context.session.tenantId,
            ref,
            customerId,
            conversationRef ?? null,
            subject,
            description,
            state,
            priority,
            assignee ?? null,
          ],
        );
        if (inserted.rowCount === 0) {
          const row = await readTicket(uow, context.session.tenantId, ref, this.#ticketScope(context));
          return { row, created: false };
        }
        await uow.query(
          `insert into support_ticket_changes
             (tenant_id, ticket_ref, version, actor_id, operation, before_state, after_state, reason, changed_at)
           values ($1,$2,1,$3,'ticket.create',null,$4,$5, now())`,
          [
            context.session.tenantId,
            ref,
            context.session.actorId,
            state,
            asString(body['reason']) ?? 'the ticket was created',
          ],
        );
        const row = await readTicket(uow, context.session.tenantId, ref, this.#ticketScope(context));
        return { row, created: true };
      });
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'ticket.create',
        'allowed',
        null,
        { ref },
      );
      return {
        status: created.created ? 201 : 200,
        body: { ok: true, ticket: created.row, created: created.created },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'customer_not_found') {
        return {
          status: 404,
          body: { ok: false, error: { code: 'customer_not_found', message: customerId } },
        };
      }
      if (message === 'conversation_not_found') {
        return {
          status: 404,
          body: { ok: false, error: { code: 'conversation_not_found', message: conversationRef } },
        };
      }
      throw error;
    }
  }

  /**
   * ⭐⭐ D-073: change a ticket (the state, the priority, the subject,
   *   the description or the assignee).
   * ⭐⭐ THE LOCK: the update carries the version it read ⇒ ⭐⭐ two
   *   employees get a conflict (409) instead of overwriting each other.
   */
  async #updateTicket(
    context: RequestContext,
    ref: string,
    req: http.IncomingMessage,
  ): Promise<JsonResponse> {
    // ⭐⭐⭐ M-86: THE RIGHT IS CHECKED BEFORE THE BODY IS READ.
    // ⭐⭐ A role without the right must NOT learn anything from the
    //   shape of the request ⇒ ⭐⭐ the answer of a refused right is
    //   403 and NOT 400 ("the version is missing") ⇒ ⭐⭐ the check
    //   comes FIRST, the validation after it.
    const base = this.#authorizeTicket(context, 'ticket.update', ref);
    if (!base.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'ticket.update',
        'denied',
        base.code,
        { target: ref },
      );
      return { status: 403, body: { ok: false, error: { code: base.code, message: base.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const expectedVersion = Number(body['version']);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'version_required', message: 'the version is required' } },
      };
    }
    const wantsAssignee = body['assignee_actor_id'] !== undefined;
    // ⭐⭐ The assignment has its OWN operation (the core grants it to
    //   the owner alone) ⇒ ⭐⭐ the two rights are checked apart.
    const operation = wantsAssignee ? 'ticket.assign' : 'ticket.update';
    if (wantsAssignee) {
      const assign = this.#authorizeTicket(context, 'ticket.assign', ref);
      if (!assign.allowed) {
        await this.#audit(
          context.session.tenantId,
          context.session.actorId,
          context.session.sessionId,
          'ticket.assign',
          'denied',
          assign.code,
          { target: ref },
        );
        return {
          status: 403,
          body: { ok: false, error: { code: assign.code, message: assign.reason } },
        };
      }
    }
    const decision = base;

    const nextState = body['state'] === undefined ? undefined : asString(body['state']);
    if (nextState !== undefined && !isTicketState(nextState)) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'state_invalid', message: 'the state is not declared' } },
      };
    }
    const nextPriority = body['priority'] === undefined ? undefined : asString(body['priority']);
    if (nextPriority !== undefined && !isTicketPriority(nextPriority)) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'priority_invalid', message: 'the priority is not declared' } },
      };
    }
    const nextAssignee =
      body['assignee_actor_id'] === undefined ? undefined : asString(body['assignee_actor_id']);

    try {
      const outcome = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        const current = await readTicketForUpdate(uow, context.session.tenantId, ref);
        if (!current) {
          return { kind: 'missing' as const };
        }
        // ⭐⭐ The version: the write lands only when it did not move.
        if (current.version !== expectedVersion) {
          return { kind: 'conflict' as const, version: current.version };
        }
        // ⭐⭐ The state machine of the tickets (local to the module).
        if (nextState !== undefined && nextState !== current.state) {
          assertTicketTransition(current.state, nextState);
        }
        if (nextAssignee !== undefined && nextAssignee !== null) {
          // ⭐⭐ The assignee must be an employee of THIS company.
          const member = await uow.query<{ id: string }>(
            `select u.id from users u
               join memberships m on m.user_id = u.id
              where m.tenant_id = $1 and u.id = $2 and m.status = 'active'`,
            [context.session.tenantId, nextAssignee],
          );
          if (member.rowCount === 0) {
            return { kind: 'assignee_not_in_tenant' as const };
          }
        }
        const subject = body['subject'] === undefined ? undefined : asString(body['subject']);
        if (subject !== undefined && (!subject || subject.length > 200)) {
          return { kind: 'subject_invalid' as const };
        }
        const description = body['description'] === undefined ? undefined : asString(body['description']);

        const updated = await uow.query(
          `update support_tickets
              set state = coalesce($3, state),
                  priority = coalesce($4, priority),
                  subject = coalesce($5, subject),
                  description = coalesce($6, description),
                  assignee_actor_id = case when $7::text is null then assignee_actor_id else $7 end,
                  version = version + 1,
                  updated_at = now()
            where tenant_id = $1 and ref = $2 and version = $8
            returning ref, version`,
          [
            context.session.tenantId,
            ref,
            nextState ?? null,
            nextPriority ?? null,
            subject ?? null,
            description ?? null,
            nextAssignee ?? null,
            expectedVersion,
          ],
        );
        if (updated.rowCount === 0) {
          return { kind: 'conflict' as const, version: current.version };
        }
        await uow.query(
          `insert into support_ticket_changes
             (tenant_id, ticket_ref, version, actor_id, operation, before_state, after_state, reason, changed_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
          [
            context.session.tenantId,
            ref,
            current.version + 1,
            context.session.actorId,
            wantsAssignee ? 'ticket.assign' : 'ticket.update',
            current.state,
            nextState ?? current.state,
            asString(body['reason']) ?? 'the ticket was changed',
          ],
        );
        const row = await readTicket(uow, context.session.tenantId, ref, this.#ticketScope(context));
        return { kind: 'ok' as const, row };
      });

      if (outcome.kind === 'missing') {
        return {
          status: 404,
          body: { ok: false, error: { code: 'ticket_not_found', message: ref } },
        };
      }
      if (outcome.kind === 'conflict') {
        return {
          status: 409,
          body: {
            ok: false,
            error: { code: 'ticket_conflict', message: 'the ticket changed in the meantime' },
            version: outcome.version,
          },
        };
      }
      if (outcome.kind === 'assignee_not_in_tenant') {
        return {
          status: 409,
          body: {
            ok: false,
            error: { code: 'assignee_not_in_tenant', message: 'the assignee is not in this company' },
          },
        };
      }
      if (outcome.kind === 'subject_invalid') {
        return {
          status: 400,
          body: { ok: false, error: { code: 'subject_invalid', message: 'the subject is not valid' } },
        };
      }
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        operation,
        'allowed',
        null,
        { ref },
      );
      return { status: 200, body: { ok: true, ticket: outcome.row } };
    } catch (error) {
      if (error instanceof TicketStateError) {
        const status = error.code === 'transition_not_allowed' ? 409 : 400;
        return { status, body: { ok: false, error: { code: error.code, message: error.message } } };
      }
      throw error;
    }
  }

  // ------------------------------------------------------------ the CRM
  /**
   * ⭐⭐ D-071: does this employee carry the capability that manages a
   *   customer? ⭐⭐ The core decides: the operation `customer.create`
   *   maps to the capability `customer.manage`, and the core grants it
   *   to the owner and the supervisor only. ⛔ The interface never
   *   decides this and never invents a capability.
   */
  #mayManageCustomers(context: RequestContext): boolean {
    return this.#authorize(context, 'customer.create', SCOPE_REF).allowed;
  }

  /**
   * ⭐⭐ D-071: the list of the customers of a company.
   * ⭐ The pagination is real (the total comes with the page) ⇒ ⭐ a
   *   company with more than a hundred customers sees all of them.
   */
  async #listCrmCustomers(context: RequestContext, url: URL): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.list', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'crm.customers.list',
        'denied',
        decision.code,
        {},
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const query = url.searchParams.get('q');
    const limit = Number(url.searchParams.get('limit') ?? '25');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const filters: CrmCustomerFilters = {
      ...(query !== null ? { query } : {}),
      actorId: context.session.actorId,
      role: context.session.role,
      mayManage: this.#mayManageCustomers(context),
      // ⭐ The order is a closed list: an unknown value falls back to
      //   the name, and nothing of the client reaches SQL.
      sort: ['name', 'recent', 'conversations'].includes(url.searchParams.get('sort') ?? '')
        ? (url.searchParams.get('sort') as string)
        : 'name',
      limit: Number.isFinite(limit) ? limit : 25,
      offset: Number.isFinite(offset) ? offset : 0,
    };
    const page = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      listCustomers(uow, context.session.tenantId, filters),
    );
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'crm.customers.list',
      'allowed',
      null,
      { count: page.rows.length },
    );
    return {
      status: 200,
      body: {
        ok: true,
        customers: page.rows,
        total: page.total,
        limit: filters.limit,
        offset: filters.offset,
        may_manage: filters.mayManage,
      },
    };
  }

  /**
   * ⭐⭐ D-071: the profile of one customer and its conversations.
   * ⭐ The scope of the role is applied: an agent reaches the
   *   conversations that are assigned to them, and nothing else.
   */
  async #readCrmCustomer(context: RequestContext, customerId: string): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.read', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'crm.customer.read',
        'denied',
        decision.code,
        { target: customerId },
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const detail = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
      const customer = await readCustomer(uow, context.session.tenantId, customerId, {
        role: context.session.role,
        actorId: context.session.actorId,
      });
      // ⭐⭐ D-073: the tickets of the customer, with the SAME scope
      //   ⇒ ⭐⭐ the count of the open tickets can never include a
      //   ticket of another employee (the lesson of M-83).
      const tickets = await readCustomerTickets(
        uow,
        context.session.tenantId,
        customerId,
        this.#ticketScope(context),
      );
      return {
        customer: customer.customer,
        conversations: customer.conversations,
        tickets: tickets.tickets,
        open_ticket_count: tickets.open_count,
      };
    });
    if (!detail.customer) {
      return {
        status: 404,
        body: { ok: false, error: { code: 'customer_not_found', message: customerId } },
      };
    }
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'crm.customer.read',
      'allowed',
      null,
      { target: customerId },
    );
    return {
      status: 200,
      body: {
        ok: true,
        customer: detail.customer,
        conversations: detail.conversations,
        // ⭐⭐ D-073: the tickets of the customer (the same scope).
        tickets: detail.tickets,
        open_ticket_count: detail.open_ticket_count,
        may_manage: this.#mayManageCustomers(context),
      },
    };
  }

  /**
   * ⭐⭐ D-071: the edit of a customer.
   * ⭐⭐ The permission is the core's (`customer.manage`): the owner
   *   and the supervisor. ⛔ No new capability is created.
   * ⭐⭐ The lock: the client sends the version it read ⇒ ⭐ a second
   *   employee gets a conflict instead of overwriting silently.
   * ⭐⭐ The change is audited (the same audit of the other routes).
   */
  async #updateCrmCustomer(
    context: RequestContext,
    customerId: string,
    req: http.IncomingMessage,
  ): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'customer.create', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'crm.customer.update',
        'denied',
        decision.code,
        { target: customerId },
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const expectedVersion = Number(body['version']);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'version_required', message: 'the version is required' } },
      };
    }
    const patch: { display_name?: string; email?: string; phone?: string; expected_version: number } = {
      expected_version: expectedVersion,
    };
    const changed: string[] = [];
    if (body['display_name'] !== undefined) {
      const displayName = asString(body['display_name']);
      if (!displayName || displayName.length > 120) {
        return {
          status: 400,
          body: { ok: false, error: { code: 'name_invalid', message: 'the name is not valid' } },
        };
      }
      patch.display_name = displayName;
      changed.push('display_name');
    }
    if (body['email'] !== undefined) {
      const email = asString(body['email']);
      if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return {
          status: 400,
          body: { ok: false, error: { code: 'email_invalid', message: 'the email is not valid' } },
        };
      }
      patch.email = email ?? '';
      changed.push('email');
    }
    if (body['phone'] !== undefined) {
      const phone = asString(body['phone']);
      if (phone !== null && !/^[0-9+()\-\s]{6,32}$/.test(phone)) {
        return {
          status: 400,
          body: { ok: false, error: { code: 'phone_invalid', message: 'the phone is not valid' } },
        };
      }
      patch.phone = phone ?? '';
      changed.push('phone');
    }
    if (changed.length === 0) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'nothing_to_change', message: 'no field to change' } },
      };
    }

    const outcome = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      updateCustomer(uow, context.session.tenantId, customerId, patch),
    );
    if (outcome.status === 'not_found') {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'crm.customer.update',
        'denied',
        'customer_not_found',
        { target: customerId },
      );
      return {
        status: 404,
        body: { ok: false, error: { code: 'customer_not_found', message: customerId } },
      };
    }
    if (outcome.status === 'conflict') {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'crm.customer.update',
        'denied',
        'customer_version_conflict',
        { target: customerId, current_version: outcome.current_version },
      );
      return {
        status: 409,
        body: {
          ok: false,
          error: {
            code: 'customer_version_conflict',
            message: 'the customer was changed by another employee',
            current_version: outcome.current_version,
          },
        },
      };
    }
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'crm.customer.update',
      'allowed',
      null,
      { target: customerId, fields: changed },
    );
    return { status: 200, body: { ok: true, customer: outcome.customer, changed: changed } };
  }

  // ------------------------------------------------------------ inbox
  /**
   * ⭐⭐ D-070: the list of the inbox.
   * ⭐ The scope of the role is applied (an agent sees the
   *   conversations that are assigned to them): that is the rule the
   *   core already approved for the work queue.
   */
  async #listInbox(context: RequestContext, url: URL): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.list', SCOPE_REF);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'inbox.list',
        'denied',
        decision.code,
        {},
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const state = url.searchParams.get('state');
    if (state !== null && !isInboxState(state)) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'state_unknown', message: 'the state is not known' } },
      };
    }
    const filters: InboxFilters = {
      ...(url.searchParams.get('q') !== null ? { query: url.searchParams.get('q') as string } : {}),
      ...(state !== null ? { state: state as InboxState } : {}),
      ...(url.searchParams.get('assignee') !== null
        ? { assignee: url.searchParams.get('assignee') as string }
        : {}),
      actorId: context.session.actorId,
      role: context.session.role,
      limit: Number(url.searchParams.get('limit') ?? '50'),
      offset: Number(url.searchParams.get('offset') ?? '0'),
    };
    const page = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      listInboxConversations(uow, context.session.tenantId, filters),
    );
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'inbox.list',
      'allowed',
      null,
      { count: page.rows.length },
    );
    return {
      status: 200,
      body: {
        ok: true,
        conversations: page.rows,
        total: page.total,
        scope: context.session.role === 'agent' ? 'own' : 'company',
      },
    };
  }

  /** ⭐⭐ D-070: the detail of one conversation and its messages. */
  async #readInboxConversation(
    context: RequestContext,
    ref: string,
    url: URL,
  ): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.read', ref);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'inbox.read',
        'denied',
        decision.code,
        { target: ref },
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    // ⭐⭐ M-77: the refresh asks only for what is new.
    const since = url.searchParams.get('since');
    const detail = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      readInboxConversation(
        uow,
        context.session.tenantId,
        ref,
        {
          role: context.session.role,
          actorId: context.session.actorId,
        },
        since !== null ? since : undefined,
      ),
    );
    if (!detail.conversation) {
      return {
        status: 404,
        body: { ok: false, error: { code: 'conversation_not_found', message: ref } },
      };
    }
    await this.#audit(
      context.session.tenantId,
      context.session.actorId,
      context.session.sessionId,
      'inbox.read',
      'allowed',
      null,
      { target: ref },
    );
    // ⭐⭐ D-070: the states the CORE allows from the current one.
    // ⭐ The interface offers exactly these, so it never invents a
    //   state and never proposes an impossible transition.
    const currentState = String(detail.conversation['state'] ?? '');
    const allowedStates =
      (ALLOWED_TRANSITIONS as Record<string, readonly string[]>)[currentState] ?? [];
    return {
      status: 200,
      body: {
        ok: true,
        conversation: detail.conversation,
        messages: detail.messages,
        allowed_states: allowedStates,
        // ⭐ M-77: the instant of the database ⇒ the next poll asks
        //   only for what is newer than it.
        server_time: detail.server_time,
      },
    };
  }

  /**
   * ⭐⭐ D-070: the reply of an employee.
   * ⭐ It is stored as an OUTBOUND message written by the employee:
   *   nothing is sent anywhere, there is no external channel.
   * ⭐⭐ The double send is refused: the client sends the reference of
   *   the message it prepared, and the same reference twice is a
   *   conflict, never a second message.
   */
  async #sendReply(
    context: RequestContext,
    ref: string,
    req: http.IncomingMessage,
  ): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.write', ref);
    if (!decision.allowed) {
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'inbox.reply',
        'denied',
        decision.code,
        { target: ref },
      );
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const body = asRecord(parseJson(await readBody(req)));
    const text = asString(body['body']);
    if (!text) {
      return {
        status: 400,
        body: { ok: false, error: { code: 'body_required', message: 'body is required' } },
      };
    }
    const clientRef = asString(body['client_message_ref']);
    const bundle = this.#newBundle(context.session.tenantId);
    resetCaptures(bundle);

    try {
      const stored = await UnitOfWork.run(this.#pool, context.session.tenantId, async (uow) => {
        // ⭐⭐ The row lock comes FIRST: the state that is read below is
        //   the committed one, so two instances never write the same
        //   conversation at the same time.
        const lockedRow = await lockConversationRow(uow, context.session.tenantId, ref);
        if (!lockedRow) {
          throw new Error('conversation_not_found');
        }
        // ⭐⭐ M-76: the scope of the role — the rule of the core work
        //   queue (`agent-queue.ts`): an AGENT reaches the conversations
        //   that are assigned to them, and nothing else. ⭐ It is
        //   applied to EVERY path (the detail and every write) ⇒ ⭐ a
        //   path can never be wider than the list.
        if (!this.#withinRoleScope(context, lockedRow.assignee_actor_id)) {
          throw new Error('conversation_not_found');
        }
        await hydrateEmployees(uow, bundle);
        const exists = await hydrateConversation(uow, bundle, decision.context, ref);
        if (!exists) {
          throw new Error('conversation_not_found');
        }
        const outcome = bundle.store.append(decision.context, {
          schema_version: '1',
          message_ref: clientRef ?? `reply_${crypto.randomBytes(8).toString('hex')}`,
          conversation_ref: ref,
          declared_tenant_id: context.session.tenantId,
          channel: 'web',
          direction: 'outbound',
          from: context.session.actorId,
          to: 'customer@example.invalid',
          body: text,
          occurred_at: new Date().toISOString(),
          locale: 'ar',
          attributes: { source: 'inbox' },
        });
        // ⭐⭐ The duplicate is REFUSED, never stored twice.
        if (outcome.status === 'duplicate') {
          throw new Error('message_duplicate');
        }
        if (outcome.status !== 'accepted') {
          throw new Error(`message_${outcome.status}`);
        }
        await persistBundle(uow, bundle);
        return outcome.message;
      });
      await this.#audit(
        context.session.tenantId,
        context.session.actorId,
        context.session.sessionId,
        'inbox.reply',
        'allowed',
        null,
        { target: ref },
      );
      return { status: 201, body: { ok: true, message: stored, sent: false } };
    } catch (error) {
      if (shouldInvalidate(error)) this.#invalidate(context.session.tenantId);
      const code = errorCodeOf(error);
      const status =
        code === 'conversation_not_found'
          ? 404
          : code === 'message_duplicate' || code === 'message_conflict'
            ? 409
            : 500;
      return { status, body: { ok: false, error: { code, message: code } } };
    }
  }

  /**
   * ⭐⭐ D-070: the employees a conversation may be assigned to.
   * ⭐ The assignment needs the capability of the assignment, so the
   *   viewer and the agent do not see the list.
   */
  async #listInboxAgents(context: RequestContext): Promise<JsonResponse> {
    const decision = this.#authorize(context, 'conversation.assign', SCOPE_REF);
    if (!decision.allowed) {
      return { status: 403, body: { ok: false, error: { code: decision.code, message: decision.reason } } };
    }
    const agents = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      listInboxAgents(uow, context.session.tenantId),
    );
    return { status: 200, body: { ok: true, agents } };
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
    const result = await UnitOfWork.run(this.#pool, context.session.tenantId, (uow) =>
      executeDeletion(uow, context.session.tenantId, requestId, context.session.actorId),
    );
    this.#invalidate(context.session.tenantId);
    // The audit event is written INSIDE the deletion transaction: a full
    // deletion removes the tenant row, so no tenant scoped event can be
    // written afterwards. The durable evidence carries the proof and
    // survives the deletion itself.
    return {
      status: 200,
      body: {
        ok: true,
        removed: result.removed,
        scope: result.scope,
        evidence_id: result.evidenceId,
        // ⭐ D-069 / M68: the request was already executed: nothing was
        //   deleted again, the confirmed outcome is repeated.
        already_executed: result.alreadyExecuted,
      },
    };
  }
}
