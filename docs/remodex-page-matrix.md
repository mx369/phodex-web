# Remodex Page Matrix

This matrix turns the SwiftUI source audit into a concrete page-by-page acceptance list for `/Users/young/mx/tmp/phodex-web`.

Legend:
- `done`: implemented and already captured with a real browser screenshot
- `partial`: implemented only as a shell, or missing source states
- `missing`: not implemented yet

## Root Flow

| Source page | Required source states | Current web status | Screenshot evidence |
| --- | --- | --- | --- |
| `OnboardingView` | welcome, features, step 1 install Codex, step 2 install bridge, step 3 start pairing, bottom CTA, install reminder alert | `done` for the 5-page shell, still needs final pixel pass | `acceptance-entry-01-welcome-fixed.png`, `acceptance-entry-02-pairing-fixed.png` |
| `SubscriptionBootstrapFailureView` | failure copy, retry, restore purchases, privacy, terms | `partial` | `root-bootstrap-failure.png` |
| `SubscriptionGateView` | hero, feature marketing, pricing, CTA, paywall entry, restore/manage/legal links | `partial` | `subscription-gate-932-r5.png` |
| `QRScannerView` | camera permission, live scanner, scan error alert, bridge-version mismatch recovery, back action | `partial` | `camera-permission-top-r3.png`, `root-scanner.png`, `root-scanner-error.png` |
| `BridgeUpdateSheet` | copy command, retry, scan new QR, dismiss | `partial` | `bridge-update-top-r3.png`, `bridge-update-bottom-r4.png` |
| deleted-thread alert | alert copy + new-thread CTA | `missing` | none |
| thread completion banner | banner + dismiss + open thread | `done` | `acceptance-auth-03-turn-fixed.png` |

## Main Shell

| Source page | Required source states | Current web status | Screenshot evidence |
| --- | --- | --- | --- |
| `HomeEmptyStateView` | connected, connecting, offline, trusted Mac summary, primary CTA swap | `partial` | `acceptance-auth-01-home-empty-fixed.png` |
| `SidebarView` | search, grouped threads, archive group, rename, archive, delete, connected Mac footer, settings entry | `partial` | `sidebar-open-932.png`, `acceptance-auth-08-delete-dialog-fixed.png` |
| `TurnView` | empty thread, active timeline, queued drafts, send/stop/queue, toolbar, composer suggestions | `partial` | `acceptance-auth-03-turn-fixed.png` |
| `SettingsView` | standalone page stack, archived/about/paywall subpages, appearance, notifications, runtime, connection | `partial` | `settings-932.png` |
| `ArchivedChatsView` | empty state, list state, restore, delete | `partial` | `archived-932-r2.png` |
| `AboutRemodexView` | standalone article page with Done/back behavior | `partial` | `about-932.png` |
| `RevenueCatPaywallView` | full-screen paywall, CTA, restore, manage, privacy, terms, plans | `partial` | `paywall-932-r2.png` |

## Turn Secondary Pages

| Source page | Required source states | Current web status | Screenshot evidence |
| --- | --- | --- | --- |
| `TurnStatusSheet` | run state summary and actions | `missing` | none |
| `TurnDiffSheet` | diff summary, files, revert/inspect affordances | `missing` | none |
| `AssistantRevertSheet` | assistant revert confirmation flow | `missing` | none |
| `TurnThreadPathSheet` | thread path / workspace location | `missing` | none |
| `TurnWorktreeHandoffOverlay` | worktree handoff overlay states | `missing` | none |
| `GPTVoiceSetupSheet` | voice setup and account prerequisites | `missing` | none |
| image preview / selectable text / mermaid preview | modal detail viewers | `missing` | none |
| plan execution / structured input sheets | deeper plan mode flows | `missing` | none |
| command execution / subagent detail sheets | secondary detail pages | `missing` | none |

## Functional Evidence Still Needed

These are not separate top-level pages, but they need their own real screenshot states once implemented:

| Area | Required state | Current web status |
| --- | --- | --- |
| pairing | camera permission denied | missing |
| pairing | scan error alert | missing |
| pairing | bridge update recovery | missing |
| home | offline trusted Mac state | partial |
| home | connecting pulse state | partial |
| sidebar | populated archived list | missing evidence |
| turn | empty timeline | missing evidence |
| turn | queued draft remove/resume | partial |
| turn | connection state variants | missing evidence |
| settings | toggled appearance/notification variants | missing evidence |

## Priority Order

1. Implement root-flow blockers: `SubscriptionBootstrapFailureView`, `SubscriptionGateView`, `QRScannerView`, `BridgeUpdateSheet`.
2. Replace inline settings/about/paywall presentation with a more native page-stack model.
3. Fill in shell state variants and secondary screenshots for home/sidebar/turn/settings.
4. Continue into Turn secondary sheets and protocol-backed cards.
