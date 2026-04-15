#!/usr/bin/env bash
set -euo pipefail

mkdir -p .cnb

branch="${CNB_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
repo_slug="${CNB_REPO_SLUG:-}"
proxy_template="${CNB_VSCODE_PROXY_URI:-}"
preview_origin=""

if [[ -n "$proxy_template" ]]; then
  preview_origin="${proxy_template//\{\{port\}\}/8686}"
fi

cat > .cnb/preview-metadata.json <<EOF
{
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "repoSlug": "${repo_slug}",
  "branch": "${branch}",
  "buildId": "${CNB_BUILD_ID:-}",
  "pipelineId": "${CNB_PIPELINE_ID:-}",
  "proxyUriTemplate": "${proxy_template}",
  "previewOrigin": "${preview_origin}"
}
EOF

if [[ -z "$repo_slug" || -z "${CNB_TOKEN:-}" ]]; then
  exit 0
fi

if [[ -z "$(git status --porcelain -- .cnb/preview-metadata.json)" ]]; then
  exit 0
fi

git config user.name "CNB Preview Bot"
git config user.email "preview-bot@phodex.local"
git add .cnb/preview-metadata.json

if ! git commit -m "更新 CNB 预览元信息 [skip ci]" >/dev/null 2>&1; then
  exit 0
fi

askpass_file="$(mktemp)"
trap 'rm -f "$askpass_file"' EXIT
cat > "$askpass_file" <<'EOF'
#!/usr/bin/env sh
printf '%s' "$CNB_TOKEN"
EOF
chmod +x "$askpass_file"

GIT_ASKPASS="$askpass_file" \
GIT_TERMINAL_PROMPT=0 \
git \
  -c credential.helper= \
  -c credential.username=cnb \
  push "https://cnb.cool/${repo_slug}" "HEAD:${branch}" >/dev/null 2>&1 || true
