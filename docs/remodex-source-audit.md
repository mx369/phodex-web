# Remodex Source Audit

This document is the source-driven inventory for the upstream iOS app at `/Users/young/mx/tmp/remodex`.
It is the canonical answer to three questions:

1. How many primary user-visible surfaces the upstream app has.
2. What each surface actually does according to source.
3. Which claims are backed by local screenshots versus code-only evidence.

This is not the implementation spec by itself. Phodex product overrides still apply:
- QR-code login and camera pairing are out of scope for Phodex.
- End-to-end encryption is out of scope for Phodex.

## Evidence Used

Source repos:
- `/Users/young/mx/tmp/remodex`
- `/Users/young/mx/tmp/remodex-xcode15`

Local upstream screenshots already on disk:
- `/Users/young/mx/tmp/remodex-xcode15/.artifacts/`

Important correction versus older notes:
- upstream screenshots do exist locally for onboarding, scanner, home, and settings
- this audit did not rely on a fresh simulator boot to make page claims

## Top-Level Page Count

The upstream app has 11 primary user-visible surfaces, plus one root router shell.

Root router shell:
- `ContentView.swift`
- chooses between onboarding, subscription failure, subscription gate, scanner, and main app
- also owns root-level overlays such as bridge update, deleted-thread recovery, and thread completion banner

Primary surfaces:
1. `OnboardingView`
2. `SubscriptionBootstrapFailureView`
3. `SubscriptionGateView`
4. `QRScannerView`
5. `HomeEmptyStateView`
6. `SidebarView`
7. `TurnView`
8. `SettingsView`
9. `ArchivedChatsView`
10. `RevenueCatPaywallView`
11. `AboutRemodexView`

## Root Routing

Primary source:
- `CodexMobile/CodexMobile/ContentView.swift`

State-driven route order in source:
1. `OnboardingView`
   Trigger: `hasSeenOnboarding == false`
2. `SubscriptionBootstrapFailureView`
   Trigger: subscription bootstrap failed and app access is unavailable
3. `SubscriptionGateView`
   Trigger: subscription access is unavailable
4. `QRScannerView`
   Trigger: onboarding complete but pairing / reconnect scanner still required
5. main app shell
   Trigger: onboarding complete, subscription valid, pairing complete

Root-level overlays attached here:
- `BridgeUpdateSheet`
- deleted-thread alert with “Start New Chat”
- `ThreadCompletionBannerView`

## Primary Surface Inventory

