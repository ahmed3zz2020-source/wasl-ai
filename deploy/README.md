# WASL AI — Deployment Reference (inert examples)

> ⛔ **NOT ACTIVE · NOT DEPLOYED · NOT LOADED.**
> Nothing in this directory is running, published, or reachable.
> No service was created, no container was started, no certificate was
> issued, and **no paid resource of any kind exists**.
> Running anything described here is **out of scope of the current owner
> directive**. Every file in this directory is inert documentation.

## Files in this directory

| File | Kind | State |
|---|---|---|
| `README.md` | Documentation | Reference only |
| `env.example` | Template | Placeholder values only — no real secret |
| `nginx.conf.example` | Example config | Never loaded by nginx — placeholder TLS paths |
| `docker-compose.staging.example.yml` | Example compose file | Never started — no credentials inside |

---

## 1. Purpose

This directory is a **written plan** for a *future, experimental staging
deployment* of the WASL AI local API server (`npm run server`,
`tools/wasl-server.ts`) together with its PostgreSQL database.

Its only purpose today is to make the intended shape of that future
deployment reviewable **before** anything is built:

* the environment profiles and how they are selected,
* the full list of environment variables the code reads,
* where secrets come from and where they must never go,
* how TLS, deployment, backup and observability are intended to work.

Explicitly stated, because it matters:

* ⛔ **Nothing here is deployed.** No host, no container, no domain, no
  certificate, no database instance outside the developer machine exists.
* ⛔ **No service was created** for this plan, by any provider.
* ⛔ **No paid resource exists.** The plan targets a single small host or
  a single private network, if it is ever authorised.
* ⛔ **Running these files is out of scope of the current owner directive.**
  They are reference material, and they are safe to read.

The current build is local-only by design: `server/config.ts` binds the
HTTP server to `127.0.0.1` by default and the only outbound connection is
the local PostgreSQL server. The staging profile below describes a
**future** change of that posture and therefore requires a new, explicit
owner directive before any code or infrastructure is touched.

---

## 2. Environment profiles

Three profiles are **implemented** (FOUNDATION BUILD 02 / PHASE 01). The
profile is selected by the environment variable **`WASL_ENV`** and it is
read by `server/config.ts`.

⛔ **The staging profile is a settings profile, not a deployment.** It
exists so that the values of a future experimental host are written down
and fail closed. No service is deployed by it and none may be, without a
new, explicit owner directive.

| Profile | Purpose | Port | Bind host | Session TTL | Log level | Selected by |
|---|---|---|---|---|---|---|
| `development` | Day-to-day work on the developer machine | `8787` | `127.0.0.1` | `3600` s | `debug` | `WASL_ENV=development` (the default) |
| `test` | Automated test suite and the local end-to-end journey tool; no shared state | `8787` (ephemeral is fine) | `127.0.0.1` | `3600` s | `silent` | `WASL_ENV=test` |
| `staging` | Future experimental staging, reachable only through the TLS reverse proxy | `8787` | **explicit — never implicit** (see below) | `900` s | `info` | `WASL_ENV=staging` |

Notes:

* The port comes from `WASL_SERVER_PORT`; the bind host comes from
  `WASL_SERVER_HOST`; the session TTL comes from
  `WASL_SESSION_TTL_SECONDS`. The values above are the profile defaults.
* ⭐ **The staging profile must have an explicit bind host.** The
  variable `WASL_SERVER_HOST` must be set deliberately to a concrete
  address in the staging environment. The code default is `127.0.0.1`,
  which is the correct and safe value; the staging profile must never
  rely on the default by accident, because a container that must be
  reachable from the proxy or the orchestrator needs `0.0.0.0` explicitly
  written down. An implicit bind host is a deployment bug.
* ⭐ The log level is a real switch: `server/log.ts` writes one JSON
  object per line, and `WASL_LOG_LEVEL` (`debug`, `info`, `warn`,
  `error`, `silent`) overrides the level of the profile. The test profile
  is `silent`, so the suite prints no log lines.
* The staging session TTL is `900` s (15 minutes) — shorter than the
  local default, because a staging tenant is a real person on a shared
  host.

---

## 3. Secrets

### The rule

⛔ **All secrets come from environment variables only.** There is no
secret file, no secret store client, no hard-coded credential and no
credential in the repository. `server/config.ts` is fail-closed: a missing
or invalid value throws a `ConfigError` instead of silently falling back,
and it builds the PostgreSQL connection URLs from the individual
variables at runtime. Nothing is written to disk by the server.

### Where secrets must never go

