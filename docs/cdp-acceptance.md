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
| Home Empty | Real auth flow with email OTP backdoor, then waited for the connected home state | `.artifacts/qa-42-home-empty-email-only.png` |
| Turn Empty | Same authenticated session, tapped `Open chats`, then `New Chat` | `.artifacts/qa-43-turn-empty-email-only.png` |
| About | Authenticated session reloaded at `/?page=about` | `.artifacts/qa-44-about-email-only.png` |
| Paywall Shell | Authenticated session reloaded at `/?page=paywall` | `.artifacts/qa-45-paywall-email-only.png` |
| Sidebar Open | Earlier real authenticated capture; not rerun in this pass | `.artifacts/qa-14-sidebar.png` |
| Settings | Earlier real authenticated capture; not rerun in this pass | `.artifacts/qa-20-settings.png` |
| Archived Chats | Earlier real authenticated capture; not rerun in this pass | `.artifacts/qa-23-archived.png` |

## Notes

- The unauthenticated capture set now reflects the current product scope: onboarding, subscription gate, bootstrap failure, and email OTP.
- QR scanner, camera permission, scan error, and bridge-recovery pages are intentionally absent because those flows are excluded from the current product.
