#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/young/mx/tmp/phodex-web"
ECDP="${ECDP:-$HOME/.codex/skills/electron-cdp-automation/scripts/electron_cdp.sh}"
SESSION="${PHODEX_CDP_SESSION:-phodex-qa}"
BASE_URL="${PHODEX_CDP_URL:-https://localhost:3443}"
EMAIL="${PHODEX_QA_EMAIL:-qa-cdp@local.dev}"
CODE="${PHODEX_QA_CODE:-}"
OUTDIR="${PHODEX_CDP_OUTDIR:-$ROOT_DIR/.artifacts/qa-cdp}"

usage() {
  cat <<'EOF'
Usage:
  scripts/qa/cdp-acceptance.sh start
  scripts/qa/cdp-acceptance.sh reset
  scripts/qa/cdp-acceptance.sh login
  scripts/qa/cdp-acceptance.sh flow <name>
  scripts/qa/cdp-acceptance.sh page <name>
  scripts/qa/cdp-acceptance.sh snapshot
  scripts/qa/cdp-acceptance.sh click <ref>
  scripts/qa/cdp-acceptance.sh fill <ref> <text>
  scripts/qa/cdp-acceptance.sh eval <js>
  scripts/qa/cdp-acceptance.sh shot <file>

Examples:
  scripts/qa/cdp-acceptance.sh reset
  scripts/qa/cdp-acceptance.sh login
  scripts/qa/cdp-acceptance.sh page settings
  scripts/qa/cdp-acceptance.sh shot settings.png
  scripts/qa/cdp-acceptance.sh click e12
EOF
}

ecdpcmd() {
  "$ECDP" "$@" --session "$SESSION"
}

ensure_session() {
  mkdir -p "$OUTDIR"
  ecdpcmd start >/dev/null
  ecdpcmd cdp Security.setIgnoreCertificateErrors '{"ignore":true}' >/dev/null
}

reset_state() {
  ensure_session
  ecdpcmd open "$BASE_URL" >/dev/null
  ecdpcmd cdp Storage.clearDataForOrigin '{"origin":"https://localhost:3443","storageTypes":"all"}' >/dev/null
  ecdpcmd evaluate "localStorage.clear(); sessionStorage.clear();" >/dev/null
  ecdpcmd reload >/dev/null
  ecdpcmd wait 400 >/dev/null
}

open_flow() {
  local flow="${1:?flow is required}"
  ensure_session
  ecdpcmd open "$BASE_URL/?flow=$flow" >/dev/null
  ecdpcmd wait 400 >/dev/null
}

open_page() {
  local page="${1:?page is required}"
  ensure_session
  ecdpcmd open "$BASE_URL/?page=$page" >/dev/null
  ecdpcmd wait 400 >/dev/null
}

login() {
  if [[ -z "$CODE" ]]; then
    echo "PHODEX_QA_CODE is required. Request a real OTP email first." >&2
    exit 1
  fi
  ensure_session
  ecdpcmd open "$BASE_URL/?flow=email-otp" >/dev/null
  ecdpcmd wait 500 >/dev/null
  ecdpcmd evaluate "(() => { const input = document.querySelector('#email'); if (!input) throw new Error('email input missing'); input.focus(); input.value = '$EMAIL'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()" >/dev/null
  ecdpcmd evaluate "(() => { const button = [...document.querySelectorAll('button')].find((item) => /Send verification code/i.test(item.textContent || '')); if (!button) throw new Error('send button missing'); button.click(); })()" >/dev/null
  ecdpcmd wait-for-text "Continue into relay" --timeout 10000 >/dev/null
  ecdpcmd evaluate "(() => { const input = document.querySelector('#code'); if (!input) throw new Error('code input missing'); input.focus(); input.value = '$CODE'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()" >/dev/null
  ecdpcmd evaluate "(() => { const button = [...document.querySelectorAll('button')].find((item) => /Continue into relay/i.test(item.textContent || '')); if (!button) throw new Error('continue button missing'); button.click(); })()" >/dev/null
  ecdpcmd wait-for-text "Trusted Mac" --timeout 10000 >/dev/null
}

snapshot() {
  ensure_session
  ecdpcmd snapshot
}

click_ref() {
  local ref="${1:?ref is required}"
  ensure_session
  ecdpcmd click "$ref"
}

fill_ref() {
  local ref="${1:?ref is required}"
  local text="${2:?text is required}"
  ensure_session
  ecdpcmd fill "$ref" "$text"
}

eval_js() {
  local js="${1:?js is required}"
  ensure_session
  ecdpcmd evaluate "$js"
}

shot() {
  local file="${1:?file is required}"
  ensure_session
  ecdpcmd screenshot "$OUTDIR/$file"
}

case "${1:-}" in
  start)
    ensure_session
    ;;
  reset)
    reset_state
    ;;
  login)
    login
    ;;
  flow)
    shift
    open_flow "${1:-}"
    ;;
  page)
    shift
    open_page "${1:-}"
    ;;
  snapshot)
    snapshot
    ;;
  click)
    shift
    click_ref "${1:-}"
    ;;
  fill)
    shift
    fill_ref "${1:-}" "${2:-}"
    ;;
  eval)
    shift
    eval_js "${1:-}"
    ;;
  shot)
    shift
    shot "${1:-}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
