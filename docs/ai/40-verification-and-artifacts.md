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
- Electron CDP wrapper:
  - `export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"`
  - `export ECDP="$CODEX_HOME/skills/electron-cdp-automation/scripts/electron_cdp.sh"`
  - Use `"$ECDP" open <url> --session <name>`, then `snapshot`, `click`, `fill`, `wait-for-text`, and `screenshot` with the same session.
- Installer manifest: authenticated `GET /install/manifest.json`
- Installer setup-token exchange: `POST /install/claim`
- Latest shell installer alias: `GET /install`
- Latest bridge runtime alias: `GET /install/bridge-runtime.ts`
- For CNB pushes from the Codex shell, prefer `"/Users/young/.codex/skills/cnb-dev-deploy/scripts/cnb-git.sh" push -u cnb HEAD`; raw `git push` may fail from missing askpass or token wiring even when the repo exists and GUI clients can push successfully.
- If a CNB Git command fails, self-correct before escalating: retry with the `cnb-dev-deploy` skill wrapper, then verify both `cnb` remote reachability and CNB API repo visibility before concluding that the remote repo is missing.

## Runtime Defaults

- Local/public relay URL: `http://localhost:3443`
- Client relay endpoint: `ws://localhost:3443/relay`
- Local bridge endpoint target: `ws://localhost:3443/bridge?token=...`
- User-facing local install/start commands now come from `/install/manifest.json` and resolve to both `curl -fsSL http://localhost:3443/install | bash -s -- --relay http://localhost:3443 --token ...` for `Mac / Linux` and `powershell -NoProfile -ExecutionPolicy Bypass -Command '... bun $installer install --relay ''http://localhost:3443'' --token ''...'''` for `Windows`. Bridge display names are configured with `PHODEX_DEVICE_LABEL` / `--device-label`; older `PHODEX_MAC_LABEL` / `--mac-label` installs are accepted only as compatibility aliases.
- The public install script should prefer an existing host `bun` binary even if the current non-interactive shell PATH is incomplete. Real install verification should cover at least one environment where `bun` is absent from PATH but still available at `~/.bun/bin/bun`.
- On Mac/Linux, installed bridge launches should re-enter the detected login shell before starting the runtime so downstream tools such as `codex`, Homebrew binaries, `asdf`, `nvm`, or `volta` resolve against the same `PATH` a normal Terminal session exposes.
- If `bun` cannot be found in PATH or the common host fallback locations, the installer should fail fast and print the official Bun install command `curl -fsSL https://bun.com/install | bash` instead of auto-installing it.
- For the Windows command, the missing-`bun` hint should instead print `powershell -c "irm bun.sh/install.ps1 | iex"`.
- Installer verification should confirm `bridge.env` always contains `PHODEX_MANAGE_CODEX=false` plus the selected `PHODEX_CODEX_WS_URL`. The macOS shell installer should stop a manual listener on the preferred Codex port when possible, create a separate `com.phodex.codex.*` LaunchAgent, wait for Codex readiness before starting the Bun bridge, and print the fallback URL when it must move from 8765 to 8766-8775.
- Production web deployments should keep client API calls same-origin. A public `apps/web/dist` bundle must not contain loopback client targets like `127.0.0.1:3443`.

## QCP Deploy Truth

- Do not deploy as an automatic follow-up to merging or pushing code. Run QCP deployment only after an explicit deploy/publish/release/restart instruction.
- Unless the user names another target, `deploy` means QCP.
- Prefer the local skill `/Users/young/.codex/skills/phodex-qcp-deploy` for QCP inspection and deployment when it exists.
- Before changing QCP, inspect the live host instead of guessing paths:
  - `ssh qcp 'systemctl cat phodex-codex.service'`
  - `ssh qcp 'nginx -T'`
- Current live QCP relay service:
  - systemd unit: `phodex-codex.service`
  - Bun binary: `/usr/local/bin/bun`
  - working tree: `/srv/phodex-web`
  - relay working directory from systemd: `/srv/phodex-web/apps/server`
- Current live QCP frontend entry:
  - HTTPS nginx config: `/etc/nginx/__conf.d/phodex-ip-https.conf`
  - HTTP nginx config: `/etc/nginx/__conf.d/phodex-ip-http.conf`
  - domain redirect config: `/etc/nginx/__conf.d/codex-ott-qzz.conf`
  - static root for `https://8.148.226.243:8443`: `/usr/share/nginx/html/phodex-web/dist`
