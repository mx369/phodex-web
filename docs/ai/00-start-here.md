# Start Here

Use this as the first read. Stop here unless the task clearly needs a package guide or deeper doc.

## What This Repo Is

- Workspace: Bun monorepo with `apps/web`, `apps/server`, and `packages/shared`.
- Goal: recreate the `remodex` mobile app experience and behavior using Bun, Vite, Vue 3, and TypeScript.
- Constraint: source-driven mobile reconstruction, not marketing screenshots or fake device framing.
- Product overrides: no QR login, camera pairing, or end-to-end encryption.

## What Is Real Today

- Email OTP sign-in is real.
- The operator may refer to the configured OTP mail sender as `Email Scale`; in this repo that means the existing Resend-backed delivery path, not a missing future integration.
- Public HTTP + WSS relay is real.
- Local outbound Codex app-server bridge is real.
- Chat thread creation, message send, streaming reply, stop, queue, resume draft, rename, and archive are real.

## What Is Not Done

- UI parity, purchases, richer turn/tool surfaces, and several source-app interactions remain partial.

## Task Router

- Editing `apps/web`: read `/Users/young/mx/tmp/phodex-web/apps/web/AGENTS.md`.
- Editing `apps/server`: read `/Users/young/mx/tmp/phodex-web/apps/server/AGENTS.md`.
- Auth, onboarding, security, or product-scope changes: read `/Users/young/mx/tmp/phodex-web/docs/ai/05-product-decisions.md`.
- Doing planning, auditing, or handoff work: read `/Users/young/mx/tmp/phodex-web/docs/ai/10-current-state.md` next.
- Doing bug reproduction or state-machine polish: read `/Users/young/mx/tmp/phodex-web/docs/ai/15-bugfix-workflow.md` next.

## Non-Negotiables

- Keep context loads minimal.
- Do not add fake phone hardware chrome.
- Commit intentional changes with primarily Chinese messages.
- Verify real flows when UI/state-machine risk justifies it.
