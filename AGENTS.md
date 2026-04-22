# AGENTS.md

Use progressive disclosure for AI context. Read only the smallest set of docs needed for the task.

## Read Order

1. Read `/Users/young/mx/tmp/phodex-web/docs/ai/00-start-here.md`.
2. Read `/Users/young/mx/tmp/phodex-web/docs/ai/05-product-decisions.md`.
3. Read the nearest subproject guide before editing code:
   - `/Users/young/mx/tmp/phodex-web/apps/web/AGENTS.md`
   - `/Users/young/mx/tmp/phodex-web/apps/server/AGENTS.md`
4. Read `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md` when verifying work.
5. Read `/Users/young/mx/tmp/phodex-web/docs/ai/context-manifest.yaml` only if you need deeper routing.

## Repo Truth

- The target is a source-driven recreation of the `remodex` mobile app behavior and UI, not a desktop web app with fake phone hardware chrome.
- The build is still partial. Real email OTP, relay transport, and local Codex chat bridging work; source parity does not.
- Excluded scope: QR/camera pairing and end-to-end encryption.

## Working Rules

- If another repo document conflicts with this file, follow this file.
- Use current code and current behavior as the baseline. Do not rely on stale plans or memory.
- When the user asks to add or revise standing AI rules, first condense them into the smallest durable, non-redundant version before writing them into repo docs.
- Prefer the smallest, simplest change with the smallest diff that actually solves the task.
  Smallest diff means narrow scope and normal readable code, not code golf, one-letter names, or collapsing code into one line.
- If a task changes architecture, commands, ownership, page truth, or acceptance flow, update the relevant AI docs in the same commit.
- Do not bypass existing security or deployment boundaries unless the user explicitly asks.
- Commit each intentional change separately.
- Commit messages should be primarily in Chinese. Keep commands, paths, code symbols, and proper nouns in English when that is clearer.

## Execution

- The main thread owns coordination, integration, and final acceptance.
- Delegate in small units with clear acceptance criteria.
- Delegation does not transfer final responsibility.
- In fix loops: reproduce, fix, verify.
- Use real running output for UI work. Do not infer visual truth from static code alone.
- Do not add fake iPhone hardware, status bars, dynamic islands, or promo-shot framing unless the source app itself renders them.
- Prioritize work surfaces and interactions over decorative marketing composition.
- Empty states should explain the next action, not act like landing pages.

## Verification

- Default order: build, targeted checks, then real-flow validation.
- Real OTP acceptance must send a real email and fetch the code through a mailbox-reading skill. If that path is unavailable, report the verification gap instead of faking success.
- If something was not verified, say so explicitly.

## Deep Reads

- `/Users/young/mx/tmp/phodex-web/llms.txt`
- `/Users/young/mx/tmp/phodex-web/docs/ai/10-current-state.md`
- `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`
- `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`
- `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`
- `/Users/young/mx/tmp/phodex-web/docs/ai/50-open-todo.md`
