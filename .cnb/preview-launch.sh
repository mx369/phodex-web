#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=".cnb"
LOG_FILE="${LOG_DIR}/relay-preview.log"
PID_FILE="${LOG_DIR}/relay-preview.pid"
URL_FILE="${LOG_DIR}/relay-preview-url.txt"
HEALTH_URL="${PHODEX_PREVIEW_HEALTH_URL:-http://127.0.0.1:8686/api/health}"

mkdir -p "$LOG_DIR"

print_preview_origin() {
  local preview_origin=""
  if [[ -n "${CNB_VSCODE_PROXY_URI:-}" ]]; then
    preview_origin="${CNB_VSCODE_PROXY_URI//\{\{port\}\}/8686}"
    printf '%s\n' "$preview_origin" >"$URL_FILE"
    printf '[phodex-preview] direct origin %s\n' "$preview_origin"
    printf '[phodex-preview] bridge target %s\n' "${preview_origin/https:/wss:}/bridge?secret=..."
  else
    printf '[phodex-preview] CNB_VSCODE_PROXY_URI is unavailable; preview origin was not derived.\n'
  fi
}

healthcheck() {
  local target="$1"
  python3 - "$target" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open(url, timeout=2) as response:
        if response.status != 200:
            raise SystemExit(1)
        payload = json.load(response)
        raise SystemExit(0 if payload.get("ok") else 1)
except Exception:
    raise SystemExit(1)
PY
}

build_health_targets() {
  HEALTH_TARGETS=("$HEALTH_URL")
  local container_ip=""

  if [[ "$HEALTH_URL" == *"127.0.0.1"* ]]; then
    HEALTH_TARGETS+=("${HEALTH_URL/127.0.0.1/localhost}")
    container_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [[ -n "$container_ip" ]]; then
      HEALTH_TARGETS+=("${HEALTH_URL/127.0.0.1/$container_ip}")
    fi
  fi
}

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    printf '[phodex-preview] relay already running with pid %s\n' "$old_pid"
    print_preview_origin
    exit 0
  fi
fi

printf '[phodex-preview] launching relay for %s\n' "$HEALTH_URL" >>"$LOG_FILE"
nohup env PHODEX_HOST=0.0.0.0 PHODEX_PORT=8686 bun run cnb:preview >>"$LOG_FILE" 2>&1 </dev/null &

echo "$!" >"$PID_FILE"
relay_pid="$!"
build_health_targets

for _ in $(seq 1 90); do
  for target in "${HEALTH_TARGETS[@]}"; do
    if healthcheck "$target"; then
      printf '[phodex-preview] healthcheck passed via %s\n' "$target" >>"$LOG_FILE"
      print_preview_origin
      tail -n 20 "$LOG_FILE" || true
      exit 0
    fi
  done
  if ! kill -0 "$relay_pid" 2>/dev/null; then
    printf '[phodex-preview] relay exited before healthcheck passed\n' >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 1
done

printf '[phodex-preview] healthcheck timed out for %s\n' "$HEALTH_URL" >&2
cat "$LOG_FILE" >&2 || true
exit 1
