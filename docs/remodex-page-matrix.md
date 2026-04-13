# Remodex Page Matrix

This matrix maps upstream source truth to the current Phodex Web build.
Unlike older versions, it now separates:
- source parity targets we should actively close
- upstream-only features that are now out of scope for Phodex

Legend:
- `done`: implemented and verified in the current web app
- `partial`: implemented, but still materially different from upstream
- `missing`: not implemented in current web
- `out-of-scope`: upstream exists, but product overrides exclude it

## Primary Surfaces

| Upstream surface | Source truth | Current web status | Gap to close next |
| --- | --- | --- | --- |
| `OnboardingView` | 5-page mobile flow with hero, features, 3 setup steps, fixed CTA, install reminder alert | `partial` | page structure exists, but visual pacing and some copy/spacing still differ |
| `SubscriptionBootstrapFailureView` | locked error shell with retry/recovery/legal affordances | `partial` | keep the shell but tighten hierarchy and recovery affordances |
| `SubscriptionGateView` | full-page gate with feature stack, plan choice, CTA, restore/manage/legal | `partial` | keep preview-only purchases, but move closer to source card hierarchy |
| `QRScannerView` | live camera scanner and QR recovery flow | `out-of-scope` | use only as reference for auth-shell sparseness; do not implement QR/camera |
| `HomeEmptyStateView` | sparse connected/offline home with trusted Mac summary and CTA swaps | `partial` | disconnected/connecting variants and final spacing still differ |
| `SidebarView` | searchable project-grouped conversation tree with rename/archive/delete/project picker | `partial` | grouping behavior, project picker, refresh affordances, and thread-row actions are still simplified |
| `TurnView` | timeline, toolbar, pinned plan, structured prompts, queued drafts, scroll state machine, tool cards, sheets | `partial` | richer surfaces landed, but scroll behavior and several secondary actions are still missing |
| `SettingsView` | standalone settings stack with many cards and linked subpages | `partial` | current page exists but still lacks source card depth and some linked behaviors |
| `ArchivedChatsView` | archived list, restore, delete | `partial` | restore exists; destructive delete remains intentionally unavailable |
| `RevenueCatPaywallView` | full-screen paywall page | `partial` | preview-only page exists, but source hierarchy is still simplified |
| `AboutRemodexView` | long-form about page in a dedicated stack | `partial` | dedicated page exists, but source information architecture is still reduced |

## Root And Overlay Surfaces

| Upstream surface | Source truth | Current web status | Gap to close next |
| --- | --- | --- | --- |
| root router in `ContentView.swift` | onboarding -> subscription failure -> gate -> scanner -> main app | `partial` | Phodex correctly replaces scanner with Email OTP, but root auth shell can still move closer to source pacing |
| `BridgeUpdateSheet` | update instructions, copy command, retry, scan-new-QR | `out-of-scope` | QR recovery is excluded; only generic bridge-recovery ideas matter |
| deleted-thread alert | alert with start-new-chat recovery | `missing` | add if backend/state model can expose the deleted-thread recovery prompt |
| thread completion banner | top completion banner | `done` | keep validated |

## Turn Interaction Matrix

| Upstream interaction | Source truth | Current web status | Priority |
| --- | --- | --- | --- |
| auto-scroll state machine | `followBottom` / `anchorAssistantResponse` / `manual` modes | `done` | closed |
| bottom threshold + anti-jitter behavior | `12pt` bottom threshold, `1pt` correction threshold, `250ms` cooldown, coalesced follow scrolls | `done` | closed |
| scroll-to-latest affordance | floating button when not at bottom | `done` | closed |
| initial scroll recovery | multi-pass recovery snap on thread change | `done` | closed |
| large-thread tail rendering | render last 40 rows first, then “Load earlier messages” | `missing` | P2 |
| empty timeline static mode | empty chats avoid inert scrolling | `partial` | empty card exists, but scroll behavior is still generic |
| running-empty state | “Working on it… / You can stop it below” while a thread is running but still empty | `missing` | P1 |
| pinned-plan empty fallback | empty timeline defers to plan accessory when a pinned plan exists | `missing` | P1 |
| pinned plan accessory | compact accessory above composer, sheet-backed | `partial` | summary band exists, but no drill-in sheet or structured replacement behavior |
| structured-input replacement | active structured prompts can replace composer | `missing` | P2 |
| queued draft restore/steer/remove | `Restore`, `Steer`, `Remove`; busy-state aware | `partial` | `Resume` and `Remove` exist; `Steer` is missing |
| queued pause/resume semantics | failed flush pauses queue and exposes resume action | `missing` | P2 |
| toolbar path sheet | subtitle opens thread path | `missing` | P2 |
| diff pill drill-in | toolbar diff opens diff sheet | `missing` | P2 |
| thread actions menu | handoff/new-chat actions grouped in toolbar menu | `partial` | we still use simplified standalone buttons |
| composer secondary bar | runtime picker, access mode, git branch selector, status ring | `partial` | only minimal local/access/branch pills exist |
| `/status` behavior | opens formal status sheet | `missing` | P2 |

## Current Serial Execution Order

1. running-empty and pinned-plan-empty branching
2. queued draft steer / pause / resume semantics
3. toolbar path / diff / thread-actions affordances
4. secondary composer bar parity

## Evidence Pointers

Upstream screenshot-backed pages:
- onboarding: `onboarding.png`, `ui-onboarding.png`
- scanner: `scanner*.png`, `ui-scanner.png`
- home: `home*.png`, `ui-home.png`
- settings: `settings*.png`, `ui-settings.png`

Current web evidence:
- see `/Users/young/mx/tmp/phodex-web/docs/page-function-acceptance.md`
- see `/Users/young/mx/tmp/phodex-web/docs/cdp-acceptance.md`
