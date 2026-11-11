#!/bin/bash
# WASL AI — sequential per-group measurement (round #59 / M126..M130)
# ⭐ one group at a time (no overlap) ⇒ no port / database interference
# ⭐ logs live in the repo (logs/) so a /tmp wipe cannot lose them
set -u
cd /workspace/wasl-ai
export PGHOST=/tmp PGPORT=5432 PGUSER=postgres
export PGDATABASE=wasl_local
OUT=logs/2026-11-11-m126-m130-groups.log
: > "$OUT"

for g in unit integration security recovery; do
  echo "=== GROUP $g ===" | tee -a "$OUT"
  LOG="logs/2026-11-11-m126-m130-group-$g.log"
  # ⭐ kill any stale test process before each group (house rule)
  pkill -f "node --experimental-strip-types --test" 2>/dev/null
  sleep 2
  start=$(date +%s)
  npm run "test:$g" > "$LOG" 2>&1
  code=$?
  end=$(date +%s)
  echo "EXIT=$code duration=$((end-start))s" | tee -a "$OUT"
  grep -E "^# (tests|pass|fail|skipped) " "$LOG" | tail -4 | tee -a "$OUT"
  echo "" | tee -a "$OUT"
done
echo "=== ALL GROUPS DONE ===" | tee -a "$OUT"
