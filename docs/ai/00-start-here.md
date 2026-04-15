# Start Here

Use this file as the first read. Stop here unless the task clearly needs more.

Before doing any auth, onboarding, or security work, read `/Users/young/mx/tmp/phodex-web/docs/ai/05-product-decisions.md`.

## What This Repo Is

- Workspace: Bun monorepo with `apps/web`, `apps/server`, and `packages/shared`.
- Goal: recreate the `remodex` mobile app experience and behavior using Bun, Vite, Vue 3, and TypeScript.
- Constraint: reconstruction must be driven by the upstream app source and real behavior, not by marketing screenshots or fake device framing.
- Product overrides: no QR login, no camera pairing, no end-to-end encryption.

## What Is Real Today

- Email OTP sign-in is real.
- Public HTTP + WSS relay is real.
- Local outbound Codex app-server bridge is real.
- Chat thread creation, message send, streaming reply, stop, queue, resume draft, rename, and archive are real.

## What Is Not Done

- UI is not pixel-perfect.
- The full-page mobile shell is in place, but page-by-page parity is still incomplete.
- QR scanning is excluded, purchases stay preview-only, and several source-app interactions are still incomplete.
- Message detail surfaces such as richer tool/run/file cards are not fully mapped from the upstream app yet.

## Task Router

- Editing `apps/web`: read `/Users/young/mx/tmp/phodex-web/apps/web/AGENTS.md` next.
- Editing `apps/server`: read `/Users/young/mx/tmp/phodex-web/apps/server/AGENTS.md` next.
- Doing planning, auditing, or handoff work: read `/Users/young/mx/tmp/phodex-web/docs/ai/10-current-state.md` next.

## Non-Negotiables

- Do not reintroduce fake phone hardware chrome.
- Prefer the smallest sufficient context load.
- Every code change must be committed intentionally.
- Commit messages should be primarily in Chinese. Keep commands, paths, code symbols, and proper nouns in English when that is clearer.
- Verify real flows when changing UI or state machines.
