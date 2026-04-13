# CDP Acceptance Capture

All screenshots in this file were captured from real browser renders through the Electron CDP workflow against `https://localhost:3443`.

## Entry + Root Flow

| Page | How it was reached | Screenshot |
| --- | --- | --- |
| Welcome | Fresh unauthenticated session loaded at `/` | `.artifacts/acceptance-entry-01-welcome-fixed.png` |
| Email Pairing (legacy shell) | Same session, clicked through the onboarding CTA flow until `Pair with Email` | `.artifacts/acceptance-entry-02-pairing-fixed.png` |
| Subscription Bootstrap Failure | Fresh unauthenticated session loaded at `/?flow=bootstrap-failure` | `.artifacts/root-bootstrap-failure.png` |
| Subscription Gate | Fresh unauthenticated session loaded at `/?flow=subscription-gate` in a clean CDP session | `.artifacts/subscription-gate-932-r5.png` |
| Camera Permission | Fresh unauthenticated session loaded at `/?flow=camera-permission` | `.artifacts/camera-permission-top-r3.png` |
| QR Scanner | Fresh unauthenticated session loaded at `/?flow=scanner` | `.artifacts/root-scanner.png` |
| Scan Error | Fresh unauthenticated session loaded at `/?flow=scanner-error` | `.artifacts/root-scanner-error.png` |
| Bridge Recovery | Fresh unauthenticated session loaded at `/?flow=bridge-update` | `.artifacts/bridge-update-top-r3.png` |
| Email OTP Fallback | Fresh unauthenticated session loaded at `/?flow=email-otp` | `.artifacts/root-email-otp.png` |

## Authenticated Shell

| Page | How it was reached | Screenshot |
| --- | --- | --- |
| Home Empty | Real auth flow with email OTP backdoor, then tapped `Home` from a live thread | `.artifacts/home-empty-932.png` |
| Sidebar Open | Same authenticated session, tapped the top-left drawer button from Home | `.artifacts/sidebar-open-932.png` |
| Turn View | Same authenticated session before clearing thread selection | `.artifacts/authenticated-home-932.png` |
| Settings | Authenticated session reloaded at `/?page=settings` | `.artifacts/settings-932.png` |
| Archived Chats | Authenticated session reloaded at `/?page=archived`; current data produced the empty-state view | `.artifacts/archived-932-r2.png` |
| About | Authenticated session reloaded at `/?page=about` | `.artifacts/about-932.png` |
| Paywall Shell | Authenticated session reloaded at `/?page=paywall` | `.artifacts/paywall-932-r2.png` |
| Delete Dialog | Earlier live-session capture from the drawer delete control | `.artifacts/acceptance-auth-08-delete-dialog-fixed.png` |

## Notes

- The root-flow pages are now captured as real browser states instead of placeholder screenshots.
- The authenticated session was obtained through the real OTP endpoints with the local static backdoor code enabled for self-check.
- Long native-style pages may need a second bottom-half capture in later passes if a single viewport image is not enough for visual comparison.
