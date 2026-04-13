# Current State

This file is the level-1 handoff and status summary. It is intentionally broader than `00-start-here.md` but still compressed.

## Repository Shape

- `apps/web`: Vue 3 full-page mobile shell, current UI implementation, and client socket/bootstrap logic.
- `apps/server`: Bun HTTPS/WSS relay, email OTP auth, local state persistence, and Codex app-server bridge.
- `packages/shared`: shared protocol and record types.
- `docs`: source audit notes, page matrices, CDP acceptance docs, and this AI context stack.

## Functional Reality

Implemented and real:

- Email code request, verify, and local dev backdoor code.
- HTTPS bootstrap and WSS relay session sync.
- Local Codex app-server connection, thread listing, thread read, turn start, and turn interrupt.
- Conversation send/stream/stop flow.
- Queued drafts while a run is active.
- Thread rename and archive/unarchive.
- Real browser-based CDP screenshots and acceptance artifacts.

Implemented but incomplete:

- Onboarding, bootstrap failure, subscription gate, and paywall pages.
- Home empty, sidebar, settings, archived, and about pages now render as full-page mobile surfaces, but remain approximate.
- Model selector, access mode toggle, fast/plan UI toggles, pinned plan surface, and autocomplete UI.

Not yet source-equal or still shell-level:

- Pixel parity across screens.
- Real subscription purchase or restore flows; current paywall/gate surfaces are preview-only.
- Many upstream interaction details such as swipe actions, context menus, richer approval flows, and deeper tool/file surfaces.

Explicitly excluded by current product direction:

- QR-code login and camera pairing.
- End-to-end encryption and upstream encrypted-envelope flows.

## Current Architectural Debt

- Thread rendering still maps only the simpler Codex message shapes and misses richer execution surfaces where available.

## Acceptance Bar

The intended acceptance bar is not "looks similar." It is:

1. Source app pages identified.
2. Page behavior reconstructed from source.
3. Real flow verified.
4. CDP screenshots captured.
5. Remaining gaps called out explicitly instead of being implied away.

## Recommended Next Reads

- UI work: `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`
- Server and protocol work: `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`
- Verification and evidence: `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`
