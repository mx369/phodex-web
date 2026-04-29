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
- `GET /install/bridge-installer.js`: latest Bun-based bridge installer alias used by the Windows PowerShell flow.
- `GET /install/bridge-runtime.ts`: latest local bridge runtime alias.
- `GET /relay?token=...`: WSS upgrade endpoint.
- `GET /bridge?token=...`: local bridge WSS upgrade endpoint.

## Product Scope Constraints

- Auth stays email-OTP-first. Do not add QR login or camera pairing flows.
- Transport security is HTTPS/WSS only. Do not add end-to-end encryption protocols or key-exchange layers.

## Client -> Server Events

- `thread:create` accepts `mode` (`local` or `worktree`) and an optional `cwd` seed from the selected drawer project target. The bridge should acknowledge accepted create work separately from the final Codex `thread/start` result.
- `bridge:select` switches the active registered bridge for the signed-in account when that bridge is currently online. Offline saved bridges remain visible on Home but stay non-interactive.
- Other client events: `thread:select`, `thread:history:load`, `thread:clearSelection`, `thread:rename`, `thread:delete`, `thread:archive`, `message:send`, `draft:resume`, `draft:remove`, `run:stop`, `settings:update`.
- `message:send` now accepts optional `images`. The current web composer supports one attached image and sends it as a data URL plus metadata.

## Runtime Behaviors

