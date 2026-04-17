# Pages And Flows

This file is the UI and flow reference. Read it when you need page-level status instead of broad project status.

## Page Inventory

| Page | Current status | Real behavior today | Main gaps |
| --- | --- | --- | --- |
| Onboarding welcome/features/setup steps | Partial | Rendered, paged, swipeable, and routes into Email OTP; the final setup step now shows the real one-command `bunx` bridge installer for the current relay origin, including a short-lived setup token instead of a raw bridge secret | Copy, layout, and parity still approximate |
| Bootstrap failure | Shell | Rendered and navigable | No real purchase or restore flow |
| Subscription gate | Shell | Plan selection and navigation exist | No real purchase or restore flow |
| Email OTP | Real | Request-code and verify-code are live; OTP uses real mail delivery when configured | UI is still approximate |
| Home empty | Partial | Real connection state drives the full-page mobile shell | Final spacing and disconnected-state parity still differ |
| Sidebar | Partial | Real thread list, select, rename, archive, and project-targeted local/worktree create | Drawer polish and parity details still differ |
| Turn empty | Partial | Real selected thread, empty timeline block, composer, pending-thread state, and `Normal / Fast` runtime toggle | Structured-input replacement and final polish are still missing |
| Turn with messages | Partial | Real streaming, richer tool/file/system cards, latest-jump, pending-run placeholder, queued drafts, and pinned plan | Some empty branches, queue states, and toolbar/sheet parity still differ |
| Settings | Partial | Real setting patches persist in a dedicated page | Visual and IA parity still differ |
| Archived chats | Partial | Real archived list and restore | Permanent delete is intentionally absent; list behavior is simplified |
| About | Partial | Dedicated informational page exists | Still simplified versus upstream |
| Paywall | Shell | Preview-only paywall page exists | No real billing flow |

## Flow Inventory

| Flow | Status | Notes |
| --- | --- | --- |
| Onboarding -> Email OTP | Real | Fresh unauthenticated users move from onboarding into Email OTP; onboarding now uses a single real `bunx` command that installs the local bridge, claims a short-lived setup token, writes local relay config, and starts the bridge |
| Email OTP login | Real | Uses `/api/auth/request-code` and `/api/auth/verify-code`; request-code requires configured live email delivery and no longer exposes any local bypass path |
| Relay bootstrap | Real | Snapshot load plus WSS session sync |
| New chat -> first send | Real | Local pending thread state appears immediately, then resolves to the real Codex thread |
| Drawer create sheet | Real | Creation mode and target project are chosen before `thread:create` is sent |
| Drawer worktree create | Real | Creates a real git worktree under `~/.codex/worktrees/<repo>/...` before starting the thread |
| Drawer custom project create | Real | Accepts either a folder name or a full path for the new local chat cwd |
| Streaming assistant reply | Real | Consumes Codex app-server streaming deltas |
| Turn auto-scroll and scroll-to-latest | Real | Uses internal shell scrolling with a latest-jump button when the user leaves bottom |
| Stop run | Real | Sends turn interrupt to local Codex |
| Runtime speed selection | Real | Exposes `Normal / Fast`; `Fast` falls back when the bridge cannot accept the fast tier field |
| Queue while running | Real | Stores the draft locally and preserves its runtime settings |
| Resume queued draft | Real | Replays the queued text with its saved runtime settings |
| Rich execution activity surfaces | Real | Shows structured command, file, tool, image, and subagent cards; history also backfills missing diff/file rows |
| Pinned plan accessory | Real | Latest `/plan` summary can pin above the composer |
| Rename thread | Real | Applies a local title override immediately and best-effort syncs to Codex |
| Archive thread | Real | Uses Codex archive/unarchive |
| Delete thread | Unavailable | UI intentionally omits permanent delete because the backend cannot support it |
| Purchase / restore purchase | Preview only | UI shells only; no transaction or restore behavior is wired |

## Excluded Scope

- QR-code login and camera pairing are out of scope.
- End-to-end encryption is out of scope.
- If old source-audit docs mention QR login or E2EE, treat them as upstream reference only, not as implementation targets.

## UI-Specific Warnings

- Do not copy the App Store or marketing device frame. Rebuild the app content inside the screenshots, not the screenshot chrome.
- Do not add fake status bars or dynamic islands.
- Treat the current shell as a full-page mobile surface, not a centered faux-device card.
- If you change shared controls, color roles, font scale, radius scale, or icon language, update `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md` in the same change.
- If changing page structure, update this file and the screenshot evidence when the behavior changes.

## Deep References

- `/Users/young/mx/tmp/phodex-web/docs/remodex-source-audit.md`
- `/Users/young/mx/tmp/phodex-web/docs/remodex-page-matrix.md`
- `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`
