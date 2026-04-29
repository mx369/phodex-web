# Web AGENTS.md

Read this file before editing anything under `apps/web`.

## Scope

- Main files: `src/App.vue`, `src/style.css`, `src/lib/client.ts`.
- This package owns page structure, client-side state flow, UI interactions, and visual acceptance.

## Package Rules

- Recreate upstream mobile app content, not fake phone hardware, status bars, or marketing device framing.
- Prefer source-driven page reconstruction over screenshot imitation.
- Keep real flows wired to live client state; do not fake unsupported success states.
- Apply product exclusions from `/Users/young/mx/tmp/phodex-web/docs/ai/05-product-decisions.md` when touching auth, pairing, encryption, or purchases.
- Purchase and restore remain preview-only unless the backing behavior changes.

## Current Truth

- The UI now uses a full-page mobile shell with dedicated mobile-page routes for archived/about/paywall.
- `Email OTP`, `new chat`, `send`, `stream`, `stop`, `queue`, `resume draft`, `rename`, and `archive` are wired.
- Visual parity and richer turn/tool surfaces still remain partial.

## Read Next

- Any page or interaction work: `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`
- Any acceptance or screenshot work: `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`

## Verification

- Minimum: `bun run build:web`
- For visual changes, also validate the real running page and capture fresh evidence if acceptance depends on appearance.
- OTP-gated acceptance must use real email plus mailbox-reading skill; report blockers instead of using auth shortcuts.
