#!/usr/bin/env bash
set -euo pipefail

Color_Off=''
Red=''
Green=''
Dim=''
Bold_White=''
Bold_Green=''

if [[ -t 1 ]]; then
  Color_Off='\033[0m'
  Red='\033[0;31m'
  Green='\033[0;32m'
  Dim='\033[0;2m'
  Bold_Green='\033[1;32m'
  Bold_White='\033[1m'
fi

error() {
  echo -e "${Red}error${Color_Off}:" "$@" >&2
  exit 1
}

info() {
  echo -e "${Dim}$@${Color_Off}"
}

info_bold() {
  echo -e "${Bold_White}$@${Color_Off}"
}

success() {
  echo -e "${Green}$@${Color_Off}"
}

PERSISTED_RUNTIME_ENV_KEYS=(
  ALL_PROXY
  ASDF_DATA_DIR
  ASDF_DIR
  CARGO_HOME
  GEM_HOME
  GEM_PATH
  GOPATH
  GOROOT
  HOMEBREW_CELLAR
  HOMEBREW_PREFIX
  HOMEBREW_REPOSITORY
  HTTP_PROXY
  HTTPS_PROXY
  JAVA_HOME
  NVM_BIN
  NVM_DIR
  PATH
  PNPM_HOME
  PYENV_ROOT
  RBENV_ROOT
  RUSTUP_HOME
  SDKMAN_DIR
  SSH_AUTH_SOCK
  VOLTA_HOME
)

resolve_bun() {
  local candidate
  local candidates=()

  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
    return
  fi

  if [[ -n ${BUN_INSTALL:-} ]]; then
    candidates+=("${BUN_INSTALL%/}/bin/bun")
  fi

  candidates+=(
    "${HOME}/.bun/bin/bun"
    "/opt/homebrew/bin/bun"
    "/usr/local/bin/bun"
    "/usr/bin/bun"
    "/bin/bun"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x $candidate ]]; then
      BUN_BIN="$candidate"
      return
    fi
  done

  error "bun is required to run phodex-bridge. Install it first with the official command: curl -fsSL https://bun.com/install | bash"
}

