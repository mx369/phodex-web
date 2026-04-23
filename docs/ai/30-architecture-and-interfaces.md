# Architecture And Interfaces

Read this file for relay, auth, client, and Codex bridge work.

## Workspace Ownership

- `apps/web/src/App.vue`: top-level UI state, page routing, shell panels, dialogs, and composer surfaces.
- `apps/web/src/lib/client.ts`: bootstrap fetches, websocket lifecycle, optimistic UI sync, and client event emission.
- `apps/server/src/relay.ts`: Bun public relay, static web serving, OTP auth, authenticated client sessions, and bridge session management.
- `apps/server/src/index.ts`: local outbound bridge, Codex app-server integration, thread sync, and local filesystem/worktree operations.
- `packages/shared/src/index.ts`: shared event and record shapes.

## HTTP Endpoints

- `GET /api/health`: relay health plus user-specific bridge state when called with a user session or a valid bridge token; invalid bridge tokens now return `401` instead of silently looking disconnected.
- `GET /api/bootstrap`: authenticated snapshot bootstrap.
- `GET /api/thread/:threadId/project/tree?path=...`: authenticated lazy directory listing for the selected thread root.
- `GET /api/thread/:threadId/project/file?path=...`: authenticated lazy single-file preview for the selected thread root.
- `GET /api/thread/:threadId/project/diff[?path=...]`: authenticated working-tree diff, optionally narrowed to one path.
- `POST /api/auth/request-code`: issue OTP and send it through Resend when mail config is available.
- `POST /api/auth/verify-code`: verify OTP and mint session.
- `GET /install/manifest.json`: authenticated bridge-install manifest; only available after login and used to mint an account-bound short-lived setup token.
- `POST /install/claim`: exchange a short-lived setup token for the bundled bridge runtime URL plus a long-lived per-device bridge token. The same setup token may be claimed multiple times until expiry so one signed-in account can register multiple machines from the same install command.
- `GET /install`: latest shell installer alias.
- `GET /install/bridge-runtime.ts`: latest local bridge runtime alias.
- `GET /relay?token=...`: WSS upgrade endpoint.
- `GET /bridge?token=...`: local bridge WSS upgrade endpoint.

## Product Scope Constraints

- Auth stays email-OTP-first. Do not add QR login or camera pairing flows.
- Transport security is HTTPS/WSS only. Do not add end-to-end encryption protocols or key-exchange layers.

## Client -> Server Events

- `thread:create` accepts `mode` (`local` or `worktree`) and an optional `cwd` seed from the selected drawer project target.
- `bridge:select` switches the active registered bridge for the signed-in account when that bridge is currently online. Offline saved bridges remain visible on Home but stay non-interactive.
- Other client events: `thread:select`, `thread:clearSelection`, `thread:rename`, `thread:delete`, `thread:archive`, `message:send`, `draft:resume`, `draft:remove`, `run:stop`, `settings:update`.
- `message:send` now accepts optional `images`. The current web composer supports one attached image and sends it as a data URL plus metadata.

## Runtime Behaviors