* ⛔ Never into the repository. `.local/` is already listed in
  `.gitignore` and is where `npm run db:setup` writes the generated
  local credentials (`tools/wasl-db-setup.ts` writes
  `.local/pg-credentials.json` with mode `0600`).
* ⛔ Never into a committed `.env`. ⚠️ **Current state:** the repository
  `.gitignore` covers `.local/` **but does not list `.env`**. Any real
  environment file must therefore live outside the repository (or be
  explicitly ignored) until a follow-up change adds the rule. This
  directory does not change `.gitignore`.
* ⛔ Never into a log line, an error message, a container image layer, a
  commit message or a chat message.
* ⛔ Never into `deploy/env.example`. That file is a **template with
  placeholder values only** — every value in it is a placeholder such as
  `CHANGE_ME` or `<paste-here>`. It is safe to commit and it is safe to
  read.

### The variables the code reads

Source of truth: `server/config.ts` (plus two variables that the
command-line tools read — they are noted after the table).

| Variable | What it is | Required? |
|---|---|---|
| `WASL_PG_HOST` | PostgreSQL host as seen by the backend process | No — defaults to `127.0.0.1` |
| `WASL_PG_PORT` | PostgreSQL TCP port | No — defaults to `5432`; must be a valid port or startup fails |
| `WASL_PG_DATABASE` | Name of the application database | No — defaults to `wasl_local` |
| `WASL_PG_PASSWORD` | Secret: password of the **request** role `wasl_app` (`NOBYPASSRLS`) | **Yes** in a deployment — the only fallback is `.local/pg-credentials.json`, which does not exist inside a container |
| `WASL_PG_OWNER_PASSWORD` | Secret: password of the **migration/seed** role `wasl_owner` | **Yes** for the migration step — without it the setup reuses the app secret and the migration connection fails to authenticate |
| `WASL_SERVER_HOST` | Bind address of the HTTP server | No — defaults to `127.0.0.1`; **must be explicit in staging** |
| `WASL_SERVER_PORT` | TCP port of the HTTP server | No — defaults to `8787`; must be a valid port or startup fails |
| `WASL_SESSION_TTL_SECONDS` | Session lifetime, in seconds | No — defaults to `3600`; must be a positive integer |
| `WASL_TEST_PASSCODE` | Secret: the **synthetic** fixture passcode used by the database seed | Optional in code (a built-in synthetic fixture default exists) — set it explicitly in any shared environment so the fixture default is never used |
| `WASL_SERVER_URL` | Base URL of an already-running server, used by the end-to-end journey tool | Only for `npm run e2e` |
| `WASL_PG_SUPERUSER_URL` | Secret-bearing superuser connection URL used by the database setup command | Only for `npm run db:setup` — it embeds a credential, so it is supplied in the operator's shell and never stored |

Two of the names above are **not** read by `server/config.ts`: they are
read by the tools — `WASL_SERVER_URL` by `tools/wasl-e2e-journey.ts` and
`WASL_PG_SUPERUSER_URL` by `tools/wasl-db-setup.ts`. They are part of the
same environment contract and are listed in `deploy/env.example`.

⛔ `WASL_PG_SUPERUSER_URL` embeds the PostgreSQL superuser credential.
It must be supplied on the command line of the operator's own shell. It
must never be written to a file inside the repository, never committed,
and never echoed into a log.

### Where the values come from in a future staging run

* A **secret store / secret injection** on the host (the mechanism is not
  chosen yet; it is a decision for the future directive), or
* plain environment variables exported by the operator for a
  single-host experiment.

Either way the values reach the process as environment variables and
nowhere else.

---

## 4. TLS — plan only

⛔ **This section is a written plan. No certificate exists, no port 443
is open, and nothing terminates TLS today.**

The intended design:

1. **Terminate TLS at a reverse proxy** in front of the backend. The
   Node process keeps speaking plain HTTP on `127.0.0.1:8787`; it never
   handles a certificate and never sees the public address.
2. **Redirect HTTP → HTTPS.** Port 80 answers every request with a `301`
   to the same path on `https://`. No content is served over plain HTTP.
3. **HSTS.** After the certificate is proven on the domain,
   `Strict-Transport-Security: max-age=31536000; includeSubDomains` is
   sent. It is added only once the redirect and the certificate are
   stable — an HSTS header on a broken endpoint locks users out.
