// ============================================================
// WASL AI — FOUNDATION BUILD 02 — structured logging
// ------------------------------------------------------------
// ⭐ One JSON object per line: the format a log collector can read
//   without a parser.
// ⭐ Every line carries: the timestamp, the level, the service, the
//   event name and the request id (when there is one).
// ⛔ NOTHING SENSITIVE IS EVER LOGGED. The field names are an explicit
//   allow list: a field that is not on the list is dropped, so a new
//   call site cannot leak a passcode, a token, a message body or a
//   personal datum by accident.
// ⛔ The values are scanned as well: a value that looks like a session
//   token is replaced by a placeholder.
// ⛔ The message body of a request is never logged: only the method,
//   the path (without the query string) and the status.
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

/** ⭐ The allow list of the fields that may be written. */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'request_id',
  'method',
  'path',
  'status',
  'duration_ms',
  'tenant_id',
  'user_id',
  'session_id',
  'code',
  'reason',
  'profile',
  'host',
  'port',
  'status_code',
  'db_ok',
  'schema_version',
  'uptime_ms',
  'event',
  'detail',
]);

/** ⭐ A value that looks like a bearer token is never written. */
const TOKEN_LIKE = /^(wsl\.|eyJ)/i;

export interface LogFields {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface Logger {
  readonly level: LogLevel;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly service: string;
  /** ⭐ Where the lines go. The default is the standard output. */
  readonly write?: (line: string) => void;
  /** ⭐ Fixed fields added to every line (the request id for example). */
  readonly base?: LogFields;
}

function sanitizeValue(value: string | number | boolean | null | undefined): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (TOKEN_LIKE.test(value)) return '[redacted]';
  if (value.length > 256) return `${value.slice(0, 256)}...`;
  return value;
}

function pick(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    out[key] = sanitizeValue(value);
  }
  return out;
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const base = options.base ? pick(options.base) : {};

  const emit = (level: LogLevel, event: string, fields: LogFields | undefined, extra: LogFields): void => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      service: options.service,
      event,
      ...base,
      ...(fields ? pick(fields) : {}),
      ...pick(extra),
    };
    try {
      write(JSON.stringify(record));
    } catch {
      // ⛔ A logging failure must never break a request.
    }
  };

  const logger: Logger = {
    level: options.level,
    debug: (event, fields) => emit('debug', event, fields, {}),
    info: (event, fields) => emit('info', event, fields, {}),
    warn: (event, fields) => emit('warn', event, fields, {}),
    error: (event, fields) => emit('error', event, fields, {}),
    child: (fields) =>
      createLogger({
        level: options.level,
        service: options.service,
        write,
        base: { ...base, ...pick(fields) },
      }),
  };
  return logger;
}

/** ⭐ A logger that writes nothing (used by the silent test profile). */
export function createSilentLogger(service = 'wasl-local-api'): Logger {
  return createLogger({ level: 'silent', service, write: () => undefined });
}
