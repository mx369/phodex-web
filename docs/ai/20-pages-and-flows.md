# Pages And Flows

This file is the UI and flow reference. Read it when you need page-level status instead of broad project status.

## Page Inventory

| Page | Current status | Real behavior today | Main gaps |
| --- | --- | --- | --- |
| Onboarding welcome/features/setup steps | Partial | Rendered, paged, swipeable, install warning modal exists, and now routes directly into Email OTP | Not pixel-perfect; copy/layout still approximate |
| Bootstrap failure | Shell | Rendered and navigable with preview-only subscription copy | No real purchase or restore flow |
| Subscription gate | Shell | Plan selection UI and navigation exist with preview-only purchase copy | No real purchase or restore flow |
| Email OTP | Real | Request code, verify code, and dev bypass all work; onboarding now lands here directly, and OTP delivery now uses live Resend when configured | Still a web-auth surface, not source-equal mobile UI |
| Home empty | Partial | Real connection state drives content inside the full-page mobile shell with source-closer header chips and trusted Mac card | Final spacing and disconnected-state parity still differ from upstream |
| Sidebar | Partial | Real threads render; select, rename, archive, create local/worktree chats, and open about/settings from the shell drawer | Project picker sheet and refresh-style affordances are still missing |
| Turn empty | Partial | Real selected thread, embedded empty-timeline block, backed composer, and an immediate local "starting chat" state while `thread/start` resolves | Structured-input replacement state and final micro-spacing/polish are still missing |
| Turn with messages | Partial | Real streamed chat bridge, richer command/file/tool/system activity cards, a visible composer work-state band, and source-informed internal timeline scrolling with a latest-jump button | Running-empty / pinned-plan-empty branches, queued steer/pause semantics, and toolbar/sheet affordances still differ from source |
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
| Streaming assistant reply | Real | Consumes Codex app-server streaming deltas |
| Turn auto-scroll and scroll-to-latest | Real | Turn scrolling now happens inside the fixed mobile shell rather than on `body`, with follow-bottom, assistant anchoring, bottom-threshold tolerance, and a visible latest-jump button when the user leaves bottom |
| Stop run | Real | Sends turn interrupt to local Codex |
| Queue while running | Real | Draft is stored locally and shown in queued list |
| Resume queued draft | Real | Replays queued text as a new turn |
| Rich execution activity surfaces | Real | Turn timeline now shows structured command, file-change, tool, image, and subagent cards when the Codex app-server emits those item types |
| Pinned plan accessory | Real | `/plan` turns now pin the latest assistant plan summary above the composer after the response lands |
| Rename thread | Real | Uses Codex thread name update |
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
- If changing page structure, update this file and the screenshot evidence when the behavior changes.

## Deep References

- `/Users/young/mx/tmp/phodex-web/docs/remodex-source-audit.md`
- `/Users/young/mx/tmp/phodex-web/docs/remodex-page-matrix.md`
