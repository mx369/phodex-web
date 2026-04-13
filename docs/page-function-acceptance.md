# Page And Function Acceptance

Date: 2026-04-13
Runtime: `https://localhost:3443`
Transport: Bun HTTPS + WSS relay to local Codex app-server
Browser harness: Electron CDP hidden session `phodex-email`

## Fixes Applied During This Pass

- Removed QR / camera-pairing root states and screens from the actual app.
- Collapsed the unauthenticated path to `onboarding -> email OTP`.
- Removed user-facing E2EE copy from onboarding, turn empty, about, and paywall surfaces.

## Result Legend

- `pass`: verified in a real browser flow this pass
- `legacy_evidence`: existing real CDP evidence exists from an earlier pass, but this page was not isolated again after the latest auth cleanup

## Root Flow Pages

| Page | Entry path | Function points checked in this pass | Result | Evidence |
| --- | --- | --- | --- | --- |
| Loading Splash | app boot while `loadingSession` | not isolated in this pass | legacy_evidence | existing splash branch only |
| Onboarding Welcome | fresh unauthenticated load | initial render, CTA | pass | `.artifacts/qa-32-onboarding-welcome-email-only.png` |
| Onboarding Features | onboarding CTA | feature page render, CTA | pass | `.artifacts/qa-33-onboarding-features-email-only.png` |
| Onboarding Step 1 | onboarding CTA | install step render, CTA | pass | `.artifacts/qa-34-onboarding-step1-email-only.png` |
| Install Warning Alert | Step 1 continue | warning modal render, continue path | pass | `.artifacts/qa-35-onboarding-install-warning-email-only.png` |
| Onboarding Step 2 | warning continue | relay step render, CTA | pass | `.artifacts/qa-36-onboarding-step2-email-only.png` |
| Onboarding Step 3 | step CTA | start-remodex copy and final CTA render | pass | `.artifacts/qa-37-onboarding-step3-email-only.png` |
| Subscription Gate | `?flow=subscription-gate` | plan cards, email CTA, fallback links, render | pass | `.artifacts/qa-39-subscription-gate-email-only.png` |
| Bootstrap Failure | `?flow=bootstrap-failure` | failure card, retry/email CTA shell, legal shell | pass | `.artifacts/qa-40-bootstrap-failure-email-only.png` |
| Email OTP | `?flow=email-otp` and request-code state | initial render, request-code state, dev/backdoor shell | pass | `.artifacts/qa-38-email-otp-email-only.png`, `.artifacts/qa-41-email-otp-requested-email-only.png` |

## Authenticated Pages

| Page | Entry path | Function points checked in this pass | Result | Evidence |
| --- | --- | --- | --- | --- |
| Home Empty | fresh OTP login after auth cleanup | connected state, trusted Mac card, `Open chats` | pass | `.artifacts/qa-42-home-empty-email-only.png` |
| Turn Empty | `Home Empty -> Open chats -> New Chat` | updated empty-copy render, composer visible | pass | `.artifacts/qa-43-turn-empty-email-only.png` |
| About | authenticated `?page=about` | updated architecture and sign-in copy render | pass | `.artifacts/qa-44-about-email-only.png` |
| Paywall | authenticated `?page=paywall` | updated feature copy render | pass | `.artifacts/qa-45-paywall-email-only.png` |
| Sidebar Drawer | menu button from authenticated state | not isolated again after auth cleanup | legacy_evidence | `.artifacts/qa-14-sidebar.png`, `.artifacts/qa-19-thread-select-attempt.png` |
| Turn View | send real prompt on clean thread | not rerun in this pass | legacy_evidence | `.artifacts/qa-27-turn-response.png` |
| Settings | authenticated `?page=settings` | not rerun in this pass | legacy_evidence | `.artifacts/qa-20-settings.png` |
| Archived | authenticated `?page=archived` | not rerun in this pass | legacy_evidence | `.artifacts/qa-23-archived.png` |

## Interaction Flows

- OTP login: pass in a real browser flow with `qa-emailonly-20260413@local.dev` and backdoor code `424242`.
- Existing send / stream / stop / queue coverage was not rerun for this auth-only cleanup. Prior real evidence remains in `.artifacts/qa-27-turn-response.png` through `.artifacts/qa-31-send-next.png`.

## Known Product Limitations Verified Or Still In Effect

- `thread:delete` is intentionally unsupported by the Codex app-server bridge and currently toasts an error instead of deleting.
- Subscription purchase and restore are still shell-level only.

## Notes

- Acceptance docs now treat only onboarding, subscription gate, bootstrap failure, and email OTP as in-scope unauthenticated pages.
- The screenshots listed above are real CDP captures from the running Bun relay on this machine.
