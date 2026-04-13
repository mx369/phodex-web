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
