#!/bin/bash
# WASL AI — the authoritative full-suite run AFTER the commit (round #59)
# ⭐ one clean run ⇒ the log binds to the published SHA
set -u
cd /workspace/wasl-ai
export PGHOST=/tmp PGPORT=5432 PGUSER=postgres
export PGDATABASE=wasl_local
LOG=logs/2026-11-11-m126-m130-npm-test.log
pkill -f "node --experimental-strip-types --test" 2>/dev/null
sleep 2
start=$(date +%s)
npm test > "$LOG" 2>&1
code=$?
end=$(date +%s)
echo "EXIT=$code duration=$((end-start))s" >> "$LOG"
echo "SHA=$(git rev-parse HEAD)" >> "$LOG"
echo "=== DONE EXIT=$code duration=$((end-start))s ==="
grep -E "^# (tests|pass|fail|skipped) " "$LOG" | tail -4
