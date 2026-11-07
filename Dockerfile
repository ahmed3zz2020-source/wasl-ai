# ============================================================
# WASL AI — production image (EXAMPLE — local build only)
# ------------------------------------------------------------
# ⛔ THIS IMAGE WAS NEVER BUILT IN THE CURRENT ENVIRONMENT: the
#   sandbox has no Docker daemon (see the Phase 02 report, the
#   section about M-70). The file is a buildable definition, and the
#   checks that can run without a daemon (no secret, a non root user,
#   the health check, the graceful shutdown) are part of the test
#   suite.
# ⛔ NO SECRET IS BAKED INTO THE IMAGE: every value comes from the
#   environment of the container at run time.
# ⛔ The image runs as a NON ROOT user and it binds the loopback of
#   the container: the reverse proxy is the only public entry point.
# ------------------------------------------------------------

FROM node:22-alpine

# ⭐ The runtime label: the container says what it is.
LABEL org.opencontainers.image.title="wasl-ai-backend" \
      org.opencontainers.image.description="WASL AI customer service backend (local preparation)" \
      org.opencontainers.image.licenses="UNLICENSED"

WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS=--experimental-strip-types

# ⭐⭐ The dependencies first: the layer is cached and the source is
#   copied after it. \u26d4 The PostgreSQL client is the only runtime
#   dependency of the server.
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=optional

# ⭐ The source of the service. \u26d4 `src/core` is the frozen core:
#   it is copied as it is, never built and never patched here.
COPY src ./src
COPY server ./server
COPY tools ./tools

# ⭐⭐ A non root user: the process never runs as root.
RUN addgroup -S wasl && adduser -S wasl -G wasl && chown -R wasl:wasl /app
USER wasl

EXPOSE 8787

# ⭐ The liveness probe: the process answers /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ⭐ The graceful shutdown is the responsibility of the process: it
#   handles SIGTERM, stops accepting, drains and closes the pool.
STOPSIGNAL SIGTERM

CMD ["node", "--experimental-strip-types", "tools/wasl-server.ts"]
