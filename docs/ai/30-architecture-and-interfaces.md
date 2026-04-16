# Architecture And Interfaces

Read this file for relay, auth, client, and Codex bridge work.

## Workspace Ownership

- `apps/web/src/App.vue`: top-level UI state, page routing, shell panels, dialogs, and composer surfaces.
- `apps/web/src/lib/client.ts`: bootstrap fetches, websocket lifecycle, optimistic UI sync, and client event emission.
- `apps/server/src/relay.ts`: Bun public relay, static web serving, OTP auth, authenticated client sessions, and bridge session management.
- `apps/server/src/index.ts`: local outbound bridge, Codex app-server integration, thread sync, and local filesystem/worktree operations.
- `packages/shared/src/index.ts`: shared event and record shapes.

## HTTP Endpoints

- `GET /api/health`: relay and Codex bridge health summary.
- `GET /api/bootstrap`: authenticated snapshot bootstrap.
- `POST /api/auth/request-code`: issue OTP and send it through Resend when mail config is available.
- `POST /api/auth/verify-code`: verify OTP and mint session.
- `GET /install/manifest.json`: public bridge-install manifest for onboarding and local installer bootstrap.
- `POST /install/claim`: exchange a short-lived setup token for the bundled bridge runtime URL plus the long-lived bridge secret.
- `GET /install/phodex-bridge-installer.tgz`: latest installer tarball alias.
- `GET /install/bridge-runtime.js`: latest bundled local bridge runtime alias.
- `GET /relay?token=...`: WSS upgrade endpoint.
- `GET /bridge?secret=...`: local bridge WSS upgrade endpoint.

## Product Scope Constraints

- Auth stays email-OTP-first. Do not add QR login or camera pairing flows.
- Transport security is HTTPS/WSS only. Do not add end-to-end encryption protocols or key-exchange layers.

## Client -> Server Events

- `thread:create` accepts `mode` (`local` or `worktree`) and an optional `cwd` seed from the selected drawer project target.
- Other client events: `thread:select`, `thread:clearSelection`, `thread:rename`, `thread:delete`, `thread:archive`, `message:send`, `draft:resume`, `draft:remove`, `run:stop`, `settings:update`.

## Runtime Behaviors

- Bootstrap and client websocket open send a full snapshot from the public relay.
- The public relay stores user/session/settings state; the local bridge stores thread-local execution state and talks to Codex.
- The local bridge dials out to the public relay, so the public side does not need direct LAN access to the client machine.
- The public relay now publishes a versioned `bunx` installer and bundled bridge runtime so onboarding can point Mac users at a single local install/start command.
- The install manifest no longer exposes the long-lived bridge secret. It issues a short-lived single-use setup token, and the installer swaps that token through `/install/claim` before writing local bridge config.
- Public relay origin generation is proxy-aware. In reverse-proxied HTTPS deployments, manifest, claim, and CORS origin values should follow trusted `Forwarded` / `X-Forwarded-*` headers instead of the internal Bun listener origin.
- Bridge thread-sync defaults depend on relay target: local relay hosts keep the old full-thread sweep, while public relay hosts default to syncing only the currently selected thread ids. Override with `PHODEX_BRIDGE_SYNC_MODE=all|selected` when you need a different behavior.
- Thread changes rebroadcast updated thread records.
- Streaming assistant output is forwarded as append/delta/finished events.
- Historical thread reads and live item notifications map richer Codex execution items into structured thread cards.
- If Codex `thread/read` omits completed tool items, the server backfills diff/file summaries from the session JSONL plus live git state.
- The web shell inserts local pending placeholders for both `thread:create` and `message:send` until real server items arrive.
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

- The server resolves OTP mail config from `PHODEX_RESEND_API_KEY` / `PHODEX_AUTH_EMAIL_FROM` first, then `RESEND_API_KEY` / `AUTH_EMAIL_FROM`, then the workstation fallback file configured by `PHODEX_AUTH_ENV_FILE`.
- On this workstation, the default fallback file points at the existing `remote-terminal/.env.cloudflare` setup so local Phodex can reuse the already-provisioned Resend sender without committing secrets into this repo.
- If no mail config is available, `/api/auth/request-code` now fails instead of exposing a local mailbox or any auth bypass path.
