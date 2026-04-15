#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=".cnb"
LOG_FILE="${LOG_DIR}/preview.log"
PID_FILE="${LOG_DIR}/preview.pid"

mkdir -p "$LOG_DIR"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
fi

bun install --frozen-lockfile
bun run build:web

if command -v setsid >/dev/null 2>&1; then
  setsid sh -c 'exec env PHODEX_HOST=0.0.0.0 PHODEX_PORT=8686 bun run cnb:preview >>"$1" 2>&1' sh "$LOG_FILE" </dev/null &
  echo "$!" >"$PID_FILE"
else
  nohup sh -c 'exec env PHODEX_HOST=0.0.0.0 PHODEX_PORT=8686 bun run cnb:preview >>"$1" 2>&1' sh "$LOG_FILE" >/dev/null 2>&1 </dev/null &
  echo "$!" >"$PID_FILE"
fi

for _ in $(seq 1 90); do
  if curl --silent --fail http://127.0.0.1:8686/api/health >/dev/null; then
    tail -n 20 "$LOG_FILE" || true
    exit 0
  fi
  sleep 1
done

cat "$LOG_FILE" >&2 || true
exit 1
