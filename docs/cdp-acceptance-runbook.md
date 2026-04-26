# CDP Acceptance Runbook

This runbook describes how to drive `/Users/young/mx/tmp/phodex-web` through a hidden Electron CDP session for repeatable acceptance screenshots.

It is designed around the existing `electron-cdp-automation` wrapper and the current app behavior in `apps/web/src/App.vue`, which reads:
- `flow=` for root-flow states
- `page=` for authenticated shell pages

Authenticated `page=` states now render as dedicated full-page mobile surfaces, not overlay sheets above a centered card.

## What This Runbook Covers

- Clear local browser state in a hidden session
- Open `https://localhost:3443`
- Log in with `qa-cdp@local.dev` and a real OTP code supplied from email
- Jump to a root-flow state with `?flow=...`
- Jump to an authenticated page with `?page=...`
- Take screenshots
- Click or fill controls when a state requires interaction

## Prerequisites

- The relay is running and reachable at `https://localhost:3443`
- The Electron CDP wrapper is available at:
  - `$HOME/.codex/skills/electron-cdp-automation/scripts/electron_cdp.sh`
- Optional but faster:
  - `export ELECTRON_CDP_ELECTRON_BIN="$PWD/node_modules/.bin/electron"`
- For local TLS, start Electron with `--allow-insecure`

## Session Model

Use one named hidden session for the acceptance pass:

```bash
phodex-qa
```

Reuse that session for the whole run so screenshots stay tied to one browser history and one local-storage state.

## Route Model

Use `flow=` for unauthenticated root states:

- `bootstrap-failure`
- `subscription-gate`
- `email-otp`

Use `page=` for authenticated shell pages:

- `settings`
- `archived`
- `about`
- `paywall`

If you need the onboarding flow, clear local state first and open `https://localhost:3443/` without a `flow=` value.

## Exact Acceptance Sequence

1. Start or reuse the hidden session with `--allow-insecure`.
2. Clear local state for `https://localhost:3443`.
3. Open the base app URL.
4. Capture onboarding screenshots from a clean state.
5. Open `?flow=email-otp`.
6. Log in as `qa-cdp@local.dev` using a real OTP code from email.
7. Open `?page=about`, `?page=paywall`, and any other authenticated pages you need.
8. Use snapshot refs or selector-driven `evaluate` calls for controls that are not addressable by URL alone.
9. Re-snapshot after every rerender, modal, or navigation.
10. Save a real screenshot for each page state.

## Wrapper Commands

The wrapper already provides the primitives you need:

```bash
"$ECDP" start --allow-insecure --session phodex-qa
"$ECDP" open https://localhost:3443 --session phodex-qa
"$ECDP" snapshot --session phodex-qa
"$ECDP" click e12 --session phodex-qa
"$ECDP" fill e5 "qa-cdp@local.dev" --session phodex-qa
"$ECDP" screenshot /Users/young/mx/tmp/phodex-web/.artifacts/qa-cdp/home.png --session phodex-qa
```

For browser-state reset, use the hidden session and clear origin storage before reloading:

```bash
"$ECDP" cdp Storage.clearDataForOrigin '{"origin":"https://localhost:3443","storageTypes":"all"}' --session phodex-qa
"$ECDP" reload --session phodex-qa
```

## Login Flow

The app no longer exposes any static backdoor code or local auth lookup endpoint.
Before running the login sequence, request a real OTP email and use a mailbox-reading skill to fetch the latest OTP from the real inbox.
If the current session cannot access that mailbox through the required skill, stop and report the verification blocker instead of falling back to any fake/local path.
After retrieving the real code from email, export it into `PHODEX_QA_CODE`.

Recommended login path:

```bash
export PHODEX_QA_CODE="123456"
"$ECDP" open 'https://localhost:3443/?flow=email-otp' --session phodex-qa
"$ECDP" evaluate "(() => { const input = document.querySelector('#email'); if (!input) throw new Error('email input missing'); input.value = 'qa-cdp@local.dev'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()" --session phodex-qa
"$ECDP" evaluate "(() => { const button = [...document.querySelectorAll('button')].find((item) => /Send verification code/i.test(item.textContent || '')); if (!button) throw new Error('send button missing'); button.click(); })()" --session phodex-qa
"$ECDP" wait-for-text 'Continue into relay' --timeout 10000 --session phodex-qa
"$ECDP" evaluate "(() => { const input = document.querySelector('#code'); if (!input) throw new Error('code input missing'); input.value = '$PHODEX_QA_CODE'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()" --session phodex-qa
"$ECDP" evaluate "(() => { const button = [...document.querySelectorAll('button')].find((item) => /Continue into relay/i.test(item.textContent || '')); if (!button) throw new Error('continue button missing'); button.click(); })()" --session phodex-qa
```

After login, wait for the shell to render a stable home state before taking screenshots.

## Screenshot Rules

- Always take screenshots from a real render in the hidden browser session.
- Use one screenshot per page state.
- Re-snapshot after any click that changes the page tree.
- Do not reuse a screenshot if the URL, page title, or visible heading does not match the intended state.
- Keep filenames explicit and page-specific.
- For shared-control polish passes, compare the captured result against `/Users/young/mx/tmp/phodex-web/docs/ui-design-standards.md` and explicitly check paired button heights, radius consistency, icon consistency, and helper-button sizing in the mobile viewport.

## Interaction Rules

- Prefer `snapshot` plus `click` for visible controls.
- Use `fill` for snapshot-addressable inputs.
- Use `evaluate` when a control is easier to reach by selector than by ref.
- If a click triggers a rerender, throw away old refs and snapshot again.
- If a modal appears, capture it before dismissing it.
- For sheets or dialogs with long lists, do not stop at the first visible state.
  Scroll the sheet's real internal scroller, then confirm the input field and footer CTA still remain reachable in the viewport.
- When an element is offscreen inside a nested scroller, scroll that container rather than the page root and re-check the element rects before taking the screenshot.

## Minimum Page Matrix

Capture at least these states in one acceptance pass:

- Onboarding welcome
- Onboarding features
- Onboarding step pages
- Email OTP
- Home empty
- Sidebar
- Turn empty
- Archived
- About
- Paywall

## Failure Handling

- If login fails, verify `PHODEX_QA_CODE` matches the latest emailed OTP and the session was reset first.
- If a page opens but shows the wrong state, re-open it with the correct `flow=` or `page=` query param.
- If a screenshot is blurry or clipped, re-run after checking the hidden session is still on `https://localhost:3443`.
- If a long sheet hides its input or footer actions, treat it as a real regression even if the controls exist in the DOM.
  Reproduce with the nested scroller filled, then capture both the broken and fixed state only after the real viewport path passes.
- If the app state looks stale, clear local storage again and reload.

## Recommended Output Folder

Store acceptance images under:

```bash
/Users/young/mx/tmp/phodex-web/.artifacts/qa-cdp/
```
