# Pages And Flows

This file is the UI and flow reference. Read it when you need page-level status instead of broad project status.

## Page Inventory

| Page | Current status | Real behavior today | Main gaps |
| --- | --- | --- | --- |
| Onboarding welcome/features/setup steps | Partial | Rendered, paged, swipeable, install warning modal exists | Not pixel-perfect; copy/layout still approximate |
| Bootstrap failure | Shell | Rendered and navigable | Subscription restore is not real |
| Subscription gate | Shell | Plan selection UI and navigation exist | No real purchase or restore flow |
| Camera permission | Shell | Rendered and routed | No real platform permission bridge |
| QR scanner | Shell | Rendered and routed | No real camera or QR decode |
| Scan error | Shell | Rendered and routed | Driven by simulated error paths |
| Bridge recovery | Shell | Rendered and routed | Copy command is local UI, not full upstream recovery flow |
| Email OTP | Real | Request code, verify code, dev bypass all work | Still a web-auth surface, not source-equal mobile UI |
| Home empty | Partial | Real connection state drives content | Layout still differs from upstream |
| Sidebar | Partial | Real threads render; select, rename, archive, create work | Layout and interaction details still diverge |
| Turn empty | Partial | Real selected thread and composer | Not source-equal visually |
| Turn with messages | Partial | Real streamed chat bridge | Richer upstream message/tool surfaces still missing |
| Settings | Partial | Real setting patches persist | Still an overlay sheet, not source-equal navigation |
| Archived chats | Partial | Real archived list and restore | Delete is not real; list behavior is simplified |
| About | Partial | Static explanatory content exists | Not a full upstream information architecture |
| Paywall | Shell | Plan selection UI exists | No RevenueCat or StoreKit behavior |

## Flow Inventory

| Flow | Status | Notes |
| --- | --- | --- |
| Email OTP login | Real | Uses `/api/auth/request-code`, `/api/auth/verify-code`, and optional `/api/auth/dev-code` |
| Relay bootstrap | Real | Snapshot load plus WSS session sync |
| New chat -> first send | Real | First send creates a thread and flushes the composer |
| Streaming assistant reply | Real | Consumes Codex app-server streaming deltas |
| Stop run | Real | Sends turn interrupt to local Codex |
| Queue while running | Real | Draft is stored locally and shown in queued list |
| Resume queued draft | Real | Replays queued text as a new turn |
| Rename thread | Real | Uses Codex thread name update |
| Archive thread | Real | Uses Codex archive/unarchive |
| Delete thread | Not real | UI exists but server returns archive-only guidance |
| Purchase / restore purchase | Not real | UI shells only |
| QR pair from camera | Not real | Simulated pages only |

## UI-Specific Warnings

- Do not copy the App Store or marketing device frame. Rebuild the app content inside the screenshots, not the screenshot chrome.
- Do not add fake status bars or dynamic islands.
- If changing page structure, update this file and the screenshot evidence when the behavior changes.

## Deep References

- `/Users/young/mx/tmp/phodex-web/docs/remodex-source-audit.md`
- `/Users/young/mx/tmp/phodex-web/docs/remodex-page-matrix.md`
