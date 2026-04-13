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
- `POST /api/auth/request-code`: issue OTP.
- `POST /api/auth/verify-code`: verify OTP and mint session.
- `GET /api/auth/dev-code`: read current OTP/static bypass when dev bypass is enabled.
- `GET /relay?token=...`: WSS upgrade endpoint.

## Product Scope Constraints

- Auth must stay email-OTP-first. Do not add QR login or camera pairing flows.
- Transport security is HTTPS/WSS only. Do not add end-to-end encryption protocols or key exchange layers.

## Client -> Server Events

- `thread:create`
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
- Completion banners are synthesized after run completion.

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

- Thread delete is not available from Codex app-server, so the UI cannot truly delete threads yet.
- The current message mapper only turns `userMessage` and `agentMessage` into thread messages.
- Richer upstream message types are not fully surfaced yet.
- `fastMode` and `planArmed` are currently UI-level fields with limited or no downstream behavioral effect.

## Invariants

- Server transport must stay Bun-native for HTTPS and WSS. Do not add third-party HTTP or websocket server dependencies.
- Keep the local Codex bridge real. Do not regress to fake assistant scripts.
- Preserve the OTP dev bypass for local validation unless the user explicitly removes it.