| Surface | Main source files | What the source implements | Upstream screenshot evidence | Relevance to Phodex |
| --- | --- | --- | --- | --- |
| Onboarding | `Views/Onboarding/OnboardingView.swift`, `OnboardingWelcomePage.swift`, `OnboardingFeaturesPage.swift`, `OnboardingStepPage.swift` | 5 pages: welcome hero, features, step 1 install Codex CLI, step 2 install bridge, step 3 start pairing; swipeable `TabView`; fixed bottom CTA; animated dots; install warning alert before continuing past CLI install | `onboarding.png`, `ui-onboarding.png` | Target page. Keep the 5-step mobile pacing, but final action routes to Email OTP instead of QR |
| Subscription bootstrap failure | `Views/Payments/SubscriptionBootstrapFailureView.swift` | failure shell when subscription bootstrap cannot determine access; retry plus recovery/legal affordances | none found locally | Target page. Behavior stays preview-only until real purchase state exists |
| Subscription gate | `Views/Payments/SubscriptionGateView.swift` | locked shell with hero copy, feature stack, plan UI, purchase CTA, restore purchases, legal/management links | no dedicated screenshot found locally | Target page. Preserve page structure, but keep purchases preview-only in Phodex |
| QR scanner | `Views/QRScannerView.swift`, `QRScannerPairingValidator.swift` | camera permission, live scanner frame, back action, validation, scan error handling, version mismatch recovery into bridge-update sheet | `scanner.png`, `scanner-2.png`, `scanner-3.png`, `scanner-4.png`, `scanner-final.png`, `scanner-final-2.png`, `scanner-final-3.png`, `scanner-final-5.png`, `ui-scanner.png` | Reference only. QR/camera logic is excluded, but the minimal pacing and focused auth shell still matter |
| Home empty | `Views/Home/HomeEmptyStateView.swift` | sparse home surface with centered logo, connection badge, trusted Mac summary, state-dependent primary CTA, reconnect/offline copy | `home.png`, `home-2.png`, `home-3.png`, `ui-home.png` | Target page. This is the source reference for our authenticated home-empty shell |
| Sidebar | `Views/SidebarView.swift`, `Views/Sidebar/*.swift` | searchable conversation list, project grouping, show-more caps, archive group, rename, archive toggle, delete, pull-to-refresh, floating settings button, connected-Mac footer, new-chat project picker | no dedicated screenshot found locally | Target page. We already have the shell, but source has deeper grouping and action behavior |
| Turn | `Views/Turn/TurnView.swift`, `TurnConversationContainerView.swift`, `TurnTimelineView.swift`, `TurnComposerView.swift`, `TurnToolbarContent.swift`, other `Views/Turn/*.swift` | full chat screen: timeline, streaming, tool/diff/subagent/system cards, empty states, pinned plan, structured-input replacement, queued drafts, attachments, voice, toolbar actions, worktree handoff, diff/status/path sheets | no dedicated screenshot found locally | Highest-value target page. Most remaining interaction parity work lives here |
| Settings | `Views/SettingsView.swift` | standalone settings stack with cards for Archived Chats, Appearance, Notifications, ChatGPT, Remodex Pro, Bridge Version, Runtime defaults, About, Usage, Connection | `settings.png`, `settings-2.png`, `ui-settings.png` | Target page. Page hierarchy and card structure matter more than pixel-perfect text |
| Archived chats | `Views/Sidebar/ArchivedChatsView.swift` | archived list screen with restore and destructive delete flow | no dedicated screenshot found locally | Target page, but Phodex intentionally omits permanent delete until backend support exists |
| Paywall | `Views/Payments/RevenueCatPaywallView.swift` and paywall entry points from settings/gate | full-screen purchase page with plans, CTA, restore/manage/legal | no dedicated screenshot found locally | Shell target only. Keep preview-only until real billing exists |
| About | `Views/AboutRemodexView.swift` | full-screen article page with Done/back behavior and long-form architecture sections | no dedicated screenshot found locally | Target page, but remove QR/E2EE claims from Phodex copy |

## Screenshot-Backed Visual Notes

These are direct observations from local upstream screenshots, not guesses from source:

- Onboarding:
  black background, large product wordmark, hero phones, page dots, large bottom CTA, small “Open source” pill.
- Home empty:
  almost no chrome, centered logo, compact status pill, “Not paired” copy, large single CTA.
- Scanner:
  black screen, one centered rounded scan frame, minimal instructional copy, very little additional chrome.
- Settings:
  large page title, roomy vertical spacing, pale card groups, native iOS-feeling section titles and rows.

## Secondary Surfaces And Overlays

The upstream app also has at least 12 secondary pages, sheets, or overlays that materially affect parity:

1. `BridgeUpdateSheet`
   copy-command, retry, scan-new-QR, dismiss
2. `ThreadCompletionBannerView`
   completion banner with tap/open and dismiss
3. sidebar new-chat project picker sheet
   choose project, choose worktree project, explain project scope
4. `TurnStatusSheet`
   run state, usage, rate-limit refresh
5. `TurnDiffSheet`
   diff totals and file-level drill-in
6. `AssistantRevertSheet`
   revert assistant-generated changes
7. `TurnThreadPathSheet`
   repo / workspace path details
8. `TurnWorktreeHandoffOverlay`
   worktree creation / handoff / fork flows
9. `GPTVoiceSetupSheet`
   prerequisites and recovery for voice transcription
10. `TurnImagePreview`
    fullscreen image preview with zoom/share/save