4. **Standard security headers** at the proxy: `X-Content-Type-Options:
   nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   and `X-Forwarded-Proto: https`.
5. **Certificate lifecycle** — planned, for the future directive:
   issue with ACME (Let's Encrypt) or an equivalent, renew automatically
   before expiry (renewal window well inside the 90-day validity), alert
   on failure, and reload the proxy after renewal without a restart.
6. ⛔ **No real certificate file, key or chain may ever enter this
   repository.** The certificate and the private key live on the host in
   a root-readable location outside the working tree. The repository holds
   only the *paths* to them, and only as placeholders.

The example reverse-proxy configuration is
[`deploy/nginx.conf.example`](./nginx.conf.example). It is an **example
only**: it is never loaded by nginx, and every certificate path in it is a
placeholder.

---

## 5. Deployment — plan only

⛔ **This section is a written plan. No deployment happened, and none may
happen without a new owner directive.**

The intended sequence, for the day such a directive exists:

1. **Container image.** One image for the backend, built from the
   repository root (`build.context: ..` in the compose example). ⚠️
   **Current state:** no `Dockerfile` exists in the repository — it must be
   written and reviewed under a future directive. The image is expected
   to carry the Node runtime, the repository sources and the production
   dependencies only (`pg`); the development dependencies and any local
   credential file must stay out of the image.
2. **Migration step.** `npm run db:setup`
   (`tools/wasl-db-setup.ts`) runs **once per release, as a separate
   one-shot job, before the new backend starts** — never as part of the
   backend entrypoint, so that N replicas do not race on the schema. It
   creates the two roles, applies the migrations in
   `server/db/migrations/` (`001_foundation.sql`,
   `002_deletion_evidence.sql`) and seeds the synthetic fixtures. It
   needs the superuser URL and the owner secret from the environment.
3. **Health check.** The liveness endpoint is
   `GET /health` (the root path `GET /` answers the same, and so does
  `GET /api/health`). It is a real readiness probe: it answers `503` when
  the database is not reachable. Today it
   returns HTTP `200` with the body
   `{"ok":true,"service":"wasl-local-api","scope":"local-test"}`.
   ⚠️ Two facts to keep in mind: the route is **`/health`**, not
   `/api/health` — the `/api/*` space requires a session — and the
   current answer is a **static liveness reply that does not touch
   PostgreSQL**. A readiness probe that actually verifies the database
   does not exist yet and would have to be added.
4. **Graceful shutdown.** `tools/wasl-server.ts` handles `SIGINT` and
   `SIGTERM`: it closes the HTTP server (`api.close()`), drains the
   connection pool (`pool.end()`) and exits `0`. The container stop
   grace period must be longer than the slowest in-flight request so
   that the drain is not cut short.
5. **Rollback.** Keep the previous image digest. To roll back, redeploy
   the previous image. ⚠️ The migrations are **forward-only numbered
   files — there is no down-migration**, so a rollback that also needs
   the database rolled back requires a restore from the backup of section
   6, not a second migration command.

The example topology is
[`deploy/docker-compose.staging.example.yml`](./docker-compose.staging.example.yml):
a `backend` service published only on `127.0.0.1:8787` (the reverse
proxy is the only public entry point) and a `postgres` service that is
**not published to the host at all** — it is reachable only on the
internal compose network.

⛔ The compose file is an **example that was never started**. It contains
no credential values; every secret is a variable substitution resolved
from the operator's environment.

---

## 6. Backup and restore — the local drill is implemented

⭐ **The local drill was executed** (FOUNDATION BUILD 02 / PHASE 01): the
scripts below exist, they are covered by `tests/server/foundation-backup.test.ts`
and the drill ran against the real local PostgreSQL. The operational
schedule below is still a **written plan** — no scheduled job exists and
no remote copy is stored anywhere.

* **What to dump.** The whole application database — schema and data —
  in a single logical dump (`pg_dump` in a self-describing format) of
  the database created by `npm run db:setup`. It covers the tenants,
  users, memberships, sessions, conversations, captures, retention
  policies and the deletion-evidence tables of
  `server/db/migrations/002_deletion_evidence.sql`. A dump also covers
  the roles' grants; the role *secrets* are not part of the dump and are
  rotated separately.
* **Schedule.** One full dump per day, plus an on-demand dump **before
  every release and before every migration**.
* **Retention.** 7 daily dumps and 4 weekly dumps, encrypted at rest,
  stored outside the repository and outside the host, with access
  restricted to the operator. A dump that contains tenant data must never
  be committed to Git.
* **Restore drill.** Once a month, restore a dump into a scratch
  database, run the application against it, and record the result. A
  backup that has never been restored is not a backup.
* **Verification of the restored row counts.** After every restore, the
  per-table row counts of the restored copy are compared with the
  counts recorded for the original dump — `tenants`, `users`,
  `memberships`, `sessions`, `conversations`, `captures` — and the
  comparison must be an exact match. The counts and the outcome are
  written in the drill report, so a silent divergence is visible.

⭐ **The local drill is performed by three scripts in `tools/`:**

| Script | Command | What it does |
|---|---|---|
| `tools/wasl-db-backup.ts` | `npm run db:backup` | Writes `pg_dump` (custom format) of the application database into `.local/backups/` (git ignored) |
| `tools/wasl-db-restore.ts` | `npm run db:restore -- <dump> --target <db>` | Restores a dump into a scratch database and reports the schema, the migrations, the fixtures and whether the password hashes still verify |
| `tools/wasl-db-rebuild.ts` | `npm run db:rebuild -- --yes` | Drops the local database and builds it again from zero (roles, migrations, fixtures) — the proof that the environment is reproducible |

⛔ **The dump runs with a privileged connection** (`WASL_PG_SUPERUSER_URL`):
the tables have row level security FORCED, so a role that does not
bypass RLS cannot read them (`pg_dump` would fail with *query would be
affected by row-level security policy*). In a real deployment this role
is a dedicated backup role with `BYPASSRLS` — never the application
role, and never the superuser of a production cluster.

⭐ **The drill is covered by a test:** `tests/server/foundation-backup.test.ts`
takes a real dump, restores it into a scratch database, checks that the
migrations, the fixtures and the derived password hashes came back, and
drops the scratch database afterwards. The drill is **skipped** (not
failed) when the privileged connection is not available.

---

## 7. Observability — the structured log is implemented

### Structured logs

⭐ **One JSON object per line on stdout** is implemented in `server/log.ts`
(one line per request, plus the security events). The fields are:

| Field | Content |
|---|---|
| `ts` | Timestamp, ISO 8601, UTC |
| `level` | `debug` / `info` / `warn` / `error`, from the profile log level |
| `event` | A stable machine-readable event name (`http.request`, `db.error`, …) |
| `request_id` | The request identifier (see below) |
| `method`, `route`, `status`, `duration_ms` | HTTP facts, for request lines |
| `tenant_id`, `user_id`, `session_id` | Identifiers only, when the event has them |
| `error_code` | The application error code (`route_not_found`, `token_invalid`, …) when the event failed |

⭐ **The field names are an allow list:** a field that is not on the list
is dropped, so a new call site cannot leak a passcode, a token, a
message body or a personal datum by accident. A value that looks like a
bearer token is replaced by `[redacted]`. The event names in use are
`http_request`, `login_failed`, `login_rate_limited` and `pool_error`.

### Request id

The reverse proxy assigns a request identifier and forwards it in
`X-Request-Id` (see `proxy_set_header X-Request-Id` in
`deploy/nginx.conf.example`). The backend **echoes that value** in every
log line of that request and in the `x-request-id` response header, so
that a single identifier joins the proxy access log and the application
log.

⭐ **Implemented:** the server reads `X-Request-Id` when the value is safe
(`[A-Za-z0-9._-]{1,64}`) and generates `req_<random>` otherwise.
under a future directive.

### What must never be logged

⛔ Never log, in any log level, in any error message and in any support
bundle:

* **Passcodes** — the login passcode of any user, in any form, including
  a hash of it.
* **Session tokens** — the raw bearer token returned once by
  `POST /api/session`. Only the token *hash* that the database stores
  may be referenced, and only as an opaque identifier.
* **Message bodies** — conversation content, journey messages, capture
  payloads, request and response bodies. Log the *size* and the
  *outcome*, never the content.
* **Personal data** — display names, contact details, and any content
  that identifies a natural person.
* **Credentials** — database passwords, connection URLs (they embed the
  password), the contents of `.local/pg-credentials.json`, and the
  superuser URL.

### Health and readiness endpoints

| Endpoint | Purpose | Today |
|---|---|---|
| `GET /health`, `GET /`, `GET /api/health` | Liveness and readiness — is the process serving requests and is the database reachable | **Exists.** Returns `200` with the service, the scope, the `profile`, `db_ok`, the `schema_version`, the `uptime_ms` and the rate limit policy; `503` when the database is down. It exposes no secret, no host and no connection string |
| Readiness — database check | Can the process actually serve a request | ⛔ **Does not exist yet.** The liveness answer is static and does not query PostgreSQL; it has to be added under a future directive |

---

⛔ **Closing statement.** This directory is documentation. Nothing in it
has been activated, nothing has been deployed, no service exists and no
paid resource exists. Any future action described here requires a new,
explicit owner directive.
