#!/bin/sh
# the local alert channel: probe -> threshold -> delivery -> receipt
SINK="$1"; URL="$2"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL" 2>/dev/null)
[ -z "$CODE" ] && CODE=000
if [ "$CODE" != "200" ]; then
  printf '%s | ALERT | health_probe_failed | http_code=%s | url=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CODE" "$URL" >> "$SINK"
  echo "ALERT FIRED (http_code=$CODE)"
  exit 1
fi
echo "OK (http_code=$CODE)"
exit 0
