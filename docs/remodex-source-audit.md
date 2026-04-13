# Remodex Source Audit

This document is the source-driven page and feature audit for `/Users/young/mx/tmp/remodex`.
It is based on the SwiftUI entry flow and the concrete view files in the iOS app.

## Root Flow

Source:
- `CodexMobileApp.swift`
- `ContentView.swift`

State-driven root routing in the iOS app:

1. `OnboardingView`
   Trigger:
   `hasSeenOnboarding == false`
2. `SubscriptionBootstrapFailureView`
   Trigger:
   subscription bootstrap failed and app access is unavailable
3. `SubscriptionGateView`
   Trigger:
   subscription access is unavailable
4. `QRScannerView`
   Trigger:
   onboarding is complete and pairing / reconnect scanner is required
5. `mainAppBody`
   Trigger:
   onboarding complete, subscription valid, pairing complete

Global overlays attached at the root:
- `BridgeUpdateSheet`
- deleted-thread alert
- thread completion banner

## Primary Pages

### 1. Onboarding

Source:
- `Views/Onboarding/OnboardingView.swift`
- `OnboardingWelcomePage.swift`
- `OnboardingFeaturesPage.swift`
- `OnboardingStepPage.swift`

Implemented pages in source:
- Welcome hero page
- Features page
- Step 1: install Codex CLI
- Step 2: install bridge
- Step 3: start pairing

Core behaviors:
- swipeable `TabView`
- fixed bottom bar
- animated page dots
- CTA title changes by page
- install warning alert before advancing past Codex CLI step
- final CTA enters pairing flow

### 2. Pairing / Scanner

Source:
- `Views/QRScannerView.swift`
- `Views/QRScannerPairingValidator.swift`

Core behaviors:
- camera permission flow
- live QR scanner
- back button on top safe area
- bridge-update interstitial when QR payload and app / bridge version mismatch
- copy command CTA for bridge update
- scan error alert

Note for this remake:
- product requirement changed to email OTP instead of QR pairing
- visual structure still needs to borrow from the source pairing flow
- QR-specific transport logic should be replaced with email verification UI and local backdoor

### 3. Home Empty State

Source:
- `Views/Home/HomeEmptyStateView.swift`

Core behaviors:
- logo centered
- live connection badge
- trusted Mac summary
- status text and error text
- primary CTA changes by connection phase
- secondary auth actions when reconnect candidate exists

### 4. Sidebar

Source:
- `Views/SidebarView.swift`
- `Views/Sidebar/*.swift`

Core behaviors:
- searchable chat list
- grouped threads by project
- new local chat
- new worktree chat
- refreshable list
- thread rename
- archive toggle
- delete thread
- archive whole project group
- settings floating button
- connected Mac status chip
- project picker sheet for new chat

### 5. Turn View

Source:
- `Views/Turn/TurnView.swift`
- `TurnConversationContainerView.swift`
- `TurnComposerView.swift`
- `TurnMessageComponents.swift`
- companion files in `Views/Turn`

Core behaviors:
- timeline with assistant / user / system messages
- markdown rendering
- code blocks
- diff blocks and diff sheet
- command execution cards
- plan mode cards
- structured user input cards
- subagent cards
- assistant revert flow
- pinned plan accessory above composer
- composer replacement for structured prompts
- empty timeline states
- composer with queue / stop / send logic
- file mentions
- skill mentions
- slash command autocomplete
- file autocomplete
- queued drafts panel
- attachment previews
- image intake from camera and photos picker
- voice recording capsule and voice setup sheet
- status sheet
- toolbar with repo diff, branch, worktree handoff, git actions, mac handoff, new sibling chat
- worktree handoff overlays
- approval alerts and git alerts

### 6. Settings

Source:
- `Views/SettingsView.swift`

Sections in source:
- Archived Chats
- Appearance
- Notifications
- ChatGPT
- Remodex Pro
- Bridge Version
- Runtime defaults
- About
- Usage
- Connection

Related pages / sheets:
- `ArchivedChatsView`
- `RevenueCatPaywallView`
- `GPTVoiceSetupSheet`
- `AboutRemodexView`
- Mac rename sheet

### 7. About

Source:
- `Views/AboutRemodexView.swift`

Core behaviors:
- full-screen article style page
- navigation stack with Done button
- sections:
  - header
  - how it works
  - architecture
  - relay
  - codex app-server
  - pairing
  - encryption
  - git
  - resilience
  - desktop

## Current Web Remake Coverage

Current local project:
- `/Users/young/mx/tmp/phodex-web`

Already implemented before this audit:
- Bun native HTTPS relay
- WSS transport
- email OTP authentication
- local backdoor OTP
- live threads and messages
- queue / stop / send
- mobile-styled chat shell

Still missing or only partially covered:
- full onboarding flow
- source-shaped home empty state
- source-shaped settings hierarchy
- archived chats page
- about page
- paywall / subscription UI shell
- source-like page routing between these screens
- many `TurnView` secondary capabilities

## Execution Checklist

1. Audit source pages and root routing.
   Status: done
2. Audit each page's concrete features and overlays.
   Status: done for primary pages, ongoing for turn-view depth
3. Bring the current Web app up to page parity for:
   - onboarding
   - auth / pairing
   - home empty state
   - sidebar
   - turn view shell
   - settings
   - archived chats
   - about
   Status: in progress
4. Try to obtain simulator screenshots from source or a compatibility harness.
   Status: blocked by local Xcode 15 vs source project format / package compatibility; compatibility workaround in progress
5. Re-run browser screenshot comparison after each page pass.
   Status: in progress

## Simulator Attempt Blocker

Attempted on:
- `/Users/young/mx/tmp/remodex-xcode15/CodexMobile/CodexMobile.xcodeproj`

Concrete blocker on this machine:
- `xcodebuild -resolvePackageDependencies`
- `xcodebuild -list`
- `xcodebuild -showdestinations`

All fail before simulator launch because Xcode 15 cannot resolve the `textual`
Swift package from the upstream source tree:

- dependency error:
  `textual contains incompatible tools version (6.0.0)`

Practical consequence:
- source-driven page audit can continue from SwiftUI files and embedded image assets
- browser-side remake can continue with screenshot comparison against repo assets
- direct iOS simulator screenshots are currently blocked until the machine has an
  Xcode / Swift toolchain that can resolve the upstream package graph
