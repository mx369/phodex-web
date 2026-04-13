# AGENTS.md

This repository uses progressive disclosure for AI context. Do not ingest every document by default.

## Read Order

1. Read `/Users/young/mx/tmp/phodex-web/docs/ai/00-start-here.md`.
2. Read `/Users/young/mx/tmp/phodex-web/docs/ai/context-manifest.yaml` only if you need task routing or deeper context.
3. Read the nearest subproject guide before editing code:
   - `/Users/young/mx/tmp/phodex-web/apps/web/AGENTS.md`
   - `/Users/young/mx/tmp/phodex-web/apps/server/AGENTS.md`
4. Pull in deeper docs only when required by the task.

## Current Mission

- The target is a source-driven recreation of the `remodex` mobile app behavior and UI, not a desktop web app with fake phone hardware chrome.
- Prefer code- and source-audit-driven reconstruction over copying marketing screenshots or device frames.
- The current build is partial. Real OTP auth, relay transport, and local Codex chat bridging work. Pixel parity and many app flows do not.

## Global Rules

- If another repo document conflicts with this file, follow this file.
- Use current code and current behavior as the baseline. Do not rely on stale plans or memory.
- Make the smallest change that actually solves the task.
- If a task changes architecture, commands, ownership, or acceptance flow, update the relevant AI docs in the same change.
- Do not bypass existing security or deployment boundaries unless the user explicitly asks.
- Every code change must be committed as its own intentional commit.

## Collaboration And Execution

- The main thread owns coordination, integration, and final acceptance.
- Split work into units with clear acceptance criteria when delegating.
- Do not delegate away final responsibility.
- In fix loops, reproduce first, fix second, verify third, and repeat until the real path passes.

## Visual And Interaction Work

- Use real running output first. Do not infer visual truth from static code alone.
- Do not add fake iPhone hardware, status bars, dynamic islands, or promo-shot framing unless the source app itself renders them.
- Prioritize work surfaces and interactions over decorative marketing composition.
- Empty states should explain the next action, not act like landing pages.

## Verification

- Prefer a stable verification order: build, targeted checks, then real flow validation.
- For UI changes, capture real browser output and compare against source-informed expectations.
- If something was not verified, say so explicitly.

## Deep Reads

- `/Users/young/mx/tmp/phodex-web/llms.txt`: cross-tool LLM index.
- `/Users/young/mx/tmp/phodex-web/docs/ai/10-current-state.md`: broader state and known gaps.
- `/Users/young/mx/tmp/phodex-web/docs/ai/20-pages-and-flows.md`: page matrix and feature status.
- `/Users/young/mx/tmp/phodex-web/docs/ai/30-architecture-and-interfaces.md`: technical interfaces and bridge behavior.
- `/Users/young/mx/tmp/phodex-web/docs/ai/40-verification-and-artifacts.md`: commands, artifacts, and acceptance references.
