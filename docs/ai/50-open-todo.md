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

### P1. Bring Turn composer work-state closer to source parity

Status: open

Why:
- Turn timelines now show richer execution cards, but the composer area still misses the source app's visible work-state layer.

Main work:
- Add a composer accessory band above the input when plan or queue state exists.
- Surface queued drafts as a visible resume/remove list instead of leaving queue state implicit.
- Add a source-informed pinned-plan summary surface without reintroducing inert Fast/Plan toggles.

Likely files:
- `apps/web/src/App.vue`
- `apps/web/src/style.css`

Done when:
- The accessory appears only when plan or queued drafts exist.
- Queue state is visible and actionable in the authenticated turn view.
- The change is verified in a real browser flow and documented with fresh evidence.

## Blockers And Caveats

- Subscription purchase and restore are intentionally preview-only; do not mark them complete without real backing behavior.
- Historical source-audit docs still contain upstream QR/E2EE notes. Treat them as source reference, not current product target.
