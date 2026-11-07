// ============================================================
// WASL AI — FOUNDATION BUILD 01 — local HTTP client
// ------------------------------------------------------------
// ⭐ A real HTTP client against 127.0.0.1: the journey must travel
//   through the HTTP layer and PostgreSQL, not through the memory.
// ⛔ It refuses any host other than the loopback interface.
// ============================================================

import http from 'node:http';

export interface ApiResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface RequestOptions {
  readonly method?: string;
  readonly path: string;
  readonly token?: string | null;
  readonly payload?: unknown;
  /**
   * ⭐ D-069 / M67: extra headers (the tests need to send a
   *   spoofed X-Forwarded-For and prove that it changes nothing).
   */
  readonly headers?: Readonly<Record<string, string>>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export class LocalApiClient {
  readonly #host: string;
  readonly #port: number;
  /** ⭐⭐ A fresh connection on every request (no reused socket). */
  readonly #fresh: boolean;

  constructor(host = '127.0.0.1', port = 8787, options: { readonly fresh?: boolean } = {}) {
    if (!LOOPBACK.has(host)) {
      throw new Error(`refusing to call a non loopback host: ${host}`);
    }
    this.#host = host;
    this.#port = port;
    this.#fresh = options.fresh === true;
  }

  async request(options: RequestOptions): Promise<ApiResponse> {
    const payload = options.payload === undefined ? null : JSON.stringify(options.payload);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: this.#host,
          port: this.#port,
          path: options.path,
          method: options.method ?? 'GET',
          // ⭐⭐ A fresh connection ⇒ a socket of a closed server is
          //   never reused (the drill of a RESTART needs it).
          ...(this.#fresh ? { agent: false } : {}),
          headers: {
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
            ...(payload ? { 'content-type': 'application/json' } : {}),
            ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
            ...(options.headers ?? {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body: Record<string, unknown> = {};
            try {
              body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            } catch {
              body = { raw };
            }
            resolve({ status: response.statusCode ?? 0, body });
          });
        },
      );
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }
}
