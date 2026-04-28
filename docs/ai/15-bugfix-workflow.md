# Bugfix Workflow

Use this workflow for UI/state-machine regressions, especially mobile polish, flicker, scroll, and permission issues.

## Default Order

1. Inspect current repo changes before editing files and identify the likely target files.
2. Use the current worktree if those files do not conflict with existing changes; create a dedicated Git worktree only when the existing changes overlap or make the fix unsafe to isolate.
3. Verify the bug exists before proposing a fix.
4. Prefer runtime evidence first:
   use Electron CDP, Computer Use, browser devtools, websocket logs, or server logs.
5. For transient issues such as flicker, auto-scroll loss, or disappearing cards, record a short video or frame sequence plus state logs.
   A single screenshot is not enough unless the issue is static.
6. If runtime capture is blocked, say what blocked it, then fall back to code analysis.
7. Search the repo first:
   inspect current code, nearby flows, and any prior acceptance artifacts.
8. Search official or primary sources next.
   Prefer vendor docs, MDN, framework docs, standards, and upstream issue trackers from the technology owner.
9. Only after those steps, fill gaps with engineering judgment.
10. Implement the smallest fix that resolves the verified failure.
11. Re-run the real flow and capture fresh evidence.
12. If a temporary worktree was used, merge the verified fix back into the main worktree, then remove the temporary worktree.
13. Summarize the result with links to code, logs, screenshots, and recordings.

## Worktree Discipline

- Before editing, run `git status --short --branch` and inspect any modified files that may overlap the task.
- If the target files are clean or existing changes are clearly unrelated, work in the current worktree.
- If target files already contain unrelated edits, generated churn, or changes that would make the fix hard to isolate, create a dedicated worktree before editing.
- Create temporary worktrees from the current main HEAD with a unique branch and sibling path, for example:
  `git worktree add -b bugfix/<topic> ../phodex-web-bugfix-<topic>`.
- A fresh Git worktree does not share `node_modules`. Do not run `bun run build:web` there before bootstrapping dependencies.
- Bootstrap temporary worktrees with Bun's absolute path and an explicit PATH on this Mac:
  `PATH=/Users/young/.bun/bin:$PATH /Users/young/.bun/bin/bun install`.
- Run builds in temporary worktrees with the same explicit PATH:
  `PATH=/Users/young/.bun/bin:$PATH /Users/young/.bun/bin/bun run build:web`.
- Treat `bun: command not found` from nested package scripts and `vue-tsc: command not found` as setup failures in a fresh worktree, not as product-code failures.
- After `bun install`, check for accidental mode-only changes. If `packages/bridge-installer/bin/phodex-bridge.js` flips from `100644` to `100755`, restore it with:
  `chmod 644 packages/bridge-installer/bin/phodex-bridge.js`.
- Commit only source/doc changes that belong to the fix. Do not commit `node_modules`, build output, ignored artifacts, or mode-only installer changes.
- Fresh evidence under `.artifacts/current-audit/` is ignored by Git. Copy the relevant evidence directory from the temporary worktree back to the main worktree before removing the worktree.
- Before merging back from a temporary worktree, confirm both worktrees are clean. Try `git merge --ff-only bugfix/<topic>` from main first.
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
