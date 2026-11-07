// ============================================================
// WASL AI — FOUNDATION BUILD 02 — server configuration
// ------------------------------------------------------------
// ⭐ Fail-closed: a missing/!invalid value throws instead of
//   falling back to a default. No secret is ever hard coded.
// ⛔ The server binds to 127.0.0.1 only. It is not exposed to the
//   internet and has no public deployment path in this build.
// ⭐ FOUNDATION BUILD 02 / PHASE 01 — the profiles:
//   `development` (default), `test` and `staging`. The profile is
//   selected by WASL_ENV (or by the `profile` option of loadConfig).
//   ⛔ The `staging` profile is NOT a deployment: it only exists so
//     the settings of a future experimental host are written down and
//     fail closed. It requires an explicit bind host: a staging server
//     that binds to the loopback by accident is not reachable, and one
//     that binds to 0.0.0.0 by accident is exposed.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_RATE_LIMIT, type RateLimitConfig } from './auth/rate-limit.ts';
import type { LogLevel } from './log.ts';

export type ServerProfile = 'development' | 'test' | 'staging';

export const SERVER_PROFILES: readonly ServerProfile[] = Object.freeze([
  'development',
  'test',
  'staging',
]);

export interface ProfileDefaults {
  readonly sessionTtlSeconds: number;
  readonly logLevel: LogLevel;
  readonly rateLimit: RateLimitConfig;
  /** ⭐ The host is not defaulted in the staging profile. */
  readonly requiresExplicitHost: boolean;
}

export const PROFILE_DEFAULTS: Readonly<Record<ServerProfile, ProfileDefaults>> = Object.freeze({
  development: Object.freeze({
    sessionTtlSeconds: 3600,
    logLevel: 'debug',
    rateLimit: DEFAULT_RATE_LIMIT,
    requiresExplicitHost: false,
  }),
  test: Object.freeze({
    sessionTtlSeconds: 3600,
    logLevel: 'silent',
    rateLimit: DEFAULT_RATE_LIMIT,
    requiresExplicitHost: false,
  }),
  staging: Object.freeze({
    sessionTtlSeconds: 900,
    logLevel: 'info',
    rateLimit: DEFAULT_RATE_LIMIT,
    requiresExplicitHost: true,
  }),
});

export interface ServerConfig {
  readonly profile: ServerProfile;
  readonly host: string;
  readonly port: number;
  /** ⭐ Request path connection (role `wasl_app`, NOBYPASSRLS). */
  readonly appDatabaseUrl: string;
  /** ⭐ Migration/seed connection (role `wasl_owner`). */
  readonly ownerDatabaseUrl: string;
  readonly databaseName: string;
  readonly sessionTtlSeconds: number;
  /** ⭐ The login rate limit (shared state in PostgreSQL). */
  readonly rateLimit: RateLimitConfig;
  /** ⭐ The level of the structured log. */
  readonly logLevel: LogLevel;
  /** ⭐ Synthetic fixture passcode (never a real credential). */
  readonly testPasscode: string;
  readonly repoRoot: string;
}

export class ConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

const DEFAULT_PORT = 8787;
const DEFAULT_DB_NAME = 'wasl_local';
const DEFAULT_TEST_PASSCODE = 'wasl-local-test';

function requireString(value: string | undefined, code: string, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(code, message);
  }
  return value;
}

interface CredentialFile {
  /** Password of the request role (`wasl_app`). */
  readonly appPassword: string;
  /** Password of the migration role (`wasl_owner`) - null when absent. */
  readonly ownerPassword: string | null;
}

