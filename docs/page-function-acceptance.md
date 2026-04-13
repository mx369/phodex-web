# Page And Function Acceptance

Date: 2026-04-13
Runtime: `https://localhost:3443`
Transport: Bun HTTPS + WSS relay to local Codex app-server
Browser harness: Electron CDP hidden session `phodex-audit`

## Fixes Applied During This Pass

- Fixed fresh-user default selection leakage. New users now stay on `Home Empty` instead of inheriting the first global live thread.
- Fixed brand-new empty thread pruning during `syncAllThreadsFromCodex()`. A newly created selected thread now survives until Codex thread listing catches up.

## Result Legend

- `pass`: verified in a real browser flow this pass
- `pass_with_caveat`: rendered and interacted with, but one sub-function still has an environment caveat
- `fail`: verified broken in this pass
- `legacy_evidence`: existing real CDP evidence exists from an earlier pass, but this page was not isolated again after the latest fixes

## Root Flow Pages

| Page | Entry path | Function points checked in this pass | Result | Evidence |
| --- | --- | --- | --- | --- |
| Loading Splash | app boot while `loadingSession` | not isolated in this pass | legacy_evidence | existing splash branch only |
| Onboarding Welcome | fresh unauthenticated load | initial render, CTA | pass | `.artifacts/qa-01-onboarding.png` |
| Onboarding Features | onboarding CTA | feature page render, CTA | pass | `.artifacts/qa-02-onboarding-features.png` |
| Onboarding Step 1 | onboarding CTA | install step render, CTA | pass | `.artifacts/qa-03-onboarding-step1.png` |
| Install Warning Alert | Step 1 continue | warning modal render, continue path | pass | `.artifacts/qa-04-onboarding-install-warning.png` |
| Onboarding Step 2 | warning continue | relay step render, CTA | pass | `.artifacts/qa-05-onboarding-step2.png` |
| Onboarding Step 3 | step CTA | email step render, CTA | pass | `.artifacts/qa-06-onboarding-step3.png` |
| Subscription Gate | `?flow=subscription-gate` | plan cards, continue, fallback links, render | pass | `.artifacts/qa-24-subscription-gate.png` |
| Bootstrap Failure | `?flow=bootstrap-failure` | failure card, retry/restore shell, legal shell | pass | `.artifacts/qa-25-bootstrap-failure.png` |
| Camera Permission | onboarding complete | allow camera, OTP fallback, permission error shell | pass | `.artifacts/qa-07-camera-permission.png` |
| QR Scanner | camera allow | scanner shell, bridge mismatch, scan error, OTP fallback | pass | `.artifacts/qa-08-qr-scanner.png` |
| Scan Error | scanner `Scan Error` | retry, bridge recovery, email fallback | pass | `.artifacts/qa-10-scan-error.png` |
| Bridge Recovery | scanner `Bridge Mismatch` | recovery steps, copy CTA, retry CTA, OTP fallback | pass_with_caveat | `.artifacts/qa-09-bridge-recovery.png` |
| Email OTP | scanner/error fallback | request code, verify with static backdoor, dev/backdoor shell | pass | `.artifacts/qa-11-email-otp.png` |

Bridge Recovery caveat:
- The `Copy Command` button was clicked, but hidden Electron could not grant clipboard readback permission, so OS clipboard contents were not independently verified.

## Authenticated Pages

| Page | Entry path | Function points checked in this pass | Result | Evidence |
| --- | --- | --- | --- | --- |
| Home Empty | fresh OTP login after selection fix | connected state, trusted Mac card, `Disconnect`, `Open chats` | pass | `.artifacts/qa-16-fresh-home-after-fix.png` |
| Sidebar Drawer | menu button from authenticated state | search shell, new chat CTA, grouped threads, footer, settings/archive/disconnect actions | pass | `.artifacts/qa-14-sidebar.png`, `.artifacts/qa-19-thread-select-attempt.png` |
| Turn Empty | `New Chat` on fresh account after thread-prune fix | empty thread shell, composer visible, toolbar state | pass | `.artifacts/qa-26-thread-empty-after-threadfix.png` |
| Turn View | send real prompt on clean thread | user message, assistant reply render | pass | `.artifacts/qa-27-turn-response.png` |
| Settings | authenticated `?page=settings` | page-shell render after auth restore | pass | `.artifacts/qa-20-settings.png` |
| About | authenticated `?page=about` | article page-shell render | pass | `.artifacts/qa-21-about.png` |
| Paywall | authenticated `?page=paywall` | paywall shell render | pass | `.artifacts/qa-22-paywall.png` |
| Archived | authenticated `?page=archived` | archived page-shell render | pass | `.artifacts/qa-23-archived.png` |

## Composer And Run Controls

| Flow | Real action | Result | Evidence |
| --- | --- | --- | --- |
| OTP login | `qa-cdp-threadfix-20260413@local.dev` + `424242` | pass | `.artifacts/qa-16-fresh-home-after-fix.png` |
| Create thread | drawer `New Chat` on fresh account | pass after thread-prune fix | `.artifacts/qa-26-thread-empty-after-threadfix.png` |
| First send | sent `Reply with exactly PHODEX_UI_OK and nothing else.` | pass | `.artifacts/qa-27-turn-response.png` |
| Real reply | browser waited for `PHODEX_UI_OK` | pass | `.artifacts/qa-27-turn-response.png` |
| Running state | long prompt produced live run with stop affordance | pass | `.artifacts/qa-28-running-stop-visible.png` |
| Queue draft | typed `SECOND_QUEUE_CHECK` during active run and queued it | pass | `.artifacts/qa-29-queued-draft.png` |
| Stop run | clicked the live stop control during a running turn | pass | `.artifacts/qa-30-stopped-run.png` |
| Send next | resumed the queued draft from the queued card | pass | `.artifacts/qa-31-send-next.png` |

## Known Product Limitations Verified In This Pass

- `thread:delete` is intentionally unsupported by the Codex app-server bridge and currently toasts an error instead of deleting.
- `Bridge Recovery -> Copy Command` cannot be fully asserted in hidden Electron because clipboard readback is denied.

## Notes

- The project still exposes global thread history to authenticated users. This pass fixed the two blockers that prevented clean per-user acceptance: default selection leakage and brand-new thread pruning.
- The page-shell screenshots above are all real CDP captures from the running Bun relay on this machine.
