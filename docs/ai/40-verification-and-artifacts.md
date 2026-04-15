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

## Runtime Defaults

- Local/public relay URL: `http://localhost:3443`
- Client relay endpoint: `ws://localhost:3443/relay`
- Local bridge endpoint target: `ws://localhost:3443/bridge?secret=...`
- CNB relay preview uses port `8686` and serves the web UI and relay from the same public origin.
- The project baseline for CNB preview is `runner.cpus: 2`, which CNB maps to `4 GB` memory.
- For CNB machine traffic, derive the public preview origin from `CNB_VSCODE_PROXY_URI` by replacing `{{port}}` with `8686`.
- Do not use CNB `jumpUrl` as a bridge target; it is a browser-facing entry and returns auth gating to direct non-browser requests.

## Verification Expectations

- UI changes: run `bun run build:web`, then validate the real page in a browser session and capture fresh screenshots when acceptance depends on visuals.
- Shared-control / polish changes: check `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`, then verify the real mobile viewport for paired button height consistency, radius-scale consistency, icon-style consistency, and floating-helper sizing.
- Overlay UI changes: for dialogs, drawers, menus, and sheets in the mobile viewport, verify the real runtime path with content long enough to force overflow.
  Check that the intended internal region scrolls, fixed footer actions stay visible, and critical inputs do not fall below the viewport.
- Server changes: validate affected endpoints or websocket flow, then exercise at least one real end-to-end path.
- State-machine fixes: test the full path, not just the isolated component.
- CNB relay changes: prefer a direct preview-origin validation over SSH tunnels when the target client is a local bridge or another daemon.
- Any real OTP validation must send a real email and complete login with the real code from that mailbox.
- Preferred path: use a mailbox-reading skill to fetch the latest OTP from the inbox, then continue the browser flow with that code.
- Forbidden shortcuts for real acceptance: static codes, reading server persistence/state files, hidden dev endpoints, or any local bypass path.
- If the mailbox-reading skill is unavailable or mailbox access fails, call out the validation as blocked rather than simulating success.

## Existing Evidence

- CDP screenshots: `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/`
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
