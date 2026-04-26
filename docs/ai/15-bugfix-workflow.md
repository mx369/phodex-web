# Bugfix Workflow

Use this workflow for UI/state-machine regressions, especially mobile polish, flicker, scroll, and permission issues.

## Default Order

1. Create a dedicated Git worktree for the bugfix before editing code.
2. Verify the bug exists before proposing a fix.
3. Prefer runtime evidence first:
   use Electron CDP, Computer Use, browser devtools, websocket logs, or server logs.
4. For transient issues such as flicker, auto-scroll loss, or disappearing cards, record a short video or frame sequence plus state logs.
   A single screenshot is not enough unless the issue is static.
5. If runtime capture is blocked, say what blocked it, then fall back to code analysis.
6. Search the repo first:
   inspect current code, nearby flows, and any prior acceptance artifacts.
7. Search official or primary sources next.
   Prefer vendor docs, MDN, framework docs, standards, and upstream issue trackers from the technology owner.
8. Only after those steps, fill gaps with engineering judgment.
9. Implement the smallest fix that resolves the verified failure.
10. Re-run the real flow and capture fresh evidence.
11. Merge the verified fix back into the main worktree, then remove the temporary worktree.
12. Summarize the result with links to code, logs, screenshots, and recordings.

## Worktree Discipline

- Before creating a bugfix worktree, confirm the main worktree is clean with `git status --short --branch`.
- Create bugfix worktrees from the current main HEAD with a unique branch and sibling path, for example:
  `git worktree add -b bugfix/<topic> ../phodex-web-bugfix-<topic>`.
- If verification in a temporary worktree requires `bun install`, run Bun with an explicit PATH on this Mac:
  `PATH=/Users/young/.bun/bin:$PATH /Users/young/.bun/bin/bun install`.
- After `bun install`, check for accidental mode-only changes. If `packages/bridge-installer/bin/phodex-bridge.js` flips from `100644` to `100755`, restore it with:
  `chmod 644 packages/bridge-installer/bin/phodex-bridge.js`.
- Commit only source/doc changes that belong to the fix. Do not commit `node_modules`, build output, ignored artifacts, or mode-only installer changes.
- Fresh evidence under `.artifacts/current-audit/` is ignored by Git. Copy the relevant evidence directory from the temporary worktree back to the main worktree before removing the worktree.
- Before merging back, confirm both worktrees are clean. Try `git merge --ff-only bugfix/<topic>` from main first.
- If fast-forward merge fails because main advanced while the bugfix worktree was active, inspect `git log --oneline --graph --decorate --max-count=12 --all`; then use a normal merge from main if the histories are expected and conflicts are absent. Do not treat the failed fast-forward as a missing branch or lost work.
- After the merge and final verification in main, remove the temporary worktree with `git worktree remove ../phodex-web-bugfix-<topic>` and delete the bugfix branch.

## Evidence Rules

- Keep issue checklists explicit:
  `reported`, `verified`, `fixed`, `retested`, `blocked`.
- Store fresh artifacts under `/Users/young/mx/tmp/phodex-web/.artifacts/current-audit/`.
- For action flows, capture both:
  the triggering step and the resulting UI or log change.
- For mobile interaction bugs, prefer:
  runtime screenshots plus a short mp4 or ordered frame set.
- For websocket or state-machine bugs, add a timestamped text log when possible.

## Search Order

1. Repo search with `rg`, nearby components, and server/client protocol handlers.
2. Existing project docs and acceptance artifacts.
3. Official docs and primary references on the web.
4. Own experience only for the remaining gaps.

## Delegation Rules

- Break reports into a flat checklist of independent problems.
- Delegate bounded subtasks with:
  reproduction target, suspected files, and acceptance criteria.
- Keep write ownership disjoint when multiple agents edit in parallel.
- The main thread owns integration, real-flow validation, and final acceptance.

## Acceptance Standard

- Build first, then targeted checks, then the real runtime path.
- If the bug is visual or timing-sensitive, attach fresh runtime evidence.
- If any part could not be verified, state the exact gap instead of claiming success.
