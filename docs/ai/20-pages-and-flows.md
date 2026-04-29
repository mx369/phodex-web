# Pages And Flows

This file is the UI and flow reference. Read it when you need page-level status instead of broad project status.

## Page Inventory

| Page | Current status | Real behavior today | Main gaps |
| --- | --- | --- | --- |
| Onboarding welcome/features/setup steps | Partial | Rendered, paged, swipeable, and routes into Email OTP; the final setup step is now explanatory only and no longer exposes a live install command before auth | Copy, layout, and parity still approximate |
| Bootstrap failure | Shell | Rendered and navigable | No real purchase or restore flow |
| Subscription gate | Shell | Plan selection and navigation exist | No real purchase or restore flow |
| Email OTP | Real | Request-code and verify-code are live; OTP uses real mail delivery when configured, and verification failures now render an inline error in the form instead of relying on toast only | UI is still approximate |
| Home empty | Partial | Real bridge/account state drives the full-page mobile shell; the post-login install card stays available even when one Mac is already connected, defaults to a compact platform switch + copy + reveal control, and Home renders a deduped per-Mac device list instead of piling up stale install records for the same hostname or showing a separate linked-warning card during bridge hydration. Only `connected` device cards are switchable: the active card opens chats, another ready Mac switches the active bridge, and `linking` or offline cards stay inert. | Final spacing and device-list parity still differ |
| Sidebar | Partial | Real thread list, select, rename, archive, project-targeted local/worktree create, tap-outside dismissal, and collapsible project groups; the drawer keeps search plus compact new-chat actions, orders conversations by thread creation time instead of latest reply time, and ignores message-stream activity when rendering drawer rows so per-thread edit/archive/delete actions can stay behind a low-frequency overflow menu without the list reordering under the user | Final parity and a few density tradeoffs still differ |
| Turn empty | Partial | Real selected thread, blank conversation canvas, bottom workspace-action rail, composer, pending-thread state, a persisted `Normal / Fast` runtime toggle, inline access-mode selection inside the runtime picker, and single-image attachment send; the old thread-toolbar action strip is removed so the main shell stays focused on title, message area, and composer | Structured-input replacement and final polish are still missing |
| Turn with messages | Partial | Real streaming, richer tool/file/system cards, latest-jump, an inline pending-send that now stays visible until the real user message lands, running-turn follow-ups via Codex `turn/steer`, queued-draft fallback with inline waiting previews plus bottom-card controls, pinned plan, thread-scoped project diff/file inspectors, compact inline file-reference chips for Markdown local file links, inline rendering of user-sent images, and a top-right overflow menu for thread/file/diff actions | Some empty branches, queue states, and toolbar/sheet parity still differ |
| Archived chats | Partial | Real archived list and restore | Permanent delete is intentionally absent; list behavior is simplified |
| About | Partial | Dedicated informational page exists | Still simplified versus upstream |
| Paywall | Shell | Preview-only paywall page exists | No real billing flow |

## Route Truth

- Auth/onboarding routes:
  `/onboarding`, `/login`, `/subscribe`, `/bootstrap-failure`
- Authenticated shell routes:
  `/` for Home, `/:machineId/:threadId` for the active chat, `/archived`, `/about`, `/pro`
- The web client now treats these paths as the source of truth and syncs page/thread selection back into the URL instead of relying only on query-string boot params.

## Flow Inventory

