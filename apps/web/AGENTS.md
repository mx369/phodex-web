# Web AGENTS.md

Read this file before editing anything under `apps/web`.

## Scope

- Main files: `src/App.vue`, `src/style.css`, `src/lib/client.ts`.
- This package owns page structure, client-side state flow, UI interactions, and visual acceptance.

## Non-Negotiables

- Recreate the upstream mobile app content, not fake phone hardware.
- Do not add simulated iPhone chrome, status bars, or marketing device framing.
- Prefer source-driven page reconstruction over screenshot imitation.
- Keep real flows wired to the live client state. Do not fake success states if the server does not support them.
- Do not implement QR-code login or camera pairing.
- Do not implement end-to-end encryption or encryption-themed UX copy.

## Current Truth

- The UI now uses a full-page mobile shell with dedicated mobile-page routes for settings/about/paywall/archived.
- `Email OTP`, `new chat`, `send`, `stream`, `stop`, `queue`, `resume draft`, `rename`, and `archive` are wired.
- Purchase remains preview-only, and richer turn/tool surfaces still remain partial.

## Required Reads By Task

- Any page or interaction work: `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`
- Any acceptance or screenshot work: `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`

## Verification

- Minimum: `bun run build:web`
- For visual changes, also validate the real running page and capture fresh evidence if acceptance depends on appearance.
