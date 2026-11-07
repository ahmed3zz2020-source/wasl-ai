// ============================================================
// WASL AI — FOUNDATION BUILD 01 — local API server
// ------------------------------------------------------------
// ⭐ npm run server
// ⭐ Binds 127.0.0.1 only. The only outbound connection is the local
//   PostgreSQL server.
// ============================================================

import { loadConfig } from '../server/config.ts';
import { createPool } from '../server/db/pool.ts';
import { WaslApiServer } from '../server/api/server.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.appDatabaseUrl, 8);
  const api = new WaslApiServer({ config, pool });
  const address = await api.listen();
  process.stdout.write(`wasl local api listening on http://${address.host}:${address.port}\n`);
  process.stdout.write(`ui: http://${address.host}:${address.port}/ui/index.html\n`);
  process.stdout.write(`database: ${config.databaseName} (role wasl_app, RLS enforced)\n`);

  const shutdown = async (): Promise<void> => {
    await api.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`server failed: ${String((error as Error)?.message ?? error)}\n`);
  process.exitCode = 1;
});
