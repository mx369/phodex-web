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
| Subscription Gate | Fresh unauthenticated session loaded at `/?flow=subscription-gate` | `.artifacts/qa-39-subscription-gate-email-only.png` |
| Bootstrap Failure | Fresh unauthenticated session loaded at `/?flow=bootstrap-failure` | `.artifacts/qa-40-bootstrap-failure-email-only.png` |
| Email OTP Requested | Same email session after requesting a code | `.artifacts/qa-41-email-otp-requested-email-only.png` |

## Authenticated Shell

| Page | How it was reached | Screenshot |
| --- | --- | --- |
| Home Empty | Real auth flow with email OTP backdoor, then waited for the connected home state after the shell refactor | `.artifacts/qa-46-home-shell-mobile-page.png` |
| Turn Empty | Same authenticated session, tapped `Open chats`, then `New Chat` | `.artifacts/qa-43-turn-empty-email-only.png` |
| Sidebar Open | Same authenticated session, opened the drawer from the full-page shell | `.artifacts/qa-47-sidebar-shell-mobile-page.png` |
| Settings | Authenticated session reloaded at `/?page=settings` after the shell refactor | `.artifacts/qa-48-settings-mobile-page.png` |
| About | Authenticated session reloaded at `/?page=about` after the shell refactor | `.artifacts/qa-49-about-mobile-page.png` |
| Paywall Shell | Authenticated session reloaded at `/?page=paywall` after the shell refactor | `.artifacts/qa-50-paywall-mobile-page.png` |
| Archived Chats | Authenticated session reloaded at `/?page=archived` after the shell refactor | `.artifacts/qa-51-archived-mobile-page.png` |

## Notes

- The unauthenticated capture set now reflects the current product scope: onboarding, subscription gate, bootstrap failure, and email OTP.
- The authenticated capture set now reflects the full-page mobile shell and dedicated mobile pages for settings, about, paywall, and archived.
- QR scanner, camera permission, scan error, and bridge-recovery pages are intentionally absent because those flows are excluded from the current product.