tildify() {
  if [[ $1 = "$HOME"/* ]]; then
    printf '~/%s\n' "${1#"$HOME"/}"
    return
  fi
  printf '%s\n' "$1"
}

json_field() {
  local body=$1
  local field=$2
  printf '%s' "$body" | sed -n "s/.*\"$field\":\"\\([^\"]*\\)\".*/\\1/p"
}

json_error() {
  json_field "$1" "error"
}

http_request() {
  local body_file
  body_file="$(mktemp "${TMPDIR:-/tmp}/phodex-bridge.XXXXXX")"
  RESPONSE_STATUS="$(curl -o "$body_file" -w '%{http_code}' "$@" || true)"
  RESPONSE_BODY="$(cat "$body_file")"
  rm -f "$body_file"
}

normalize_origin() {
  local value=${1%/}
  [[ $value =~ ^https?:// ]] || error "Invalid --relay origin: $1"
  printf '%s\n' "$value"
}

codex_ready_url() {
  local ws_url=${1%/}
  ws_url="${ws_url/#ws:\/\//http://}"
  ws_url="${ws_url/#wss:\/\//https://}"
  printf '%s/readyz\n' "$ws_url"
}

probe_existing_codex_ready() {
  local ws_url=$1
  local ready_url
  ready_url="$(codex_ready_url "$ws_url")"
  http_request --silent --show-error --location --max-time 1.5 "$ready_url"
  [[ $RESPONSE_STATUS == 200 ]]
}

choose_ca_bundle() {
  local relay_origin=$1
  local host

  if [[ -n ${SSL_CERT_FILE:-} ]]; then
    printf '%s\n' "$SSL_CERT_FILE"
    return
  fi

  [[ $relay_origin == https://* ]] || return

  host=${relay_origin#https://}
  host=${host%%/*}
  host=${host%%:*}
  case "$host" in
    localhost | 127.0.0.1 | ::1)
      return
      ;;
  esac

  for candidate in /etc/ssl/cert.pem /private/etc/ssl/cert.pem; do
    if [[ -f $candidate ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
}

is_pid_alive() {
  kill -0 "$1" 2>/dev/null
}

xml_escape() {
  local value=$1
  value=${value//&/&amp;}
  value=${value//</&lt;}
  value=${value//>/&gt;}
  value=${value//\"/&quot;}
  value=${value//\'/&apos;}
  printf '%s' "$value"
}

launch_agent_label() {
  local hash
  hash="$(printf '%s' "$INSTALL_DIR" | shasum | awk '{print substr($1, 1, 12)}')"
  printf 'com.phodex.bridge.%s\n' "$hash"
}

launch_agent_domain() {
  printf 'gui/%s/%s\n' "$(id -u)" "$(launch_agent_label)"
}

launch_agent_plist_path() {
  printf '%s\n' "$HOME/Library/LaunchAgents/$(launch_agent_label).plist"
}

launch_agent_pid() {
  launchctl print "$(launch_agent_domain)" 2>/dev/null | sed -n 's/.*pid = \([0-9][0-9]*\).*/\1/p' | head -n 1
}

write_launch_agent_plist() {
  local plist_path=$1
  local label
  label="$(launch_agent_label)"

  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml_escape "$label")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>$(xml_escape "$INSTALL_DIR")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$START_SCRIPT")</string>
  </array>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_FILE")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_FILE")</string>
</dict>
</plist>
EOF
}

stop_launch_agent() {
  local plist_path
  plist_path="$(launch_agent_plist_path)"
  launchctl bootout "$(launch_agent_domain)" >/dev/null 2>&1 || true
  rm -f "$plist_path"
}

stop_existing_bridge() {
  if [[ $(uname -s) == Darwin ]]; then
    stop_launch_agent
  fi

  if [[ ! -f $PID_FILE ]]; then
    return
  fi

  local pid
  pid="$(tr -d '[:space:]' < "$PID_FILE")"
  if [[ ! $pid =~ ^[0-9]+$ ]]; then
    rm -f "$PID_FILE"
    return
  fi

  if ! is_pid_alive "$pid"; then
    rm -f "$PID_FILE"
    return
  fi

  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    if ! is_pid_alive "$pid"; then
      rm -f "$PID_FILE"
      return
    fi
    sleep 0.1
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

write_env_file() {
  : > "$ENV_FILE"
  write_env_value PHODEX_RELAY_URL "$RELAY_ORIGIN"
  write_env_value PHODEX_BRIDGE_TOKEN "$BRIDGE_TOKEN"
  write_env_value PHODEX_RELAY_LABEL "$RELAY_LABEL"
  write_env_value PHODEX_MAC_LABEL "$MAC_LABEL"
  write_env_value PHODEX_STATE_FILE "$STATE_FILE"

  if [[ -n $CODEX_BIN ]]; then
    write_env_value PHODEX_CODEX_BIN "$CODEX_BIN"
  fi

  if [[ -n $CODEX_WS_URL ]]; then
    write_env_value PHODEX_CODEX_WS_URL "$CODEX_WS_URL"
    write_env_value PHODEX_MANAGE_CODEX false
  fi

  persist_runtime_env

  if [[ -n $CA_BUNDLE ]]; then
    write_env_value SSL_CERT_FILE "$CA_BUNDLE"
    write_env_value NODE_EXTRA_CA_CERTS "$CA_BUNDLE"
  fi
}

write_env_value() {
  printf '%s=%q\n' "$1" "$2" >> "$ENV_FILE"
}

persist_runtime_env() {
  local key
  local value

  for key in "${PERSISTED_RUNTIME_ENV_KEYS[@]}"; do
    value="${!key-}"
    [[ -n $value ]] || continue
    write_env_value "$key" "$value"
  done
}

write_start_script() {
  printf '#!/bin/bash\nset -euo pipefail\nset -a\n. %q\nset +a\nexec %q %q\n' \
    "$ENV_FILE" "$BUN_BIN" "$RUNTIME_FILE" > "$START_SCRIPT"
  chmod +x "$START_SCRIPT"
}

start_bridge() {
  local pid

  if [[ $(uname -s) == Darwin ]]; then
    local plist_path
    local bootstrap_ok=0
    local kickstart_ok=0
    plist_path="$(launch_agent_plist_path)"
    write_launch_agent_plist "$plist_path"

    for _ in $(seq 1 5); do
      if launchctl bootstrap "gui/$(id -u)" "$plist_path" >/dev/null 2>&1; then
        bootstrap_ok=1
        break
      fi
      launchctl bootout "$(launch_agent_domain)" >/dev/null 2>&1 || true
      sleep 0.2
    done

    [[ $bootstrap_ok -eq 1 ]] || error "Failed to register launch agent with launchctl."

    for _ in $(seq 1 5); do
      if launchctl kickstart -k "$(launch_agent_domain)" >/dev/null 2>&1; then
        kickstart_ok=1
        break
      fi
      pid="$(launch_agent_pid || true)"
      if [[ $pid =~ ^[0-9]+$ ]]; then
        kickstart_ok=1
        break
      fi
      sleep 0.2
    done

    [[ $kickstart_ok -eq 1 ]] || error "Failed to start launch agent with launchctl."

    for _ in $(seq 1 20); do
      pid="$(launch_agent_pid || true)"
      if [[ $pid =~ ^[0-9]+$ ]]; then
        break
      fi
      sleep 0.1
    done
  else
    nohup "$START_SCRIPT" >> "$LOG_FILE" 2>&1 < /dev/null &
    pid="$!"
  fi

  [[ $pid =~ ^[0-9]+$ ]] || error "Failed to capture local bridge PID."
  printf '%s\n' "$pid" > "$PID_FILE"
  BRIDGE_PID="$pid"
}

wait_for_bridge_health() {
  local health_url="${RELAY_ORIGIN}/api/health"

  for _ in $(seq 1 12); do
    http_request --silent --show-error --location -H "x-phodex-bridge-token: ${BRIDGE_TOKEN}" "$health_url"
    if [[ $RESPONSE_STATUS == 401 ]]; then
      error "$(json_error "$RESPONSE_BODY" || printf 'Bridge authentication failed.')"
    fi
    if [[ $RESPONSE_STATUS == 200 && $RESPONSE_BODY == *'"bridgeConnected":true'* ]]; then
      return
    fi
    if [[ -n ${BRIDGE_PID:-} ]] && ! is_pid_alive "$BRIDGE_PID"; then
      return 1
    fi
    sleep 0.5
  done

  return 1
}

DEFAULT_INSTALL_DIR="${HOME}/.phodex-bridge"
DEFAULT_CODEX_WS_URL="ws://127.0.0.1:8765"
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
RELAY_ORIGIN=""
SETUP_TOKEN=""
BRIDGE_SECRET=""
MAC_LABEL="$(hostname)"
CODEX_BIN=""
CODEX_WS_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --relay)
      [[ $# -ge 2 ]] || error "--relay requires a value"
      RELAY_ORIGIN="$2"
      shift 2
      ;;
    --token)
      [[ $# -ge 2 ]] || error "--token requires a value"
      SETUP_TOKEN="$2"
      shift 2
      ;;
    --secret)
      [[ $# -ge 2 ]] || error "--secret requires a value"
      BRIDGE_SECRET="$2"
      shift 2
      ;;
    --dir)
      [[ $# -ge 2 ]] || error "--dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --mac-label)
      [[ $# -ge 2 ]] || error "--mac-label requires a value"
      MAC_LABEL="$2"
      shift 2
      ;;
    --codex-bin)
      [[ $# -ge 2 ]] || error "--codex-bin requires a value"
      CODEX_BIN="$2"
      shift 2
      ;;
    --codex-ws-url)
      [[ $# -ge 2 ]] || error "--codex-ws-url requires a value"
      CODEX_WS_URL="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage:
  curl -fsSL <relay>/install | bash -s -- --relay <origin> --token <setup-token>
Optional flags:
  --dir <path>
  --mac-label <label>
  --codex-bin <path>
  --codex-ws-url <ws-url>
  --secret <bridge-token>
EOF
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      ;;
  esac
done

command -v curl >/dev/null || error "curl is required to install phodex-bridge"

[[ -n $RELAY_ORIGIN ]] || error "Missing --relay. Copy the install command from the signed-in phone session."
RELAY_ORIGIN="$(normalize_origin "$RELAY_ORIGIN")"
CA_BUNDLE="$(choose_ca_bundle "$RELAY_ORIGIN" || true)"

if [[ -n $BRIDGE_SECRET ]]; then
  BRIDGE_TOKEN="$BRIDGE_SECRET"
  RELAY_LABEL="Phodex Public Relay"
  BRIDGE_RUNTIME_URL="${RELAY_ORIGIN}/install/bridge-runtime.ts"
else
  [[ -n $SETUP_TOKEN ]] || error "Missing --token. Copy the install command from the signed-in phone session."
  CLAIM_BODY=$(printf '{"token":"%s"}' "$SETUP_TOKEN")
  http_request --silent --show-error --location -H 'content-type: application/json' -X POST --data "$CLAIM_BODY" "${RELAY_ORIGIN}/install/claim"
  [[ $RESPONSE_STATUS == 200 ]] || error "$(json_error "$RESPONSE_BODY" || true)"

  CLAIMED_RELAY_ORIGIN="$(json_field "$RESPONSE_BODY" "relayOrigin")"
  BRIDGE_RUNTIME_URL="$(json_field "$RESPONSE_BODY" "bridgeRuntimeUrl")"
  BRIDGE_TOKEN="$(json_field "$RESPONSE_BODY" "bridgeToken")"
  RELAY_LABEL="$(json_field "$RESPONSE_BODY" "relayLabel")"

  [[ -n $BRIDGE_RUNTIME_URL && -n $BRIDGE_TOKEN ]] || error "Install setup claim response is missing runtime URL or bridge token."
  if [[ -n $CLAIMED_RELAY_ORIGIN ]]; then
    RELAY_ORIGIN="$(normalize_origin "$CLAIMED_RELAY_ORIGIN")"
  fi
fi

INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
PID_FILE="${INSTALL_DIR}/bridge.pid"
ENV_FILE="${INSTALL_DIR}/bridge.env"
LOG_FILE="${INSTALL_DIR}/logs/bridge.log"
RUNTIME_FILE="${INSTALL_DIR}/current/bridge-runtime.ts"
START_SCRIPT="${INSTALL_DIR}/current/start-bridge.sh"
STATE_FILE="${INSTALL_DIR}/data/bridge-state.json"

resolve_bun

if [[ -z $CODEX_WS_URL ]] && probe_existing_codex_ready "$DEFAULT_CODEX_WS_URL"; then
  CODEX_WS_URL="$DEFAULT_CODEX_WS_URL"
fi

mkdir -p "$INSTALL_DIR/current" "$INSTALL_DIR/logs" "$INSTALL_DIR/data"

info "Using bun at $(tildify "$BUN_BIN")"
info "Downloading bridge runtime..."
curl --fail --location --progress-bar --output "$RUNTIME_FILE" "$BRIDGE_RUNTIME_URL" || error "Failed to download bridge runtime"

write_env_file
write_start_script
stop_existing_bridge
start_bridge
if ! wait_for_bridge_health; then
  if [[ -n ${BRIDGE_PID:-} ]] && ! is_pid_alive "$BRIDGE_PID"; then
    error "Bridge exited before the relay confirmed the connection. Check the bridge log at $(tildify "$LOG_FILE")"
  fi
  info "Started, but the relay has not confirmed the bridge within 6 seconds. Check the bridge log."
fi

success "phodex-bridge installed successfully to ${Bold_Green}$(tildify "$INSTALL_DIR")${Color_Off}"
info "Runtime: $(tildify "$RUNTIME_FILE")"
info "Env: $(tildify "$ENV_FILE")"
info "Log: $(tildify "$LOG_FILE")"
info_bold "PID: ${BRIDGE_PID}"
