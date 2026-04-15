#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=".cnb"
LOG_FILE="${LOG_DIR}/relay-preview.log"
PID_FILE="${LOG_DIR}/relay-preview.pid"
URL_FILE="${LOG_DIR}/relay-preview-url.txt"

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

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    printf '[phodex-preview] relay already running with pid %s\n' "$old_pid"
    print_preview_origin
    exit 0
  fi
fi

if command -v setsid >/dev/null 2>&1; then
  setsid env PHODEX_HOST=0.0.0.0 PHODEX_PORT=8686 bun run cnb:preview >>"$LOG_FILE" 2>&1 </dev/null &
else
  nohup env PHODEX_HOST=0.0.0.0 PHODEX_PORT=8686 bun run cnb:preview >>"$LOG_FILE" 2>&1 </dev/null &
fi

echo "$!" >"$PID_FILE"

for _ in $(seq 1 90); do
  if curl --silent --fail http://127.0.0.1:8686/api/health >/dev/null; then
    print_preview_origin
    tail -n 20 "$LOG_FILE" || true
    exit 0
  fi
  sleep 1
done

cat "$LOG_FILE" >&2 || true
exit 1