- Do not treat `/root/project/phodex-web` as the active deploy directory unless the live nginx and systemd config explicitly point there.
- Do not claim QCP is missing Bun before checking the live service and `/usr/local/bin/bun`.

## Verification Expectations

- UI changes: run `bun run build:web`, then validate the real page with the local `electron-cdp-automation` skill and hidden Electron CDP wrapper; capture fresh screenshots when acceptance depends on visuals.
- Do not use Chrome, Firefox, Playwright, or Selenium for browser/UI validation unless the user explicitly asks for them or Electron CDP cannot cover the required browser capability; document any exception.
- For transient UI bugs such as flicker, auto-scroll loss, disappearing cards, or tap-state regressions, capture a short mp4 or ordered frame sequence plus a timestamped state log.
  Do not treat a single screenshot as sufficient evidence for those cases.
- For public web deploys, also inspect the emitted bundle or runtime requests to confirm the production build did not embed a local-only API origin.
- Shared-control / polish changes: check `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`, then verify the real mobile viewport for paired button height consistency, radius-scale consistency, icon-style consistency, and floating-helper sizing.
- Overlay UI changes: for dialogs, drawers, menus, and sheets in the mobile viewport, verify the real runtime path with content long enough to force overflow.
  Check that the intended internal region scrolls, fixed footer actions stay visible, and critical inputs do not fall below the viewport.
- Server changes: validate affected endpoints or websocket flow, then exercise at least one real end-to-end path.
- For bridge-install security changes, verify all of: anonymous manifest access is blocked, a fresh login can mint a setup token, the same setup token can mint multiple per-device bridge tokens until expiry, and unauthenticated health checks do not expose another account's bridge state.
- For bridge-install behavior changes around Codex permissions, verify the outcomes you can reproduce: cold install where the installer starts a separate Codex app-server service before the Bun bridge connects; preferred-port takeover when a manual listener already occupies 8765; and fallback-port selection when 8765 remains unavailable.
- For bridge-install environment fixes on Mac/Linux, inspect the generated `current/start-bridge.sh` and confirm it execs the detected login shell with `-lc` or the fish login equivalent before handing off to Bun.
- For multi-device bridge changes, prefer proving one local install plus one CNB install (or another genuinely separate second machine) against the same signed-in account.
- For Home registered-device interaction changes, capture a real mobile runtime showing all three cases: tapping the active online device, tapping a second online device to switch `activeBridgeId`, and tapping an offline saved device to confirm it stays inert.
- If `x-phodex-bridge-token` is present but invalid, `/api/health` should return `401` so stale install commands do not masquerade as a slow bridge startup.
- State-machine fixes: test the full path, not just the isolated component.
- CDP state-machine regressions need at least two timed assertions: an early sample inside the transient window and a settled sample after hydration or completion. Do not accept a final-state screenshot as proof that flicker, stale cache, or disappearing-card bugs are fixed.
- For local Electron CDP on this repo, use `--allow-insecure` for the self-signed Vite HTTPS cert, isolate test ports instead of killing another worktree's server, and save screenshots with absolute paths because relative paths resolve inside the Electron runtime app.
- Any real OTP validation must send a real email and complete login with the real code from that mailbox.
- On this workstation, default real OTP validation to `otth.xyz@qq.com`, which is available through the local Apple Mail `QQ` account, unless the user explicitly names another email.
- In local operator language, `Email Scale` refers to the provisioned OTP mail sender already wired through the repo's Resend path; do not treat that phrase as evidence that mail delivery is absent.
- Preferred path: use a mailbox-reading skill to fetch the latest OTP from the inbox, then continue the browser flow with that code.
- On this workstation, local email inspection must use the `apple-mail-reader` skill. If the skill, Apple Mail automation, or mailbox access fails, report the blocker instead of reading `~/Library/Mail` directly.
- Do not say OTP mail is unavailable unless you first verify it with evidence, such as relay startup logs reporting missing credentials or `/api/auth/request-code` returning `503`.
- Forbidden shortcuts for real acceptance: static codes, reading server persistence/state files, hidden dev endpoints, or any local bypass path.
- If the mailbox-reading skill is unavailable or mailbox access fails, call out the validation as blocked rather than simulating success.

## Existing Evidence

- CDP screenshots: `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/`
- Sidebar density pass: `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/sidebar-density-20260423`
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
