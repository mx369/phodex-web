# Pages And Flows

This file is the UI and flow reference. Read it when you need page-level status instead of broad project status.

## Page Inventory

| Page | Current status | Real behavior today | Main gaps |
| --- | --- | --- | --- |
| Onboarding welcome/features/setup steps | Partial | Rendered, paged, swipeable, install warning modal exists, routes directly into Email OTP, and now uses the shared SVG icon language instead of unicode placeholder glyphs | Not pixel-perfect; copy/layout still approximate |
| Bootstrap failure | Shell | Rendered and navigable with preview-only subscription copy | No real purchase or restore flow |
| Subscription gate | Shell | Plan selection UI and navigation exist with preview-only purchase copy | No real purchase or restore flow |
| Email OTP | Real | Request code, verify code, and dev bypass all work; onboarding now lands here directly, and OTP delivery now uses live Resend when configured | Still a web-auth surface, not source-equal mobile UI |
| Home empty | Partial | Real connection state drives content inside the full-page mobile shell with source-closer header chips, trusted Mac card, and a brandless topbar that only shows the active page/thread title | Final spacing and disconnected-state parity still differ from upstream |
| Sidebar | Partial | Real threads render; select, rename, archive, create local/worktree chats through a real project-picker sheet, create fresh project folders from a folder name or full path, open about/settings from the shell drawer, and now sit on a tighter shared control-size / radius scale with a logo-only header | Refresh-style affordances and final source parity polish are still missing |
| Turn empty | Partial | Real selected thread, embedded empty-timeline block, backed composer with `Enter` send / `Shift+Enter` newline behavior, an immediate local "starting chat" state while `thread/start` resolves, a neutral idle send control that only promotes once text exists, and a backed model menu that now includes `Normal / Fast` speed selection with a live badge when `Fast` is active | Structured-input replacement state and final micro-spacing/polish are still missing |
| Turn with messages | Partial | Real streamed chat bridge, richer command/file/tool/system activity cards, a visible composer work-state band, source-informed internal timeline scrolling with a latest-jump button, normalized send/stop/latest-jump control scale with explicit idle/ready button states, a local pending-run placeholder that keeps the just-sent prompt visible before Codex echoes the first live item, floating error-only toasts instead of an inline run-complete banner, a backed `Fast` speed mode on the composer runtime menu, and a history fallback that restores thread diff chips plus file-change rows after turn completion when Codex `thread/read` omits tool items | Running-empty / pinned-plan-empty branches, queued steer/pause semantics, and toolbar/sheet affordances still differ from source |
| Settings | Partial | Real setting patches persist in a dedicated mobile page | Visual and information architecture parity still differ |
| Archived chats | Partial | Real archived list and restore render in a dedicated mobile page with restore-only copy | Permanent delete is intentionally absent; list behavior is simplified |
| About | Partial | Static explanatory content exists in a dedicated mobile page | Not a full upstream information architecture |
| Paywall | Shell | Plan selection UI exists in a dedicated mobile page with preview-only purchase controls | No RevenueCat or StoreKit behavior |

## Flow Inventory

| Flow | Status | Notes |
| --- | --- | --- |
| Onboarding -> Email OTP | Real | Fresh unauthenticated users now move from onboarding directly into the email verification screen |
| Email OTP login | Real | Uses `/api/auth/request-code`, `/api/auth/verify-code`, and optional `/api/auth/dev-code`; request-code now prefers live Resend delivery and falls back to the local mailbox only when mail config is unavailable |
| Relay bootstrap | Real | Snapshot load plus WSS session sync |
| New chat -> first send | Real | `New Chat` now swaps immediately into a local pending thread state while the bridge asks Codex to create the real thread; first send still creates the real thread and flushes the composer once it lands |
| Drawer create sheet | Real | Drawer `New Chat`, `New Worktree`, and project-group `+` now open a shared project-picker sheet so creation mode and target project are explicit before `thread:create` is sent; the custom-path affordance now stays above the project list, long project lists scroll inside the sheet, and the footer actions remain in view |
| Drawer worktree create | Real | Worktree creation now makes a real git worktree under `~/.codex/worktrees/<repo>/...` before starting the new Codex thread |
| Drawer custom project create | Real | The create sheet now accepts either a folder name or a full path: folder names create a fresh project under `~/.phodex-web/projects`, while absolute paths are used directly as the new local chat cwd |
| Streaming assistant reply | Real | Consumes Codex app-server streaming deltas |
| Turn auto-scroll and scroll-to-latest | Real | Turn scrolling now happens inside the fixed mobile shell rather than on `body`, with follow-bottom, assistant anchoring, resize-aware bottom recovery, bottom-threshold tolerance, and a visible latest-jump button when the user leaves bottom |
| Stop run | Real | Sends turn interrupt to local Codex |
| Runtime speed selection | Real | The composer model menu now exposes `Normal / Fast`; `Fast` requests `turn/start.serviceTier="fast"` and gracefully falls back when the bridge does not support that field yet |
| Queue while running | Real | Draft is stored locally, shown in queued list, and now keeps its send-time runtime settings so later resume stays aligned with the original request |
| Resume queued draft | Real | Replays queued text as a new turn using the queued draft's saved model/access/plan/fast runtime settings |
| Rich execution activity surfaces | Real | Turn timeline now shows structured command, file-change, tool, image, and subagent cards when the Codex app-server emits those item types, and selected-thread history sync now falls back to the Codex session JSONL so diff/file-change surfaces survive the `turn/completed -> thread/read` transition |
| Pinned plan accessory | Real | `/plan` turns now pin the latest assistant plan summary above the composer after the response lands |
| Rename thread | Real | Persists a local title override immediately and still attempts the Codex thread-name update when available |
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
- Do not reintroduce QR-pairing screens or encryption marketing because of the original app.
- Treat the current shell as a full-page mobile surface, not a centered faux-device card.
- If you change shared controls, color roles, font scale, radius scale, or icon language, update `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md` in the same change.
- If changing page structure, update this file and the screenshot evidence when the behavior changes.

## Deep References

- `/Users/young/mx/tmp/phodex-web/docs/remodex-source-audit.md`
- `/Users/young/mx/tmp/phodex-web/docs/remodex-page-matrix.md`
- `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`
