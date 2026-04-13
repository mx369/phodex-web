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
- Grouped queued drafts into a visible composer work-state band and promoted `/plan` replies into pinned-plan surfaces.
- Replaced the generic turn-empty welcome card with an embedded empty-timeline block that keeps the composer in the same working layout.
- Locked the main shell to the viewport again so Turn scrolling happens inside the timeline instead of on `body`.
- Added a source-informed Turn auto-scroll state machine with assistant anchoring, bottom-threshold tolerance, and a latest-jump button.
- Rebuilt the drawer's create path around a real project-picker sheet, replaced placeholder glyph icons with a consistent SVG icon system, and wired worktree creation to a real git worktree flow.
- Added a persisted local rename fallback so drawer row rename remains functional even when Codex thread-name sync does not round-trip.

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
| Turn Empty | clean authenticated chat after empty-state parity pass | embedded empty-timeline block, source-closer guidance copy, composer visible, no voice/attachment/Fast/Plan placeholders | pass | `.artifacts/qa-71-turn-empty-timeline-block.png` |
| About | authenticated `?page=about` after shell pass | full-page mobile page render, updated architecture and sign-in copy | pass | `.artifacts/qa-49-about-mobile-page.png` |
| Paywall | authenticated `?page=paywall` after preview-only pass | full-page mobile page render, preview-only purchase controls, updated feature copy | pass | `.artifacts/qa-60-paywall-preview-only.png` |
| Sidebar Drawer | authenticated session after the drawer parity pass | drawer render, SVG icon system, explicit create sheet, project-group `+` preselection, real worktree start path, row rename action, connection footer, and settings/archive/disconnect actions | pass | `.artifacts/qa-76-drawer-open.png`, `.artifacts/qa-77-drawer-create-sheet.png`, `.artifacts/qa-78-drawer-worktree-created.png`, `.artifacts/qa-80-drawer-rename-fixed.png` |
| Turn View | authenticated existing threads after richer-thread-surface, work-state, and scroll-state passes | turn toolbar chips, real command/file/tool/subagent activity cards, queued-draft work-state band, pinned-plan surface, internal timeline scrolling, visible latest-jump button, and return-to-bottom behavior | pass | `.artifacts/qa-64-richer-thread-surfaces-viewport.png`, `.artifacts/qa-65-richer-thread-surfaces-bottom-viewport.png`, `.artifacts/qa-68-work-state-band.png`, `.artifacts/qa-69-queued-draft-band-bottom.png`, `.artifacts/qa-70-plan-band-bottom.png`, `.artifacts/qa-73-turn-scroll-bottom.png`, `.artifacts/qa-74-turn-scroll-arrow-only.png` |
| Settings | authenticated `?page=settings` after control-trim pass | dedicated mobile page render, settings cards, backed runtime defaults only, and Pro-preview copy/navigation | pass | `.artifacts/qa-62-settings-runtime-trimmed.png` |
| Archived | authenticated `?page=archived` after delete-UX cleanup | dedicated mobile page render, restore-only list, and honest no-delete copy | pass | `.artifacts/qa-55-archived-restore-only.png` |

## Interaction Flows

- OTP login: pass in a real browser flow; repeatable QA still uses the backdoor code `424242`, and the current server build now prefers live Resend delivery for request-code before falling back to the local mailbox.
- Shell/navigation pass: home, sidebar, settings, about, paywall, and archived pages were rerun after the mobile-page refactor, with home/sidebar rerun again after the latest source-parity pass.
- Drawer parity pass: the authenticated shell was rerun after replacing glyph icons with SVG icons, adding the shared create sheet, validating a real worktree creation path, and rechecking rename through the drawer row actions.
- Placeholder-removal pass: turn empty, settings, paywall, bootstrap failure, and subscription gate were rerun after removing voice/attachment/Fast/Plan affordances and marking purchases preview-only.
- Richer-thread-surface pass: turn view was rerun against a live Todo-maintenance thread after remapping Codex execution items into structured activity cards.
- Composer-work-state pass: a clean test thread was used to verify queued draft visibility/actionability and a real `/plan` thread was used to verify pinned-plan rendering above the composer.
- Turn-scroll pass: a long live thread was used to verify that the shell stays viewport-locked, the timeline scrolls internally, the latest-jump button appears when leaving bottom, and clicking it returns the timeline to the latest content.
- Full send / stream / stop regression was not rerun in this shell-focused pass, but queue and pinned-plan accessory states were rerun. Prior real turn-flow evidence remains in `.artifacts/qa-27-turn-response.png` through `.artifacts/qa-31-send-next.png`.

## Known Product Limitations Verified Or Still In Effect

- Permanent thread delete is intentionally absent because the Codex app-server bridge does not support it.
- Subscription purchase and restore are intentionally preview-only in this local build.

## Notes

- Acceptance docs now treat only onboarding, subscription gate, bootstrap failure, and email OTP as in-scope unauthenticated pages.
- The authenticated shell evidence now reflects the full-page mobile-page layout rather than the old centered card plus overlay-sheet structure.
- The screenshots listed above are real CDP captures from the running Bun relay on this machine.