function readCredentialFile(repoRoot: string): CredentialFile | null {
  const file = path.join(repoRoot, '.local', 'pg-credentials.json');
  try {
    if (!fs.existsSync(file)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const app = record['app_password'] ?? record['password'];
      const owner = record['owner_password'];
      return {
        appPassword: typeof app === 'string' ? app : '',
        ownerPassword: typeof owner === 'string' && owner !== '' ? owner : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function buildUrl(databaseName: string, role: string, password: string, host: string, port: number): string {
  return `postgresql://${role}:${encodeURIComponent(password)}@${host}:${port}/${databaseName}`;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot: string = path.resolve(import.meta.dirname, '..'),
  options: { readonly requirePassword?: boolean; readonly profile?: ServerProfile } = {},
): ServerConfig {
  // ⭐ The profile comes from WASL_ENV (the option wins for the tests).
  const profileName = options.profile ?? (env['WASL_ENV'] ?? 'development');
  if (!SERVER_PROFILES.includes(profileName as ServerProfile)) {
    throw new ConfigError(
      'profile_invalid',
      `WASL_ENV must be one of ${SERVER_PROFILES.join(', ')}`,
    );
  }
  const profile = profileName as ServerProfile;
  const defaults = PROFILE_DEFAULTS[profile];
  const host = env['WASL_PG_HOST'] ?? '127.0.0.1';
  const port = Number(env['WASL_PG_PORT'] ?? '5432');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError('pg_port_invalid', 'WASL_PG_PORT is not a valid TCP port');
  }
  const databaseName = env['WASL_PG_DATABASE'] ?? DEFAULT_DB_NAME;
  const credentials = readCredentialFile(repoRoot);
  const password = env['WASL_PG_PASSWORD'] ?? credentials?.appPassword ?? '';
  // The migration role has its own password: the setup command generates
  // a separate secret for `wasl_owner`. Using the app password for the
  // owner URL would fail the authentication of the migration connection.
  const ownerPassword = env['WASL_PG_OWNER_PASSWORD'] ?? credentials?.ownerPassword ?? password;
  if (password === '' && options.requirePassword !== false) {
    throw new ConfigError(
      'pg_password_missing',
      'WASL_PG_PASSWORD is not set and .local/pg-credentials.json is missing - run the database setup first',
    );
  }  const parsedPort = Number(env['WASL_SERVER_PORT'] ?? String(DEFAULT_PORT));
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new ConfigError('server_port_invalid', 'WASL_SERVER_PORT is not a valid TCP port');
  }
  const ttl = Number(env['WASL_SESSION_TTL_SECONDS'] ?? String(defaults.sessionTtlSeconds));
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new ConfigError('session_ttl_invalid', 'WASL_SESSION_TTL_SECONDS must be a positive integer');
  }
  // ⭐ The staging profile fails closed without an explicit bind host.
  const serverHost = env['WASL_SERVER_HOST'];
  if (defaults.requiresExplicitHost && (serverHost === undefined || serverHost.trim() === '')) {
    throw new ConfigError(
      'server_host_required',
      'WASL_SERVER_HOST must be set explicitly in the staging profile',
    );
  }
  const maxAccountAttempts = Number(
    env['WASL_LOGIN_MAX_ATTEMPTS'] ?? String(defaults.rateLimit.maxAccountAttempts),
  );
  // ⭐ D-069 / M67: the platform wide budget and the peer budget.
  const maxGlobalAttempts = Number(
    env['WASL_LOGIN_MAX_GLOBAL_ATTEMPTS'] ?? String(defaults.rateLimit.maxGlobalAttempts),
  );
  const maxPeerAttempts = Number(
    env['WASL_LOGIN_MAX_PEER_ATTEMPTS'] ?? String(defaults.rateLimit.maxPeerAttempts),
  );
  // ⭐⭐ D-070 / M-73: the admission control (the real ceiling of the
  //   CPU). The number of key derivations that may start every second.
  const globalRatePerSecond = Number(
    env['WASL_LOGIN_GLOBAL_RATE_PER_SECOND'] ?? String(defaults.rateLimit.globalRatePerSecond),
  );
  const globalBurst = Number(
    env['WASL_LOGIN_GLOBAL_BURST'] ?? String(defaults.rateLimit.globalBurst),
  );
  const tenantRatePerSecond = Number(
    env['WASL_LOGIN_TENANT_RATE_PER_SECOND'] ?? String(defaults.rateLimit.tenantRatePerSecond),
  );
  const tenantBurst = Number(
    env['WASL_LOGIN_TENANT_BURST'] ?? String(defaults.rateLimit.tenantBurst),
  );
  const degradedWaitMs = Number(
    env['WASL_LOGIN_DEGRADED_WAIT_MS'] ?? String(defaults.rateLimit.degradedWaitMs),
  );
  const maxWaitMs = Number(
    env['WASL_LOGIN_MAX_WAIT_MS'] ?? String(defaults.rateLimit.maxWaitMs),
  );
  if (
    !Number.isInteger(globalRatePerSecond) || globalRatePerSecond < 1 ||
    !Number.isInteger(globalBurst) || globalBurst < 1 ||
    !Number.isInteger(tenantRatePerSecond) || tenantRatePerSecond < 1 ||
    !Number.isInteger(tenantBurst) || tenantBurst < 1 ||
    !Number.isInteger(degradedWaitMs) || degradedWaitMs < 0 ||
    !Number.isInteger(maxWaitMs) || maxWaitMs < 0
  ) {
    throw new ConfigError(
      'login_limit_invalid',
      'the admission control values are not valid numbers',
    );
  }
  const trustPeerAddressRaw = env['WASL_LOGIN_TRUST_PEER_ADDRESS'] ?? '0';
  if (trustPeerAddressRaw !== '0' && trustPeerAddressRaw !== '1') {
    throw new ConfigError(
      'login_limit_invalid',
      'WASL_LOGIN_TRUST_PEER_ADDRESS must be 0 or 1',
    );
  }
  const maxTenantAttempts = Number(
    env['WASL_LOGIN_MAX_TENANT_ATTEMPTS'] ?? String(defaults.rateLimit.maxTenantAttempts),
  );
  const rateWindow = Number(
    env['WASL_LOGIN_WINDOW_SECONDS'] ?? String(defaults.rateLimit.windowSeconds),
  );
  if (!Number.isInteger(maxAccountAttempts) || maxAccountAttempts < 1) {
    throw new ConfigError('login_limit_invalid', 'WASL_LOGIN_MAX_ATTEMPTS must be a positive integer');
  }
  if (!Number.isInteger(maxTenantAttempts) || maxTenantAttempts < 1) {
    throw new ConfigError(
      'login_limit_invalid',
      'WASL_LOGIN_MAX_TENANT_ATTEMPTS must be a positive integer',
    );
  }
  if (!Number.isInteger(rateWindow) || rateWindow < 1) {
    throw new ConfigError('login_limit_invalid', 'WASL_LOGIN_WINDOW_SECONDS must be a positive integer');
  }
  if (!Number.isInteger(maxGlobalAttempts) || maxGlobalAttempts < 1) {
    throw new ConfigError(
      'login_limit_invalid',
      'WASL_LOGIN_MAX_GLOBAL_ATTEMPTS must be a positive integer',
    );
  }
  if (!Number.isInteger(maxPeerAttempts) || maxPeerAttempts < 0) {
    throw new ConfigError(
      'login_limit_invalid',
      'WASL_LOGIN_MAX_PEER_ATTEMPTS must be zero or a positive integer',
    );
  }
  // ⭐ The log level may be lowered by the environment (the profile
  //   default stays the starting point).
  const logLevelName = (env['WASL_LOG_LEVEL'] ?? defaults.logLevel) as LogLevel;
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevelName)) {
    throw new ConfigError('log_level_invalid', 'WASL_LOG_LEVEL is not a known level');
  }
  return {
    profile,
    host: serverHost ?? '127.0.0.1',
    port: parsedPort,
    appDatabaseUrl: buildUrl(databaseName, 'wasl_app', password, host, port),
    ownerDatabaseUrl: buildUrl(databaseName, 'wasl_owner', ownerPassword, host, port),
    databaseName,
    sessionTtlSeconds: ttl,
    rateLimit: {
      maxAccountAttempts,
      maxTenantAttempts,
      maxGlobalAttempts,
      maxPeerAttempts,
      windowSeconds: rateWindow,
      trustPeerAddress: trustPeerAddressRaw === '1',
      globalRatePerSecond,
      globalBurst,
      tenantRatePerSecond,
      tenantBurst,
      degradedWaitMs,
      maxWaitMs,
    },
    logLevel: logLevelName,
    testPasscode: requireString(
      env['WASL_TEST_PASSCODE'] ?? DEFAULT_TEST_PASSCODE,
      'test_passcode_missing',
      'WASL_TEST_PASSCODE is required',
    ),
    repoRoot,
  };
}
