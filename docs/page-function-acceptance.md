# Page And Function Acceptance

Date: 2026-04-13
Runtime: `https://localhost:3443`
Transport: Bun HTTPS + WSS relay to local Codex app-server
Browser harness: Electron CDP hidden sessions via the local `electron-cdp-automation` wrapper

## Fixes Applied During This Pass

- Removed QR / camera-pairing root states and screens from the actual app.
- Collapsed the unauthenticated path to `onboarding -> email OTP`.
- Removed user-facing E2EE copy from onboarding, turn empty, about, and paywall surfaces.
- Replaced the fixed-width `app-surface` / `app-sheet` shell with a full-page `app-shell` + `mobile-page` structure.

## Result Legend

- `pass`: verified in a real browser flow this pass
- `legacy_evidence`: existing real CDP evidence exists from an earlier pass, but this page was not isolated again after the latest auth or shell cleanup

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
| Home Empty | fresh OTP login after source-parity pass | connected state, source-closer header chips, trusted Mac card, `Open chats`, full-page shell render | pass | `.artifacts/qa-52-home-page-parity.png` |
| Turn Empty | `Home Empty -> Open chats -> New Chat` | not isolated again after the shell pass | legacy_evidence | `.artifacts/qa-43-turn-empty-email-only.png` |
| About | authenticated `?page=about` after shell pass | full-page mobile page render, updated architecture and sign-in copy | pass | `.artifacts/qa-49-about-mobile-page.png` |
| Paywall | authenticated `?page=paywall` after shell pass | full-page mobile page render, updated feature copy | pass | `.artifacts/qa-50-paywall-mobile-page.png` |
| Sidebar Drawer | menu button from authenticated state after source-parity pass | drawer render, local/worktree/about shortcuts, thread list, connection footer, settings/archive/disconnect actions | pass | `.artifacts/qa-53-sidebar-page-parity.png` |
| Turn View | send real prompt on clean thread | not rerun in this pass | legacy_evidence | `.artifacts/qa-27-turn-response.png` |
| Settings | authenticated `?page=settings` after shell pass | dedicated mobile page render, settings cards, archive/about/paywall navigation | pass | `.artifacts/qa-48-settings-mobile-page.png` |
| Archived | authenticated `?page=archived` after shell pass | dedicated mobile page render, archived list shell, restore/delete actions present | pass | `.artifacts/qa-51-archived-mobile-page.png` |

## Interaction Flows

- OTP login: pass in a real browser flow with a local dev mailbox and backdoor code `424242`.
- Shell/navigation pass: home, sidebar, settings, about, paywall, and archived pages were rerun after the mobile-page refactor, with home/sidebar rerun again after the latest source-parity pass.
- Existing send / stream / stop / queue coverage was not rerun in this shell-focused pass. Prior real evidence remains in `.artifacts/qa-27-turn-response.png` through `.artifacts/qa-31-send-next.png`.

## Known Product Limitations Verified Or Still In Effect

- `thread:delete` is intentionally unsupported by the Codex app-server bridge and currently toasts an error instead of deleting.
- Subscription purchase and restore are still shell-level only.

## Notes

- Acceptance docs now treat only onboarding, subscription gate, bootstrap failure, and email OTP as in-scope unauthenticated pages.
- The authenticated shell evidence now reflects the full-page mobile-page layout rather than the old centered card plus overlay-sheet structure.
- The screenshots listed above are real CDP captures from the running Bun relay on this machine.
