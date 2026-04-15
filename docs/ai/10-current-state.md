# Current State

Broad status snapshot for planning and handoff.

## Repository Shape

- `apps/web`: Vue 3 full-page mobile shell, current UI implementation, and client socket/bootstrap logic.
- `apps/server`: Bun HTTPS/WSS relay, email OTP auth, local state persistence, and Codex app-server bridge.
- `packages/shared`: shared protocol and record types.
- `docs`: source audit notes, page matrices, CDP acceptance docs, and this AI context stack.

## Real Today

- Email code request, live Resend delivery when mail config is available, and OTP verify.
- HTTPS bootstrap and WSS relay session sync.
- Local Codex app-server connection, thread listing, thread read, turn start, and turn interrupt.
- Conversation send, stream, stop, queue, resume, rename, and archive.
- Real browser-based CDP screenshots and acceptance artifacts.

## Still Incomplete

- Page-by-page parity across onboarding, auth, home, turn, settings, archived, about, and paywall.
- Purchase and restore flows; current subscription surfaces are preview-only.
- Turn secondary states, structured-input replacement, and some toolbar/sheet affordances.
- Final visual parity across screens.

## Excluded Scope

- QR-code login and camera pairing.
- End-to-end encryption and upstream encrypted-envelope flows.

## Current Risk Areas

- Turn rendering maps more Codex execution items than before, but the resulting UI is still a simplified version of source `TurnView`.
- Several screens are behaviorally real but still visually approximate.

## Acceptance Standard

- Reconstruct from source, not marketing screenshots.
- Verify the real flow.
- Capture fresh evidence when acceptance depends on behavior or visuals.
- Call out remaining gaps explicitly.

## Read Next

- UI work: `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`
- Server and protocol work: `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`
- Verification and evidence: `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`
