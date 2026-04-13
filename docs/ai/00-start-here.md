# Start Here

Use this file as the first read. Stop here unless the task clearly needs more.

## What This Repo Is

- Workspace: Bun monorepo with `apps/web`, `apps/server`, and `packages/shared`.
- Goal: recreate the `remodex` mobile app experience and behavior using Bun, Vite, Vue 3, and TypeScript.
- Constraint: reconstruction must be driven by the upstream app source and real behavior, not by marketing screenshots or fake device framing.

## What Is Real Today

- Email OTP sign-in is real.
- HTTPS + WSS relay is real.
- Local Codex app-server bridge is real.
- Chat thread creation, message send, streaming reply, stop, queue, resume draft, rename, and archive are real.

## What Is Not Done

- UI is not pixel-perfect.
- The app still uses a fixed-width web surface and sheet overlays, so it is not yet a true source-equal mobile page hierarchy.
- QR scanning, voice, purchases, restore purchase, and several source-app interactions are still shells or simulations.
- Message detail surfaces such as richer tool/run/file cards are not fully mapped from the upstream app yet.

## Task Router

- Editing `apps/web`: read `/Users/young/mx/tmp/phodex-web/apps/web/AGENTS.md` next.
- Editing `apps/server`: read `/Users/young/mx/tmp/phodex-web/apps/server/AGENTS.md` next.
- Doing planning, auditing, or handoff work: read `/Users/young/mx/tmp/phodex-web/docs/ai/10-current-state.md` next.

## Non-Negotiables

- Do not reintroduce fake phone hardware chrome.
- Prefer the smallest sufficient context load.
- Every code change must be committed intentionally.
- Verify real flows when changing UI or state machines.
