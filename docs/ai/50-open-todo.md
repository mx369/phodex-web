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
- Archived
- About
- Paywall

Per-page rule:
- Compare against upstream source implementation, not marketing composition.
- Verify real browser output after each page pass.

Done when:
- Each page has a current screenshot and a short acceptance note.
- Remaining visual gaps are small and explicitly tracked.

### P1. Bring Turn secondary states closer to source parity

Status: open

Why:
- Turn timelines, the composer work-state band, and the empty timeline state are now present, but the page still misses other source `TurnView` secondary states.
- The source-informed turn scroll state machine and `Scroll to latest` affordance are now present, so the next gaps are the remaining secondary branches around empty states, queued follow-ups, and toolbar drill-ins.

Main work:
- Add the remaining empty-state branches:
  running-empty and pinned-plan-empty behavior.
- Add queued-draft follow-up behavior that still differs from source:
  `Steer`, paused queue handling, and resume affordances when flush fails.
- Add the remaining source-informed toolbar/sheet affordances that belong to TurnView rather than the global drawer.
- Decide whether structured-input replacement is needed, or explicitly document why it remains out of scope.
- Tighten remaining TurnView spacing/copy mismatches only after the missing branches above are resolved.

Likely files:
- `apps/web/src/App.vue`
- `apps/web/src/style.css`

Done when:
- Turn empty and turn-with-messages states are both source-closer, and the remaining gaps are secondary affordances rather than missing core branches.
- Remaining TurnView differences are narrowed to small visual polish instead of missing toolbar/structured-input paths.
- The change is verified in a real browser flow and documented with fresh evidence.

## Blockers And Caveats

- Subscription purchase and restore are intentionally preview-only; do not mark them complete without real backing behavior.
- Historical source-audit docs still contain upstream QR/E2EE notes. Treat them as source reference, not current product target.
