# AGENTS.md

Use progressive disclosure. Default to the smallest safe doc set.

## Read Order

1. Read `/Users/young/mx/tmp/phodex-web/docs/ai/00-start-here.md`.
2. Before editing code, read only the nearest subproject guide:
   - `/Users/young/mx/tmp/phodex-web/apps/web/AGENTS.md`
   - `/Users/young/mx/tmp/phodex-web/apps/server/AGENTS.md`
3. Read `/Users/young/mx/tmp/phodex-web/docs/ai/05-product-decisions.md` only for auth, onboarding, security, upstream restoration, or product-rule changes.
4. Read `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md` only when verification commands or acceptance evidence are unclear.
5. Read `/Users/young/mx/tmp/phodex-web/docs/ai/context-manifest.yaml` only when the needed deeper doc is unclear.

## Repo Truth

- Source-driven recreation of the `remodex` mobile app behavior/UI.
- Real today: email OTP, public relay, local Codex bridge, chat create/send/stream/stop/rename/archive.
- Partial: source parity, rich turn surfaces, purchases.
- Excluded: QR/camera pairing and end-to-end encryption.

## Working Rules

- If another repo document conflicts with this file, follow this file.
- Use current code/behavior as truth; do not rely on stale plans or memory.
- Add standing AI rules only in the smallest durable, non-redundant form.
- Prefer the smallest readable diff that solves the task.
- Prefer environment variables or sourced secret files over inline secret strings. Do not paste tokens, passwords, or API keys into commands, docs, logs, or temp scripts when an env-based path exists.
- No fake/mock/random/placeholder production data; show unavailable/unknown or report the verification gap.
- CNB Git: use the `cnb-dev-deploy` authenticated flow before treating push/auth failures as missing repos.
- Deploy only when explicitly asked; unnamed deploy target means QCP. For QCP, use `/Users/young/.codex/skills/phodex-qcp-deploy` when present.
- If a task changes architecture, commands, ownership, page truth, or acceptance flow, update the relevant AI docs in the same commit.
- Do not bypass security/deployment boundaries unless explicitly asked.
- Commit intentional changes separately; commit messages should be primarily in Chinese.

## Execution

- In fix loops: reproduce, fix, verify.
- Before editing, inspect worktree changes. Use a separate worktree only for overlapping/conflicting changes.
- For conflict-driven worktree setup, merge-back, ignored artifacts, and recurring Bun mode-bit cleanup, follow `/Users/young/mx/tmp/phodex-web/docs/ai/15-bugfix-workflow.md#worktree-discipline`.
- Before fixing a bug, reproduce it with the lightest reliable evidence.
- Use Electron CDP only when browser behavior, visual acceptance, or timing-sensitive UI evidence matters.
- Use real running output for UI work. Do not infer visual truth from static code alone.
- Do not add fake phone hardware, status bars, dynamic islands, or promo-shot framing unless the source app renders them.

## Verification

- Default order: build, targeted checks, then real-flow validation only when the task risk justifies it.
- For timing-sensitive UI/state-machine regressions, capture early transient and settled states when browser validation is needed.
- Real OTP acceptance uses real email and the `apple-mail-reader` skill; default mailbox is `otth.xyz@qq.com` via local Apple Mail `QQ`.
- If something was not verified, say so explicitly.

## Optional Deep Reads

- Status/planning: `/Users/young/mx/tmp/phodex-web/docs/ai/10-current-state.md`, `/Users/young/mx/tmp/phodex-web/docs/ai/50-open-todo.md`
- UI/flows: `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`
- Relay/bridge/protocol: `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`
- Full routing: `/Users/young/mx/tmp/phodex-web/llms.txt`, `/Users/young/mx/tmp/phodex-web/docs/ai/context-manifest.yaml`
