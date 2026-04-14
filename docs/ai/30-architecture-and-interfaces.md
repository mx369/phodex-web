# Architecture And Interfaces

Read this file for relay, auth, client, and Codex bridge work.

## Workspace Ownership

- `apps/web/src/App.vue`: top-level UI state, page routing, shell panels, dialogs, and composer surfaces.
- `apps/web/src/lib/client.ts`: bootstrap fetches, websocket lifecycle, optimistic UI sync, and client event emission.
- `apps/server/src/index.ts`: Bun HTTPS/WSS server, auth routes, relay session management, local persistence, and Codex app-server bridge.
- `packages/shared/src/index.ts`: shared event and record shapes.

## HTTP Endpoints

- `GET /api/health`: relay and Codex bridge health summary.
- `GET /api/bootstrap`: authenticated snapshot bootstrap.
- `POST /api/auth/request-code`: issue OTP and send it through Resend when mail config is available.
- `POST /api/auth/verify-code`: verify OTP and mint session.
- `GET /api/auth/dev-code`: read current OTP/static bypass when dev bypass is enabled.
- `GET /relay?token=...`: WSS upgrade endpoint.

## Product Scope Constraints

- Auth must stay email-OTP-first. Do not add QR login or camera pairing flows.
- Transport security is HTTPS/WSS only. Do not add end-to-end encryption protocols or key exchange layers.

## Client -> Server Events

- `thread:create`
  accepts `mode` (`local` or `worktree`) and an optional `cwd` seed from the selected drawer project target
- `thread:select`
- `thread:clearSelection`
- `thread:rename`
- `thread:delete`
- `thread:archive`
- `message:send`
- `draft:resume`
- `draft:remove`
- `run:stop`
- `settings:update`

## Server -> Client Behavior

- Bootstrap and websocket open send a full snapshot.
- Thread changes rebroadcast updated thread records.
- Streaming assistant output is forwarded as append/delta/finished events.
- Historical thread reads and live item notifications now map richer Codex execution items into structured thread cards.
- When Codex `thread/read` omits completed tool items, the server now falls back to the thread session JSONL plus the live git worktree state to restore diff chips and file-change summaries for the selected thread.
- Completion banner payloads are still synthesized after run completion, but the web shell suppresses normal success banners and only surfaces failures through floating error toasts.
- The web client now inserts a local pending-thread placeholder as soon as `thread:create` is sent, then removes it when the server snapshot or thread update for the real thread arrives.
- The web client now also inserts a local pending-run placeholder immediately after `message:send`, so the submitted prompt stays visible until the server echoes the first live item for that turn.
- `thread:create` now resolves cwd on the server: absolute paths are used directly, `~/...` expands against the user home, and plain folder names resolve inside `~/.phodex-web/projects` unless `PHODEX_PROJECTS_ROOT` overrides that default.
- Local chat creation now `mkdir -p`s the requested cwd when it does not exist, so the drawer can create a fresh project folder before starting Codex there.
- Worktree chats still resolve the selected Git project root first, then run `git worktree add` under `~/.codex/worktrees/<repo>/...` before starting the Codex thread from the new worktree path.
- Thread grouping now uses the Git common-dir root rather than the raw worktree cwd, so worktree chats stay grouped under the main project label.
- Thread rename now applies a persisted local title override immediately, then best-effort syncs `thread/name/set` through Codex when the backend supports it.

## Codex App-Server Methods In Use

- `thread/start`
- `thread/list`
- `thread/read`
- `thread/name/set`
- `thread/archive`
- `thread/unarchive`
- `turn/start`
- `turn/interrupt`

## Codex Notifications Consumed

- `thread/started`
- `thread/status/changed`
- `thread/name/updated`
- `thread/archived`
- `thread/unarchived`
- `thread/closed`
- `turn/started`
- `item/started`
- `item/agentMessage/delta`
- `item/completed`
- `turn/diff/updated`
- `turn/completed`

## Known Interface Limits

- Thread delete is not available from Codex app-server, so permanent delete must stay out of the UI.
- The current message mapper now covers `commandExecution`, `fileChange`, `webSearch`, `mcpToolCall`, `collabAgentToolCall`, `imageView`, and `contextCompaction`, but the resulting UI is still a simplified card system.
- Codex `thread/read` on this workstation's current app-server build may return only user/assistant history for completed turns even when the live run emitted tool activity. Phodex now backfills `apply_patch`-driven file summaries from the session JSONL and reconciles the selected thread's current git diff as a compatibility fallback.
- Codex app-server does not expose a dedicated plan item type today, so pinned-plan UI is inferred from `/plan` turns and the non-`final_answer` assistant messages inside them.
- Pinned plans and queued drafts now surface above the composer, but structured-input replacement and deeper toolbar/sheet behaviors are still client-side parity gaps.
- `fastMode` now maps to `turn/start.serviceTier="fast"` when the local Codex bridge accepts that field; if the bridge rejects `serviceTier` with `invalid params`, the server retries without it and remembers the limitation for the current bridge session.
- Queued drafts now preserve their send-time runtime metadata (`model`, `planArmed`, `fastMode`, `accessMode`) so a resumed draft replays the same run configuration instead of silently falling back to defaults.
- `on-request` sandbox writable roots are now derived from each thread's actual repo/worktree cwd instead of always falling back to the default app root.

## Invariants

- Server transport must stay Bun-native for HTTPS and WSS. Do not add third-party HTTP or websocket server dependencies.
- OTP email delivery should stay dependency-light: direct HTTP to Resend is acceptable, but do not add a mail SDK just to send one transactional message.
- Keep the local Codex bridge real. Do not regress to fake assistant scripts.
- Preserve the OTP dev bypass for local validation unless the user explicitly removes it.

## Auth Delivery Notes

- The server resolves OTP mail config from `PHODEX_RESEND_API_KEY` / `PHODEX_AUTH_EMAIL_FROM` first, then `RESEND_API_KEY` / `AUTH_EMAIL_FROM`, then the workstation fallback file configured by `PHODEX_AUTH_ENV_FILE`.
- On this workstation, the default fallback file points at the existing `remote-terminal/.env.cloudflare` setup so local Phodex can reuse the already-provisioned Resend sender without committing secrets into this repo.
- If no mail config is available, `/api/auth/request-code` still succeeds by returning `delivery=local-mailbox`, and the dev bypass/backdoor path remains available for local QA.
