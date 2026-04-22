# Bugfix Workflow

Use this workflow for UI/state-machine regressions, especially mobile polish, flicker, scroll, and permission issues.

## Default Order

1. Verify the bug exists before proposing a fix.
2. Prefer runtime evidence first:
   use Electron CDP, Computer Use, browser devtools, websocket logs, or server logs.
3. For transient issues such as flicker, auto-scroll loss, or disappearing cards, record a short video or frame sequence plus state logs.
   A single screenshot is not enough unless the issue is static.
4. If runtime capture is blocked, say what blocked it, then fall back to code analysis.
5. Search the repo first:
   inspect current code, nearby flows, and any prior acceptance artifacts.
6. Search official or primary sources next.
   Prefer vendor docs, MDN, framework docs, standards, and upstream issue trackers from the technology owner.
7. Only after those steps, fill gaps with engineering judgment.
8. Implement the smallest fix that resolves the verified failure.
9. Re-run the real flow and capture fresh evidence.
10. Summarize the result with links to code, logs, screenshots, and recordings.

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
