# Server AGENTS.md

Read this file before editing anything under `apps/server`.

## Scope

- Main files: `src/relay.ts` and `src/index.ts`
- `src/relay.ts` owns the public HTTP/WSS relay, OTP auth, static web serving, and authenticated client sessions.
- `src/index.ts` owns the local outbound bridge to the public relay plus the real local Codex app-server integration.

## Package Rules

- Keep HTTPS and WSS on Bun-native primitives. Do not introduce third-party HTTP or websocket server stacks.
- Keep the bridge connected to the real local Codex CLI service.
- Do not add OTP backdoors, static bypass codes, or local dev-only auth shortcuts.
- Do not claim thread deletion works; Codex app-server does not currently expose it.
- Do not add QR login or camera pairing support.
- Do not add end-to-end encryption on top of HTTPS/WSS.

## Current Truth

- Real endpoints exist for health, bootstrap, OTP issue, OTP verify, client relay websocket, and bridge websocket.
- OTP auth requires real email delivery on the public relay; no dev-code lookup or static bypass remains.
- The relay now keeps user/session state, while thread execution and Codex filesystem work stay on the local bridge.
- Codex integration currently uses thread start/list/read, thread name update, archive/unarchive, turn start, and turn interrupt.
- Richer upstream message mapping is still incomplete.

## Read Next

- Protocol or bridge work: `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`
- Acceptance work: `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`

## Verification

- Exercise the affected endpoint or websocket path directly.
- Then run at least one end-to-end path through the web client if the change affects runtime behavior.
