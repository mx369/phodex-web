# Server AGENTS.md

Read this file before editing anything under `apps/server`.

## Scope

- Main file: `src/index.ts`
- This package owns Bun-native HTTPS/WSS transport, OTP auth, snapshot/bootstrap, persistence, and the local Codex app-server bridge.

## Non-Negotiables

- Keep HTTPS and WSS on Bun-native primitives. Do not introduce third-party HTTP or websocket server stacks.
- Keep the bridge connected to the real local Codex CLI service.
- Preserve the local OTP dev bypass unless the task explicitly removes it.
- Do not claim thread deletion works; Codex app-server does not currently expose it.

## Current Truth

- Real endpoints exist for health, bootstrap, OTP issue/verify, and dev-code lookup.
- The websocket bridge relays snapshots and live thread/message updates.
- Codex integration currently uses thread start/list/read, thread name update, archive/unarchive, turn start, and turn interrupt.
- Richer upstream message mapping is still incomplete.

## Required Reads By Task

- Protocol or bridge work: `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`
- Acceptance work: `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`

## Verification

- Exercise the affected endpoint or websocket path directly.
- Then run at least one end-to-end path through the web client if the change affects runtime behavior.
