# Verification And Artifacts

Read this file when you need to verify a change or continue from prior evidence.

## Commands

- Repo root: `/Users/young/mx/tmp/phodex-web`
- Install: `bun install`
- Web dev: `bun run dev:web`
- Web build: `bun run build:web`
- Relay dev: `bun run dev:relay`
- Relay start: `bun run start:relay`
- Bridge dev: `bun run dev:bridge`
- Bridge start: `bun run start:bridge`
- Installer manifest: authenticated `GET /install/manifest.json`
- Installer setup-token exchange: `POST /install/claim`
- Latest shell installer alias: `GET /install`
- Latest bridge runtime alias: `GET /install/bridge-runtime.ts`
- For CNB pushes from the Codex shell, prefer `"/Users/young/.codex/skills/cnb-dev-deploy/scripts/cnb-git.sh" push -u cnb HEAD`; raw `git push` may block on `git-credential-osxkeychain get` even when GUI clients can push successfully.

## Runtime Defaults

- Local/public relay URL: `http://localhost:3443`
- Client relay endpoint: `ws://localhost:3443/relay`
- Local bridge endpoint target: `ws://localhost:3443/bridge?token=...`
- User-facing local install/start command now comes from `/install/manifest.json` and resolves to `curl -fsSL http://localhost:3443/install | bash -s -- --relay http://localhost:3443 --token ...`.
- The public install script should prefer an existing host `bun` binary even if the current non-interactive shell PATH is incomplete. Real install verification should cover at least one environment where `bun` is absent from PATH but still available at `~/.bun/bin/bun`.
- If `bun` cannot be found in PATH or the common host fallback locations, the installer should fail fast and print the official Bun install command `curl -fsSL https://bun.com/install | bash` instead of auto-installing it.
- Installer verification should also capture whether install-time auto-pinning happened: when a local Codex app-server is already listening on `ws://127.0.0.1:8765`, the installed `bridge.env` should contain `PHODEX_CODEX_WS_URL` plus `PHODEX_MANAGE_CODEX=false`; otherwise those keys should be absent and managed fallback stays enabled.
- Production web deployments should keep client API calls same-origin. A public `apps/web/dist` bundle must not contain loopback client targets like `127.0.0.1:3443`.

## Verification Expectations

- UI changes: run `bun run build:web`, then validate the real page in a browser session and capture fresh screenshots when acceptance depends on visuals.
- For transient UI bugs such as flicker, auto-scroll loss, disappearing cards, or tap-state regressions, capture a short mp4 or ordered frame sequence plus a timestamped state log.
  Do not treat a single screenshot as sufficient evidence for those cases.
- For public web deploys, also inspect the emitted bundle or runtime requests to confirm the production build did not embed a local-only API origin.
- Shared-control / polish changes: check `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`, then verify the real mobile viewport for paired button height consistency, radius-scale consistency, icon-style consistency, and floating-helper sizing.
- Overlay UI changes: for dialogs, drawers, menus, and sheets in the mobile viewport, verify the real runtime path with content long enough to force overflow.
  Check that the intended internal region scrolls, fixed footer actions stay visible, and critical inputs do not fall below the viewport.
- Server changes: validate affected endpoints or websocket flow, then exercise at least one real end-to-end path.
- For bridge-install security changes, verify all of: anonymous manifest access is blocked, a fresh login can mint a setup token, the same setup token can mint multiple per-device bridge tokens until expiry, and unauthenticated health checks do not expose another account's bridge state.
- For bridge-install behavior changes around Codex permissions, verify both install outcomes you can reproduce:
  when a local Codex app-server is already listening on `ws://127.0.0.1:8765`, and when the installer must fall back to managed background Codex.
- For multi-device bridge changes, prefer proving one local install plus one CNB install (or another genuinely separate second machine) against the same signed-in account.
- For Home registered-device interaction changes, capture a real mobile runtime showing all three cases: tapping the active online device, tapping a second online device to switch `activeBridgeId`, and tapping an offline saved device to confirm it stays inert.
- If `x-phodex-bridge-token` is present but invalid, `/api/health` should return `401` so stale install commands do not masquerade as a slow bridge startup.
- State-machine fixes: test the full path, not just the isolated component.
- Any real OTP validation must send a real email and complete login with the real code from that mailbox.
- In local operator language, `Email Scale` refers to the provisioned OTP mail sender already wired through the repo's Resend path; do not treat that phrase as evidence that mail delivery is absent.
- Preferred path: use a mailbox-reading skill to fetch the latest OTP from the inbox, then continue the browser flow with that code.
- Do not say OTP mail is unavailable unless you first verify it with evidence, such as relay startup logs reporting missing credentials or `/api/auth/request-code` returning `503`.
- Forbidden shortcuts for real acceptance: static codes, reading server persistence/state files, hidden dev endpoints, or any local bypass path.
- If the mailbox-reading skill is unavailable or mailbox access fails, call out the validation as blocked rather than simulating success.

## Existing Evidence

- CDP screenshots: `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/`
- Latest multi-device pass: `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/multi-device-e2e-20260423`
- Latest Home device-card click pass: `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/device-card-click-20260423`
- Prior acceptance docs:
  - `/Users/young/mx/tmp/phodex-web/docs/cdp-acceptance.md`
  - `/Users/young/mx/tmp/phodex-web/docs/cdp-acceptance-runbook.md`
  - `/Users/young/mx/tmp/phodex-web/docs/page-function-acceptance.md`
  - `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`

## Commit Discipline

- Commit each independent code change intentionally.
- Write commit messages primarily in Chinese. Keep commands, paths, code symbols, and proper nouns in English when that is clearer.
- If you update architecture, commands, or page truth, update the relevant AI docs in the same commit.

## When To Go Deeper

- If page truth is unclear, read `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`.
- If protocol behavior is unclear, read `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`.
- If the task is a bugfix or regression pass, read `/Users/young/mx/tmp/phodex-web/docs/ai/15-bugfix-workflow.md`.