11. selectable-text / mermaid / command detail viewers
    secondary detail presentations for richer timeline content
12. pinned-plan sheet plus structured-prompt replacement composer
    accessory card can open a sheet and sometimes replace the composer itself

## Source-Confirmed Interaction Systems

### Turn timeline scrolling

Primary source:
- `Views/Turn/TurnScrollStateTracker.swift`
- `Views/Turn/TurnTimelineView.swift`
- `CodexMobileTests/TurnTimelineReducerTests.swift`

Confirmed behavior:
- auto-scroll is a 3-mode state machine:
  `followBottom`, `anchorAssistantResponse`, `manual`
- user drag immediately disarms follow-bottom unless the one-off assistant-anchor jump is still in progress
- “at bottom” is not zero-distance; source uses `bottomThreshold = 12`
- pinned-to-bottom correction uses `contentHeightCorrectionThreshold = 1`
- after user drag ends there is a `0.25s` cooldown before automatic scrolling can resume
- follow-bottom scrolls are coalesced to about one frame instead of forcing a jump on every streaming delta
- first-load recovery snap retries at `0ms`, `16ms`, `50ms`, and `100ms`
- floating “Scroll to latest” button appears whenever there are messages and the user is no longer at bottom
- large threads initially render only the tail slice of 40 rows and reveal “Load earlier messages” when scrolled up

Interpretation:
- the upstream app does not use a separate named hysteresis band
- the practical anti-jitter zone comes from the combination of `12pt` bottom threshold, `1pt` height correction, `250ms` cooldown, and 1-frame coalescing

### Empty timeline and running-empty behavior

Primary source:
- `Views/Turn/TurnTimelineView.swift`
- `Views/Turn/TurnConversationContainerView.swift`

Confirmed behavior:
- empty chats are kept static on purpose instead of rendering an inert scroll view
- a running-but-empty thread switches to a dedicated “Working on it… / You can stop it below” state
- if the timeline is empty but a pinned plan exists, the empty branch defers to the plan accessory rather than leaving a blank message area

### Composer and queued drafts

Primary source:
- `Views/Turn/QueuedDraftsPanel.swift`
- `Views/Turn/TurnComposerHostView.swift`
- `Views/Turn/TurnViewModel.swift`
- `Views/Turn/ComposerBottomBar.swift`
- `CodexMobileTests/TurnViewModelQueueTests.swift`

Confirmed behavior:
- queued drafts support `Restore`, `Steer`, and `Remove`
- `Steer` only appears while the active thread is busy
- restoring a queued draft is blocked when the composer already has meaningful content
- busy follow-ups default to queueing, not implicit steering
- failed queue flush can pause the queue and surface a “Resume queued messages” action
- tail controls are ordered `Voice -> Stop -> Send`
- send can carry a queue badge

### Toolbar and secondary controls

Primary source:
- `Views/Turn/TurnToolbarContent.swift`
- `Views/Turn/TurnComposerSecondaryBar.swift`
- `Views/Turn/TurnView.swift`

Confirmed behavior:
- toolbar subtitle is tappable and opens the thread path sheet
- repo diff totals are their own tappable pill
- thread actions live in a compact menu and include handoff/new-chat actions
- secondary composer bar hides on focus and otherwise exposes runtime picker, access mode, git branch selector, and status ring
- `/status` opens a formal status sheet instead of remaining plain chat text

## What This Means For Phodex

When comparing Phodex to source, treat the following as in-scope parity targets:
- page structure and route ordering
- sparse home/settings/sidebar/turn composition
- turn timeline state machine and secondary affordances
- queued-draft behavior, pinned-plan behavior, and toolbar behavior

Treat the following as source references only, not implementation targets:
- QR scanning and camera permissions
- QR-based bridge recovery
- end-to-end encryption copy

## Immediate Follow-On Work

The source-backed highest-value gap list is now:
1. turn running-empty / pinned-plan empty branching
2. queued draft steer / pause / resume semantics
3. toolbar secondary actions and thread-path / diff drill-ins
4. secondary composer bar parity
