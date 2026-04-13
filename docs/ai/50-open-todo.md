# Open TODO

This file is the dedicated unfinished-work list for follow-on AI agents. Keep it execution-oriented. Do not turn it into a status essay.

## How To Use

- Read this file when planning, continuing unfinished work, or choosing the next implementation unit.
- Cross-check against `05-product-decisions.md` before starting. QR login, camera pairing, and end-to-end encryption are excluded.
- When a todo item is completed, update this file in the same commit that lands the work.

## Priority Order

### P1. Bring the core pages closer to source parity, page by page

Status: open

Pages to finish:
- Onboarding
- Bootstrap failure
- Subscription gate
- Email OTP
- Turn empty
- Turn with messages
- Settings
- Archived
- About
- Paywall

Per-page rule:
- Compare against upstream source implementation, not marketing composition.
- Verify real browser output after each page pass.

Done when:
- Each page has a current screenshot and a short acceptance note.
- Remaining visual gaps are small and explicitly tracked.

### P1. Improve message mapping from Codex app-server into richer thread surfaces

Status: open

Why:
- The server currently maps only `userMessage` and `agentMessage` into chat messages. Richer source-app-style execution surfaces are still missing.

Main work:
- Inspect Codex app-server items and notifications more deeply.
- Map real tool/run/file/diff-related items where available.
- Reflect them in thread rendering without inventing fake data.

Likely files:
- `apps/server/src/index.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/App.vue`

Done when:
- Thread surfaces show real structured execution data where Codex provides it.

## Blockers And Caveats

- Subscription purchase and restore are intentionally preview-only; do not mark them complete without real backing behavior.
- Historical source-audit docs still contain upstream QR/E2EE notes. Treat them as source reference, not current product target.
