// ============================================================
// WASL AI — FOUNDATION BUILD 01 — server configuration
// ------------------------------------------------------------
// ⭐ Fail-closed: a missing/!invalid value throws instead of
//   falling back to a default. No secret is ever hard coded.
// ⛔ The server binds to 127.0.0.1 only. It is not exposed to the
//   internet and has no public deployment path in this build.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  /** ⭐ Request path connection (role `wasl_app`, NOBYPASSRLS). */
  readonly appDatabaseUrl: string;
  /** ⭐ Migration/seed connection (role `wasl_owner`). */
  readonly ownerDatabaseUrl: string;
  readonly databaseName: string;
  readonly sessionTtlSeconds: number;
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
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_DB_NAME = 'wasl_local';
const DEFAULT_TEST_PASSCODE = 'wasl-local-test';

function requireString(value: string | undefined, code: string, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(code, message);
  }
  return value;
}

function readCredentialFile(repoRoot: string): string | null {
  const file = path.join(repoRoot, '.local', 'pg-credentials.json');
  try {
    if (!fs.existsSync(file)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const password = record['app_password'] ?? record['password'];
      if (typeof password === 'string' && password !== '') return password;
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
  options: { readonly requirePassword?: boolean } = {},
): ServerConfig {
  const host = env['WASL_PG_HOST'] ?? '127.0.0.1';
  const port = Number(env['WASL_PG_PORT'] ?? '5432');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError('pg_port_invalid', 'WASL_PG_PORT is not a valid TCP port');
  }
  const databaseName = env['WASL_PG_DATABASE'] ?? DEFAULT_DB_NAME;
  const password =
    env['WASL_PG_PASSWORD'] ?? readCredentialFile(repoRoot) ?? '';
  if (password === '' && options.requirePassword !== false) {
    throw new ConfigError(
      'pg_password_missing',
      'WASL_PG_PASSWORD is not set and .local/pg-credentials.json is missing - run the database setup first',
    );
  }  const parsedPort = Number(env['WASL_SERVER_PORT'] ?? String(DEFAULT_PORT));
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new ConfigError('server_port_invalid', 'WASL_SERVER_PORT is not a valid TCP port');
  }
  const ttl = Number(env['WASL_SESSION_TTL_SECONDS'] ?? String(DEFAULT_TTL_SECONDS));
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new ConfigError('session_ttl_invalid', 'WASL_SESSION_TTL_SECONDS must be a positive integer');
  }
  return {
    host: env['WASL_SERVER_HOST'] ?? '127.0.0.1',
    port: parsedPort,
    appDatabaseUrl: buildUrl(databaseName, 'wasl_app', password, host, port),
    ownerDatabaseUrl: buildUrl(databaseName, 'wasl_owner', password, host, port),
    databaseName,
    sessionTtlSeconds: ttl,
    testPasscode: requireString(
      env['WASL_TEST_PASSCODE'] ?? DEFAULT_TEST_PASSCODE,
      'test_passcode_missing',
      'WASL_TEST_PASSCODE is required',
    ),
    repoRoot,
  };
}