| Flow | Status | Notes |
| --- | --- | --- |
| Onboarding -> Email OTP | Real | Fresh unauthenticated users move from onboarding into Email OTP; the real account-bound bridge installer command is minted only after login, now offers `Mac / Linux` and `Windows` variants, and remains available from the post-login empty-home install card so additional computers can be linked later with a refreshed command |
| Connected Home -> add another computer | Real | Home keeps the install card visible after a bridge connects, copies the selected platform command from the compact card, can reveal the full command plus `New command`, lets the user switch between shell and PowerShell installers, shows one card per machine even after repeated reinstall attempts on the same host, and lets the user tap a second ready device to make it active while leaving `linking` or offline cards disabled |
| Email OTP login | Real | Uses `/api/auth/request-code` and `/api/auth/verify-code`; request-code requires configured live email delivery and no longer exposes any local bypass path |
| Relay bootstrap | Real | Snapshot load plus WSS session sync |
| New chat -> first send | Real | Dialog-based create flows remain in the drawer, and the current-thread overflow menu can also start a fresh local or worktree chat without reintroducing a dedicated toolbar row; local pending thread state stays visible instead of dropping to a blank canvas before the real Codex thread resolves |
| Attach image -> send | Real | Composer can attach one local image, sends it with the prompt through the relay/bridge, and re-renders the returned user image in the timeline |
| Drawer create sheet | Real | Creation mode and target project are chosen before `thread:create` is sent |
| Drawer worktree create | Real | Creates a real git worktree under `~/.codex/worktrees/<repo>/...` before starting the thread |
| Drawer custom project create | Real | Accepts either a folder name or a full path for the new local chat cwd |
| Streaming assistant reply | Real | Consumes Codex app-server streaming deltas |
| Turn auto-scroll and scroll-to-latest | Real | Uses internal shell scrolling, follows bottom across message growth and composer/work-state height changes, and only shows the latest-jump button after the user intentionally leaves bottom |
| Stop run | Real | Sends turn interrupt to local Codex |
| Runtime speed selection | Real | Exposes `Normal / Fast`, persists the selected model plus speed locally across reloads, and `Fast` still falls back when the bridge cannot accept the fast tier field |
| Follow up while running | Real | Prefers Codex app-server `turn/steer` so the follow-up attaches to the active regular turn and appears immediately as a pending timeline bubble; if steering is unavailable or rejected, it falls back to the older queued-draft path and auto-drains after the active run completes |
| Resume queued draft | Real | Manual resume still replays the saved text with its runtime settings if a queued draft remains after the run has settled or a flush did not start; tapping `Resume` now removes the row locally and rolls straight into the pending-send bubble before the server-side turn start finishes, while relay resume now broadcasts the `draft removed + running` transition together so auto-resume does not leave a visible gap |
| Rich execution activity surfaces | Real | Shows structured command, file, tool, image, and subagent cards; history also backfills missing diff/file rows |
| Project browser and diff inspector | Real | The current-thread overflow menu can open a lazy project file browser or working-tree diff sheet; `message.fileChanges` rows deep-link into filtered diff for that file |
| Pinned plan accessory | Real | Latest `/plan` summary can pin above the composer |
| Rename thread | Real | Applies a local title override immediately and best-effort syncs to Codex |
| Archive thread | Real | Uses Codex archive/unarchive |
| Delete thread | Limited | The drawer overflow exposes delete alongside rename and archive, but the current backend still reports that Codex app-server does not expose permanent thread deletion |
| Purchase / restore purchase | Preview only | UI shells only; no transaction or restore behavior is wired |

## Excluded Scope

- QR-code login and camera pairing are out of scope.
- End-to-end encryption is out of scope.
- If old source-audit docs mention QR login or E2EE, treat them as upstream reference only, not as implementation targets.

## UI-Specific Warnings

- Do not copy the App Store or marketing device frame. Rebuild the app content inside the screenshots, not the screenshot chrome.
- Do not add fake status bars or dynamic islands.
- Treat the current shell as a full-page mobile surface, not a centered faux-device card.
- If you change shared controls, color roles, font scale, radius scale, or icon language, update `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md` in the same change.
- If changing page structure, update this file and the screenshot evidence when the behavior changes.

## Deep References

- `/Users/young/mx/tmp/phodex-web/docs/remodex-source-audit.md`
- `/Users/young/mx/tmp/phodex-web/docs/remodex-page-matrix.md`
- `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md`
