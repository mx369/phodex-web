# Standards And Rationale

This file explains why the AI context in this repo is organized the way it is. It is optional by design.

## Adopted Standards

- `llms.txt` pattern: a concise LLM-facing index with a short summary, curated links, and an `Optional` section for lower-priority reads.
- `AGENTS.md` pattern: a predictable repo-local instruction file, plus nested package-local `AGENTS.md` files so the nearest guide wins.
- Diataxis-style separation: short onboarding summary, broader state explanation, task-oriented page guide, technical reference, and verification reference are split by purpose instead of merged into one long memo.
- Prompt-template principle: keep fixed rules separate from task-variable state so reusable guidance stays short.
- Prompt hygiene principle: remove redundant or irrelevant instructions instead of repeating them across layers.

## Deliberate Adaptation

- `docs/ai/context-manifest.yaml` is not an external standard. It is a machine-readable project manifest inspired by resource indexing and progressive selection ideas. Its job is to let another AI decide what to read next without loading the full repository context.

## Why This Fits This Repo

- The repo mixes product status, UI truth, protocol truth, and acceptance evidence. If they are merged into one document, another AI will over-ingest context and lose the task boundary.
- The project is still incomplete, so the docs must distinguish real functionality from shell-level surfaces.
- Different agents need different local truth, so package guides and deeper references stay separate.

## How To Extend

- Add new task-local docs as deeper layers, not as extra material in `00-start-here.md`.
- Keep the first-read file under a few hundred tokens.
- Keep durable rules in the shallow layer and short-lived implementation details in deeper references.
- If a new package gets its own active work surface, add a nested `AGENTS.md` there and register it in `context-manifest.yaml`.