- `GET /api/bootstrap`, OTP verify, and relay `snapshot` events now send metadata-first snapshots from the public relay.
- The selected thread's message bodies hydrate separately over the websocket via bridge sync and `thread:updated`, so session restore does not redownload the full selected conversation in every snapshot hop.
- Selected-thread history now pages from Codex app-server through the bridge when `thread/turns/list` is available: the first selected-thread hydration requests only the latest turn page, and `thread:history:load` asks the bridge for the next older page instead of forcing `thread/read(includeTurns=true)` for the entire rollout. Older Codex app-server builds fall back to the legacy full `thread/read(includeTurns=true)` path.
- When Codex returns paged history without a total count, `ThreadHistoryState.totalMessages` and `remainingMessages` are `null`; the UI should show loading or a generic "Load earlier messages" action, not a fabricated remaining count.
- Newly created threads are emitted through `bridge:thread:created` with a `ThreadRecord` and explicit known-empty history (`totalMessages=0`, `isHydrating=false`). The bridge first emits `bridge:thread:create-accepted` after local cwd/worktree validation so relay/client pending UI is not failed by short dispatch timeouts while Codex `thread/start` is still opening the session. Creating a thread should not immediately trigger a full `thread/list` sync or a selected-thread history read for that empty thread.
- `AppSnapshot` now carries `activeBridgeId` plus `bridgeDevices[]`, and relay `presence` events rebroadcast those same per-device records so Home can render every registered bridge device instead of only the active one.
- When Home sends `bridge:select`, the relay validates that the target bridge is both registered and currently online before moving `activeBridgeId`, clearing mirrored thread selection, rebroadcasting snapshot/presence, and requesting a fresh `bridge:sync-all` from that bridge.
- `RelayConnection` now separates `bridgeOnline` from `state`: `bridgeOnline` means the signed-in account has a live bridge websocket on the relay, while `state` continues to reflect the local Codex app-server readiness reported by that bridge.
- `RelayConnection` carries the local Codex `account/rateLimits` snapshot when available. The bridge refreshes it after app-server initialization, applies `account/rateLimits/updated` notifications, and the drawer footer displays short-window and weekly remaining quota beside the relay latency.
- The public relay stores user/session/settings state; the local bridge stores thread-local execution state and talks to Codex.
- The local bridge dials out to the public relay, so the public side does not need direct LAN access to the client machine.
- The public relay now publishes both a Bun-style `curl -fsSL ... | bash` installer for Mac/Linux and a Bun-based `bridge-installer.js` entrypoint for Windows PowerShell, plus the bundled bridge runtime.
- The install manifest is no longer public. It is fetched only after login, issues a short-lived reusable setup token for that account, and the installer swaps that token through `/install/claim` before writing local bridge config.
- The shell installer should be self-contained for normal Mac/Linux targets: it should look for an existing host `bun` binary in `PATH` plus common install locations such as `~/.bun/bin/bun`, then use that Bun runtime to launch the downloaded `bridge-runtime.ts`.
- On Mac/Linux, installed bridge restarts should go through the user's login shell before `bun bridge-runtime.ts` so the runtime inherits the same shell-managed `PATH` and toolchain environment that a normal Terminal session sees, instead of the thinner `launchd` or non-interactive shell defaults.
- The Windows installer command should stay self-contained as well: it downloads the Bun-based installer entrypoint, checks for `bun`, and launches the same bridge runtime without requiring a separate shell script path.
- If `bun` is still missing after those checks, the installer should stop and print the official Bun install command `curl -fsSL https://bun.com/install | bash` instead of attempting an automatic install.
- On Windows, the missing-`bun` hint should point to the official PowerShell install command `powershell -c "irm bun.sh/install.ps1 | iex"`.
- The shell installer tries to make Phodex own a local Codex app-server on `ws://127.0.0.1:8765` during the same install command. On macOS it first removes the prior `com.phodex.codex.*` LaunchAgent and stops any manual listener occupying the target port, then registers a separate `com.phodex.codex.*` LaunchAgent that re-enters the login shell and execs `codex app-server --listen ...`. If 8765 remains unavailable, it falls back through 8766-8775, prints the chosen replacement URL, and writes that URL plus `PHODEX_MANAGE_CODEX=false` for the bridge.
- Installed bridge commands always write `PHODEX_MANAGE_CODEX=false`. The bridge should reuse an already-running official Codex app-server and report disconnected if it is unavailable, rather than silently launching a background Codex process under the Bun bridge runtime.
- Bridge connections are account-bound but no longer single-device. Each logged-in user can retain multiple registered bridge devices, each device keeps its own bridge token and connection record, and the relay picks one active bridge for mirrored thread state plus command dispatch.
- Non-active bridge devices may stay registered and online without replacing the active device unless they are in a strictly better readiness state than the current active bridge.
- Runtime connection records use `deviceLabel` for the bridge host display name. `macLabel` may appear only as a legacy compatibility alias from older installers or persisted state.
- Public relay origin generation is proxy-aware. In reverse-proxied HTTPS deployments, manifest, claim, and CORS origin values should follow trusted `Forwarded` / `X-Forwarded-*` headers instead of the internal Bun listener origin.
- The production web bundle should call relay HTTP routes via same-origin paths and derive the relay websocket from the current page origin. Do not bake loopback client targets such as `127.0.0.1:3443` into a public build.
- Bridge snapshots should always include the full thread list metadata so the drawer can show every conversation. Keep message bodies lazy by hydrating the selected thread through `thread:updated` and message events instead of every snapshot.
- Bridge `thread:updated` payloads may carry a selected thread with `messages: []` and `history.isHydrating=true`; the client should treat that as an explicit history-loading state rather than an empty conversation.
- `message:send` is request-scoped. The web client sends a `requestId`, the relay tracks the bridge dispatch, and the bridge must return `bridge:message:send-result` so the relay can emit either `message:send-accepted` or `message:send-failed` back to the client. A relay-to-bridge dispatch is not enough to clear or confirm the client pending message. If a regular turn is already running, the bridge should prefer Codex app-server `turn/steer` so follow-ups attach to the active turn and stay visible immediately; queued drafts are the fallback when steering is unavailable or rejected.
- Relay bridge-state sync must not fabricate a missing selected thread. If the active bridge's full thread list omits the selected thread, the relay should normalize selection to an existing thread or `null` instead of keeping a ghost thread that can receive sends.
- Project browsing follows the same pattern: keep the drawer and thread metadata complete, but load directory listings, file previews, and diff payloads on demand from the relay HTTP routes.
- New-chat navigation is optimistic: the web client inserts a temporary `pending-thread:*` record, immediately routes to that temporary thread ID, shows a lightweight creating notice, keeps it alive after `thread:create-accepted`, and replaces the URL with the real Codex thread route only when `thread:created` resolves. Unrelated error toasts must not roll back pending create state; only explicit `thread:create-failed` should.
- Thread changes rebroadcast updated thread records.
- Streaming assistant output is forwarded as append/delta/finished events.
- Historical thread reads and live item notifications map richer Codex execution items into structured thread cards.
- If Codex `thread/read` omits completed tool items, the server backfills diff/file summaries from the session JSONL plus live git state.
- The web shell inserts local pending placeholders for both `thread:create` and `message:send` until real server items arrive.
- The client/relay/bridge shared protocol uses `InputImageAttachment` records, but the local bridge must translate them to Codex app-server turn input items shaped like `{ type: "text", text }` and `{ type: "image", url, detail? }` for both `turn/start` and `turn/steer`.
- `thread/read` user history may come back with image entries on `userMessage.content`, so the bridge keeps a separate mapping layer when rehydrating `ThreadMessage.inputImages`.
- `thread:create` resolves cwd on the server: absolute paths are used directly, `~/...` expands against the user home, and plain folder names resolve inside `~/.phodex-web/projects` unless `PHODEX_PROJECTS_ROOT` overrides that root.
- Local chats create missing directories with `mkdir -p`; worktree chats run `git worktree add` under `~/.codex/worktrees/<repo>/...`.
- Thread grouping follows the Git common-dir root so worktree chats stay grouped under the main project.
- Rename applies a local override immediately, then best-effort syncs `thread/name/set`.
- `fastMode` maps to `turn/start.serviceTier="fast"` and retries without it if the bridge rejects that field.
- Queued drafts retain runtime metadata (`model`, `planArmed`, `fastMode`, `accessMode`) for later resume. Running-turn follow-ups use `turn/steer`, which intentionally reuses the active turn context instead of applying new runtime overrides.
- `on-request` sandbox writable roots are derived from each thread cwd.

## Codex App-Server Methods In Use

- `thread/start`, `thread/list`, `thread/read`, `thread/turns/list`, `thread/name/set`, `thread/archive`, `thread/unarchive`, `turn/start`, `turn/steer`, `turn/interrupt`

## Codex Notifications Consumed

- `thread/started`, `thread/status/changed`, `thread/name/updated`, `thread/archived`, `thread/unarchived`, `thread/closed`
- `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/diff/updated`, `turn/completed`

## Known Limits

- Thread delete is not available from Codex app-server, so permanent delete must stay out of the UI.
- The message mapper covers `commandExecution`, `fileChange`, `webSearch`, `mcpToolCall`, `collabAgentToolCall`, `imageView`, and `contextCompaction`, but the UI remains a simplified card system.
- Paged `thread/turns/list` history may not provide a total message count, and current upstream still rebuilds rollout history internally per page; it primarily avoids sending the full turn array over the bridge on initial route load.
- `thread/read` may still omit completed tool activity on older bridge builds; the JSONL/git fallback is a compatibility path for the legacy full-read path, not ideal source behavior.
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
