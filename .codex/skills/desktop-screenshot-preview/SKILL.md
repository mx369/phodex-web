---
name: desktop-screenshot-preview
description: Capture the current desktop or screen and preview the resulting image directly in the conversation. Use when the user asks for a desktop screenshot, system screenshot, current screen capture, or says to send/show/preview a screenshot in chat.
---

# Desktop Screenshot Preview

## Workflow

Use this skill for user-facing desktop screenshots. The expected outcome is both:

1. A saved screenshot file.
2. An inline preview in the conversation using the local image viewing tool.

Run the bundled helper from the repository root:

```bash
python3 .codex/skills/desktop-screenshot-preview/scripts/capture_desktop.py
```

The helper prints the screenshot path. After it succeeds, immediately call the local image preview tool on that path with original detail when available.

## Save Location

- If the user provides a path, pass it with `--path`.
- If the user does not provide a path, save to the macOS screenshot default directory when configured, otherwise `~/Desktop`.
- For agent-only inspection rather than user delivery, use a temporary path instead of this skill unless the user explicitly requested a desktop screenshot.

Examples:

```bash
python3 .codex/skills/desktop-screenshot-preview/scripts/capture_desktop.py --path ./tmp/screen.png
python3 .codex/skills/desktop-screenshot-preview/scripts/capture_desktop.py --region 100,200,800,600
```

## Validation

Treat the capture as failed unless the script exits with code 0 and prints a non-empty file path. If capture fails because of macOS Screen Recording permissions, report the permission issue and the failed command rather than inventing a screenshot.

Do not summarize the screenshot unless the user asks what is visible.
