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
- Removed permanent-delete affordances from the UI and replaced archived-page copy with honest restore-only guidance.
- Removed composer voice/attachment placeholders and marked purchase shells as preview-only.
- Removed inert Fast/Plan toggles so composer and settings only expose backed controls.
- Mapped real Codex execution items into turn activity cards and added a source-closer turn toolbar summary strip.

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
| Subscription Gate | `?flow=subscription-gate` | plan cards, email CTA, preview-only purchase copy, legal shell | pass | `.artifacts/qa-57-subscription-preview-only.png` |
| Bootstrap Failure | `?flow=bootstrap-failure` | failure card, retry/email CTA shell, preview-only purchase copy, legal shell | pass | `.artifacts/qa-56-bootstrap-preview-only.png` |
| Email OTP | `?flow=email-otp` and request-code state | initial render, request-code state, dev/backdoor shell | pass | `.artifacts/qa-38-email-otp-email-only.png`, `.artifacts/qa-41-email-otp-requested-email-only.png` |

## Authenticated Pages

| Page | Entry path | Function points checked in this pass | Result | Evidence |
| --- | --- | --- | --- | --- |
| Home Empty | fresh OTP login after source-parity pass | connected state, source-closer header chips, trusted Mac card, `Open chats`, full-page shell render | pass | `.artifacts/qa-52-home-page-parity.png` |
| Turn Empty | clean authenticated chat after placeholder cleanup | empty-copy render, composer visible, no voice/attachment/Fast/Plan placeholders | pass | `.artifacts/qa-61-turn-empty-real-controls.png` |
| About | authenticated `?page=about` after shell pass | full-page mobile page render, updated architecture and sign-in copy | pass | `.artifacts/qa-49-about-mobile-page.png` |
| Paywall | authenticated `?page=paywall` after preview-only pass | full-page mobile page render, preview-only purchase controls, updated feature copy | pass | `.artifacts/qa-60-paywall-preview-only.png` |
| Sidebar Drawer | menu button from authenticated state after delete-UX cleanup | drawer render, local/worktree/about shortcuts, thread list without delete affordances, connection footer, settings/archive/disconnect actions | pass | `.artifacts/qa-54-sidebar-no-delete.png` |
| Turn View | authenticated existing thread after richer-thread-surface pass | turn toolbar chips, real command/file/tool/subagent activity cards, and compact output previews | pass | `.artifacts/qa-64-richer-thread-surfaces-viewport.png`, `.artifacts/qa-65-richer-thread-surfaces-bottom-viewport.png` |
| Settings | authenticated `?page=settings` after control-trim pass | dedicated mobile page render, settings cards, backed runtime defaults only, and Pro-preview copy/navigation | pass | `.artifacts/qa-62-settings-runtime-trimmed.png` |
| Archived | authenticated `?page=archived` after delete-UX cleanup | dedicated mobile page render, restore-only list, and honest no-delete copy | pass | `.artifacts/qa-55-archived-restore-only.png` |

## Interaction Flows

- OTP login: pass in a real browser flow with a local dev mailbox and backdoor code `424242`.
- Shell/navigation pass: home, sidebar, settings, about, paywall, and archived pages were rerun after the mobile-page refactor, with home/sidebar rerun again after the latest source-parity pass.
- Placeholder-removal pass: turn empty, settings, paywall, bootstrap failure, and subscription gate were rerun after removing voice/attachment/Fast/Plan affordances and marking purchases preview-only.
- Richer-thread-surface pass: turn view was rerun against a live Todo-maintenance thread after remapping Codex execution items into structured activity cards.
- Existing send / stream / stop / queue coverage was not rerun in this shell-focused pass. Prior real evidence remains in `.artifacts/qa-27-turn-response.png` through `.artifacts/qa-31-send-next.png`.

## Known Product Limitations Verified Or Still In Effect

- Permanent thread delete is intentionally absent because the Codex app-server bridge does not support it.
- Subscription purchase and restore are intentionally preview-only in this local build.

## Notes

- Acceptance docs now treat only onboarding, subscription gate, bootstrap failure, and email OTP as in-scope unauthenticated pages.
- The authenticated shell evidence now reflects the full-page mobile-page layout rather than the old centered card plus overlay-sheet structure.
- The screenshots listed above are real CDP captures from the running Bun relay on this machine.
