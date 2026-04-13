# Open TODO

This file is the dedicated unfinished-work list for follow-on AI agents. Keep it execution-oriented. Do not turn it into a status essay.

## How To Use

- Read this file when planning, continuing unfinished work, or choosing the next implementation unit.
- Cross-check against `05-product-decisions.md` before starting. QR login, camera pairing, and end-to-end encryption are excluded.
- When a todo item is completed, update this file in the same commit that lands the work.

## Priority Order

### P0. Remove excluded QR/E2EE product remnants from the actual app

Status: open

Why:
- Product decisions now explicitly exclude QR login, camera pairing, and end-to-end encryption, but the actual web app and some acceptance docs still contain those flows and that copy.

Main work:
- Remove QR-related root states and screens from `apps/web/src/App.vue`.
- Remove QR-related styles from `apps/web/src/style.css`.
- Collapse auth to onboarding -> email OTP only.
- Remove encryption-themed copy from onboarding, conversation empty states, about, paywall, and any remaining UI labels.
- Remove or rewrite stale acceptance docs that still validate scanner/recovery pages.

Likely files:
- `apps/web/src/App.vue`
- `apps/web/src/style.css`
- `docs/cdp-acceptance.md`
- `docs/cdp-acceptance-runbook.md`
- `docs/page-function-acceptance.md`

Done when:
- No user-facing QR login or camera pairing flow remains.
- No user-facing E2EE copy remains.
- Acceptance docs no longer treat scanner pages as part of the target product.

### P0. Replace the current web-shell layout with a true mobile-page structure

Status: open

Why:
- The current UI still depends on a fixed-width `app-surface` and overlay `app-sheet` model. That is the main reason the build still feels like a web shell instead of the intended mobile app.

Main work:
- Remove the fixed centered card assumption from the main shell.
- Rebuild top-level navigation so pages feel like native mobile pages, not a desktop page containing a phone-sized card.
- Revisit top bars, drawer behavior, and page transitions after the shell change.

Likely files:
- `apps/web/src/App.vue`
- `apps/web/src/style.css`

Done when:
- The app occupies the page as a mobile UI surface, not as a centered faux-device card.
- Settings, archived, about, and paywall no longer feel like generic overlay sheets.

### P0. Make the root auth and onboarding flow email-only and source-consistent

Status: open

Why:
- Onboarding and auth are still partially shaped around old pairing concepts.

Main work:
- Rewrite step sequencing so onboarding leads directly into email OTP.
- Remove bridge-mismatch / scan-error / camera-permission dependencies from auth routing.
- Keep the local OTP backdoor for validation.
- Re-run CDP screenshots for the revised auth stack.

Likely files:
- `apps/web/src/App.vue`
- `apps/web/src/style.css`
- `apps/web/src/lib/client.ts`
- `docs/page-function-acceptance.md`

Done when:
- Fresh unauthenticated users only see onboarding and email OTP paths.
- Auth screenshots and docs reflect the simplified product.

### P1. Bring the core pages closer to source parity, page by page

Status: open

Pages to finish:
- Onboarding
- Bootstrap failure
- Subscription gate
- Email OTP
- Home empty
- Sidebar
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

### P1. Remove UI placeholders that look real but are not backed by real behavior

Status: open

Why:
- Several surfaces currently imply richer implementation than the backend actually provides.

Main work:
- Audit `runEvents`, `fileChanges`, `codeBlock`, `subagentCount`, `unreadCount`, voice button, and attachment button behavior.
- Either implement the backing behavior or visibly demote/remove the placeholder.
- Ensure the UI does not over-claim capabilities.

Likely files:
- `apps/web/src/App.vue`
- `apps/server/src/index.ts`
- `packages/shared/src/index.ts`

Done when:
- Every visible control or card either works or is intentionally absent.

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

### P1. Resolve thread delete UX honestly

Status: open

Why:
- The UI offers delete even though the current backend cannot actually delete threads.

Main work:
- Either remove delete from the UI or redesign it as an archive-only action with accurate copy.
- Update acceptance docs accordingly.

Likely files:
- `apps/web/src/App.vue`
- `docs/page-function-acceptance.md`

Done when:
- The UI no longer promises destructive delete that does not exist.

### P1. Refresh the acceptance stack after product-scope cleanup

Status: open

Why:
- Current acceptance docs and screenshots still include now-excluded QR flows and older shell assumptions.

Main work:
- Re-record CDP screenshots for the current target page set.
- Rewrite acceptance tables to match the actual product scope.
- Remove obsolete evidence references.

Likely files:
- `docs/cdp-acceptance.md`
- `docs/cdp-acceptance-runbook.md`
- `docs/page-function-acceptance.md`
- `.artifacts/current-audit/`

Done when:
- Acceptance docs describe only in-scope pages and flows.
- Evidence files correspond to the current UI.

### P2. Decide what to do with purchases, voice, and attachments

Status: open

Why:
- These areas are currently shell-level or placeholder-level and need an explicit product decision.

Questions to resolve:
- Keep as shells for later?
- Remove until there is real backing behavior?
- Implement a narrower first version?

Likely files:
- `apps/web/src/App.vue`
- `docs/ai/20-pages-and-flows.md`
- `docs/ai/10-current-state.md`

Done when:
- Each area is either implemented, intentionally removed, or explicitly deferred with no misleading UI.

## Blockers And Caveats

- `thread:delete` is blocked by current Codex app-server capability.
- Subscription purchase and restore are still shell-level; do not mark them complete without real backing behavior.
- Historical source-audit docs still contain upstream QR/E2EE notes. Treat them as source reference, not current product target.
