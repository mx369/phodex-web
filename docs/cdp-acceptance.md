# CDP Acceptance Capture

All screenshots in this file were captured from real browser renders through the Electron CDP workflow against `https://localhost:3443`.

## Entry + Root Flow

| Page | How it was reached | Screenshot |
| --- | --- | --- |
| Welcome | Fresh unauthenticated session loaded at `/` | `.artifacts/qa-32-onboarding-welcome-email-only.png` |
| Onboarding Features | Same session, clicked `Get Started` | `.artifacts/qa-33-onboarding-features-email-only.png` |
| Onboarding Step 1 | Same session, clicked `Set Up` | `.artifacts/qa-34-onboarding-step1-email-only.png` |
| Install Warning Alert | Same session, clicked `Continue` on step 1 | `.artifacts/qa-35-onboarding-install-warning-email-only.png` |
| Onboarding Step 2 | Same session, continued past the install warning | `.artifacts/qa-36-onboarding-step2-email-only.png` |
| Onboarding Step 3 | Same session, clicked through to the final setup step | `.artifacts/qa-37-onboarding-step3-email-only.png` |
| Email OTP | Fresh unauthenticated session loaded at `/?flow=email-otp` | `.artifacts/qa-38-email-otp-email-only.png` |
| Subscription Gate | Fresh unauthenticated session loaded at `/?flow=subscription-gate` after the preview-only purchase copy pass | `.artifacts/qa-57-subscription-preview-only.png` |
| Bootstrap Failure | Fresh unauthenticated session loaded at `/?flow=bootstrap-failure` after the preview-only purchase copy pass | `.artifacts/qa-56-bootstrap-preview-only.png` |
| Email OTP Requested | Same email session after requesting a code | `.artifacts/qa-41-email-otp-requested-email-only.png` |

## Authenticated Shell

| Page | How it was reached | Screenshot |
| --- | --- | --- |
| Home Empty | Real auth flow with email OTP backdoor, then waited for the connected home state after the latest page-parity pass | `.artifacts/qa-52-home-page-parity.png` |
| Turn Empty | Same authenticated session, opened a clean chat after the empty-timeline pass | `.artifacts/qa-71-turn-empty-timeline-block.png` |
| Turn View Activity Surfaces | Same authenticated session, reopened the active Todo-maintenance thread after the richer-thread-surface pass | `.artifacts/qa-64-richer-thread-surfaces-viewport.png`, `.artifacts/qa-65-richer-thread-surfaces-bottom-viewport.png` |
| Turn View Work-State Band | Same authenticated session, created a clean test thread and verified queued-draft and pinned-plan accessory states above the composer | `.artifacts/qa-68-work-state-band.png`, `.artifacts/qa-69-queued-draft-band-bottom.png`, `.artifacts/qa-70-plan-band-bottom.png` |
| Turn View Scroll State | Same authenticated session, used a long thread to verify internal timeline scrolling, the arrow-only latest-jump button, and return-to-bottom behavior after the source-informed scroll-state pass | `.artifacts/qa-73-turn-scroll-bottom.png`, `.artifacts/qa-74-turn-scroll-arrow-only.png` |
| Sidebar Open | Same authenticated session, opened the drawer after the drawer parity pass | `.artifacts/qa-76-drawer-open.png` |
| Sidebar Create Sheet | Same authenticated session, opened drawer `New Chat` after the drawer parity pass | `.artifacts/qa-77-drawer-create-sheet.png` |
| Sidebar Worktree Create | Same authenticated session, switched the create sheet to `Worktree Chat`, targeted `phodex-web`, and waited for the real thread to land | `.artifacts/qa-78-drawer-worktree-created.png` |
| Sidebar Rename | Same authenticated session, reopened the drawer row actions and renamed the new worktree thread | `.artifacts/qa-80-drawer-rename-fixed.png` |
| Settings | Authenticated session reloaded at `/?page=settings` after trimming runtime defaults to backed fields only | `.artifacts/qa-62-settings-runtime-trimmed.png` |
| About | Authenticated session reloaded at `/?page=about` after the shell refactor | `.artifacts/qa-49-about-mobile-page.png` |
| Paywall Shell | Authenticated session reloaded at `/?page=paywall` after the preview-only purchase control pass | `.artifacts/qa-60-paywall-preview-only.png` |
| Archived Chats | Authenticated session reloaded at `/?page=archived` after the delete-UX cleanup | `.artifacts/qa-55-archived-restore-only.png` |

## Notes

- The unauthenticated capture set now reflects the current product scope: onboarding, subscription gate, bootstrap failure, and email OTP.
- The authenticated capture set now reflects the full-page mobile shell and dedicated mobile pages for settings, about, paywall, and archived.
- Sidebar evidence now also reflects the new SVG icon system, shared create sheet, and real worktree/rename flows in addition to the restore-only delete policy.
- Subscription and paywall evidence now reflect preview-only purchase controls, and turn-empty evidence reflects the composer without voice/attachment placeholders.
- Turn-empty evidence now reflects the embedded timeline block rather than the earlier generic welcome card.
- Turn-empty and settings evidence now also reflect the removal of inert Fast/Plan UI.
- Turn-view evidence now reflects the summary toolbar plus real Codex execution cards instead of chat-only message rows.
- Turn-view work-state evidence now reflects visible queued-draft and pinned-plan accessory surfaces instead of hiding that state in thread metadata alone.
- Turn-view scroll evidence now reflects a fixed mobile shell with an internally scrolling timeline and a source-informed latest-jump affordance.
- QR scanner, camera permission, scan error, and bridge-recovery pages are intentionally absent because those flows are excluded from the current product.