- Bootstrap and client websocket open send a full snapshot from the public relay.
- `AppSnapshot` now carries `activeBridgeId` plus `bridgeDevices[]`, and relay `presence` events rebroadcast those same per-device records so Home can render every registered Mac instead of only the active one.
- When Home sends `bridge:select`, the relay validates that the target bridge is both registered and currently online before moving `activeBridgeId`, clearing mirrored thread selection, rebroadcasting snapshot/presence, and requesting a fresh `bridge:sync-all` from that bridge.
- `RelayConnection` now separates `bridgeOnline` from `state`: `bridgeOnline` means the signed-in account has a live bridge websocket on the relay, while `state` continues to reflect the local Codex app-server readiness reported by that bridge.
- The public relay stores user/session/settings state; the local bridge stores thread-local execution state and talks to Codex.
- The local bridge dials out to the public relay, so the public side does not need direct LAN access to the client machine.
- The public relay now publishes a Bun-style `curl -fsSL ... | bash` installer script and bundled bridge runtime so the authenticated shell can point Mac/Linux users at a single local install/start command.
- The install manifest is no longer public. It is fetched only after login, issues a short-lived reusable setup token for that account, and the installer swaps that token through `/install/claim` before writing local bridge config.
- The shell installer should be self-contained for normal Mac/Linux targets: it should look for an existing host `bun` binary in `PATH` plus common install locations such as `~/.bun/bin/bun`, then use that Bun runtime to launch the downloaded `bridge-runtime.ts`.
- If `bun` is still missing after those checks, the installer should stop and print the official Bun install command `curl -fsSL https://bun.com/install | bash` instead of attempting an automatic install.
- The shell installer auto-detects a local Codex app-server at `ws://127.0.0.1:8765` during install. When found, it writes `PHODEX_CODEX_WS_URL` plus `PHODEX_MANAGE_CODEX=false` so subsequent bridge launches stay pinned to the foreground Codex app behavior without asking the user for extra flags.
- If no local Codex app-server is detected during install, the bridge runtime still probes `CODEX_WS_URL` first on each launch and otherwise falls back to launching its own background Codex process when `PHODEX_MANAGE_CODEX` is left enabled.
- Bridge connections are account-bound but no longer single-device. Each logged-in user can retain multiple registered bridge devices, each device keeps its own bridge token and connection record, and the relay picks one active bridge for mirrored thread state plus command dispatch.
- Non-active bridge devices may stay registered and online without replacing the active device unless they are in a strictly better readiness state than the current active bridge.
- Public relay origin generation is proxy-aware. In reverse-proxied HTTPS deployments, manifest, claim, and CORS origin values should follow trusted `Forwarded` / `X-Forwarded-*` headers instead of the internal Bun listener origin.
- The production web bundle should call relay HTTP routes via same-origin paths and derive the relay websocket from the current page origin. Do not bake loopback client targets such as `127.0.0.1:3443` into a public build.
- Bridge snapshots should always include the full thread list metadata so the drawer can show every conversation. Keep message bodies lazy by only hydrating the currently selected thread in per-user snapshots and realtime updates.
- Project browsing follows the same pattern: keep the drawer and thread metadata complete, but load directory listings, file previews, and diff payloads on demand from the relay HTTP routes.
- Thread changes rebroadcast updated thread records.
- Streaming assistant output is forwarded as append/delta/finished events.
- Historical thread reads and live item notifications map richer Codex execution items into structured thread cards.
- If Codex `thread/read` omits completed tool items, the server backfills diff/file summaries from the session JSONL plus live git state.
- The web shell inserts local pending placeholders for both `thread:create` and `message:send` until real server items arrive.
- The client/relay/bridge shared protocol uses `InputImageAttachment` records, but the local bridge must translate them to Codex app-server `turn/start.input` items shaped like `{ type: "text", text }` and `{ type: "image", url, detail? }`.
- `thread/read` user history may come back with image entries on `userMessage.content`, so the bridge keeps a separate mapping layer when rehydrating `ThreadMessage.inputImages`.
- `thread:create` resolves cwd on the server: absolute paths are used directly, `~/...` expands against the user home, and plain folder names resolve inside `~/.phodex-web/projects` unless `PHODEX_PROJECTS_ROOT` overrides that root.
- Local chats create missing directories with `mkdir -p`; worktree chats run `git worktree add` under `~/.codex/worktrees/<repo>/...`.
- Thread grouping follows the Git common-dir root so worktree chats stay grouped under the main project.
- Rename applies a local override immediately, then best-effort syncs `thread/name/set`.
- `fastMode` maps to `turn/start.serviceTier="fast"` and retries without it if the bridge rejects that field.
- Queued drafts retain runtime metadata (`model`, `planArmed`, `fastMode`, `accessMode`) for later resume.
- `on-request` sandbox writable roots are derived from each thread cwd.

## Codex App-Server Methods In Use

- `thread/start`, `thread/list`, `thread/read`, `thread/name/set`, `thread/archive`, `thread/unarchive`, `turn/start`, `turn/interrupt`

## Codex Notifications Consumed

- `thread/started`, `thread/status/changed`, `thread/name/updated`, `thread/archived`, `thread/unarchived`, `thread/closed`
- `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/diff/updated`, `turn/completed`

## Known Limits

- Thread delete is not available from Codex app-server, so permanent delete must stay out of the UI.
- The message mapper covers `commandExecution`, `fileChange`, `webSearch`, `mcpToolCall`, `collabAgentToolCall`, `imageView`, and `contextCompaction`, but the UI remains a simplified card system.
- `thread/read` may still omit completed tool activity on this workstation's current bridge build; the JSONL/git fallback is a compatibility path, not ideal source behavior.
- Codex app-server does not expose a dedicated plan item type today, so pinned-plan UI is inferred from `/plan` turns and the non-`final_answer` assistant messages inside them.
- Structured-input replacement and deeper toolbar/sheet behavior are still parity gaps.

## Invariants

- Public relay transport must stay Bun-native for HTTP/WSS.
- OTP email delivery should stay dependency-light: direct HTTP to Resend is acceptable; do not add a mail SDK just to send one transactional message.
- Keep the local Codex bridge real and outbound. Do not regress to fake assistant scripts or put local filesystem execution on the public relay.
- Do not add OTP backdoors, static bypass codes, or local auth lookup endpoints.

## Auth Delivery Notes

- In this repo's local operating context, the operator may call the provisioned Resend-backed OTP sender `Email Scale`. Treat `Email Scale` and the existing Resend mail path as the same configured capability.
- The server resolves OTP mail config from `PHODEX_RESEND_API_KEY` / `PHODEX_AUTH_EMAIL_FROM` first, then `RESEND_API_KEY` / `AUTH_EMAIL_FROM`, then the workstation fallback file configured by `PHODEX_AUTH_ENV_FILE`.
- On this workstation, the default fallback file points at the existing `remote-terminal/.env.cloudflare` setup so local Phodex can reuse the already-provisioned Resend sender without committing secrets into this repo.
- Do not claim OTP mail is unavailable by default on this workstation. First confirm it with evidence such as relay startup logs showing missing credentials or a real `/api/auth/request-code` response returning `503`.
- If no mail config is available, `/api/auth/request-code` now fails instead of exposing a local mailbox or any auth bypass path.
