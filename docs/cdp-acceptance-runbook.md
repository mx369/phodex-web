# CDP Acceptance Runbook

This runbook describes how to drive `/Users/young/mx/tmp/phodex-web` through a hidden Electron CDP session for repeatable acceptance screenshots.

It is designed around the existing `electron-cdp-automation` wrapper and the current app behavior in `apps/web/src/App.vue`, which already reads:
- `flow=` for root-flow states
- `page=` for authenticated shell pages

## What This Runbook Covers

- Clear local browser state in a hidden session
- Open `https://localhost:3443`
- Log in with `qa-cdp@local.dev` and the backdoor code `424242`
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
- `camera-permission`
- `scanner`
- `scanner-error`
- `bridge-update`
- `email-otp`

Use `page=` for authenticated shell pages:

- `settings`
- `archived`
- `about`
- `paywall`

If you need the onboarding flow, clear local state first and open `https://localhost:3443/` without a `flow=` value.

## Exact Acceptance Sequence

1. Start or reuse the hidden session.
2. Clear local state for `https://localhost:3443`.
3. Open the base app URL.
4. Capture onboarding screenshots from a clean state.
5. Open `?flow=email-otp`.
6. Log in as `qa-cdp@local.dev` using code `424242`.
7. Open `?page=settings`, `?page=archived`, `?page=about`, and `?page=paywall` as needed.
8. Use snapshot refs to click buttons that are not addressable by URL alone.
9. Re-snapshot after every rerender, modal, or navigation.
10. Save a real screenshot for each page state.

## Wrapper Commands

The wrapper already provides the primitives you need:

```bash
"$ECDP" start --session phodex-qa
"$ECDP" open https://localhost:3443 --session phodex-qa
"$ECDP" snapshot --session phodex-qa
"$ECDP" click e12 --session phodex-qa
"$ECDP" fill e5 "qa-cdp@local.dev" --session phodex-qa
"$ECDP" screenshot /Users/young/mx/tmp/phodex-web/.artifacts/qa-cdp/home.png --session phodex-qa
```

For browser-state reset, use the hidden session and clear origin storage before reloading:

```bash
"$ECDP" cdp Storage.clearDataForOrigin '{"origin":"https://localhost:3443","storageTypes":"all"}' --session phodex-qa
"$ECDP" evaluate "localStorage.clear(); sessionStorage.clear();" --session phodex-qa
```

## Login Flow

The app accepts the static backdoor code `424242` in development.

Recommended login path:

```bash
"$ECDP" open 'https://localhost:3443/?flow=email-otp' --session phodex-qa
"$ECDP" evaluate "(() => { const input = document.querySelector('#email'); if (!input) throw new Error('email input missing'); input.value = 'qa-cdp@local.dev'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()" --session phodex-qa
"$ECDP" evaluate "(() => { const button = [...document.querySelectorAll('button')].find((item) => /Send verification code/i.test(item.textContent || '')); if (!button) throw new Error('send button missing'); button.click(); })()" --session phodex-qa
"$ECDP" wait-for-text 'Continue into relay' --timeout 10000 --session phodex-qa
"$ECDP" evaluate "(() => { const input = document.querySelector('#code'); if (!input) throw new Error('code input missing'); input.value = '424242'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()" --session phodex-qa
"$ECDP" evaluate "(() => { const button = [...document.querySelectorAll('button')].find((item) => /Continue into relay/i.test(item.textContent || '')); if (!button) throw new Error('continue button missing'); button.click(); })()" --session phodex-qa
```

After login, wait for the shell to render a stable home state before taking screenshots.

## Screenshot Rules

- Always take screenshots from a real render in the hidden browser session.
- Use one screenshot per page state.
- Re-snapshot after any click that changes the page tree.
- Do not reuse a screenshot if the URL, page title, or visible heading does not match the intended state.
- Keep filenames explicit, for example:
  - `acceptance-entry-01-welcome.png`
  - `acceptance-auth-01-home-empty.png`
  - `acceptance-auth-04-settings.png`

## Interaction Rules

- Prefer `snapshot` plus `click` for visible controls.
- Use `fill` for snapshot-addressable inputs.
- Use `evaluate` when a control is easier to reach by selector than by ref.
- If a click triggers a rerender, throw away old refs and snapshot again.
- If a modal appears, capture it before dismissing it.

## Minimum Page Matrix

Capture at least these states in one acceptance pass:

- Onboarding welcome
- Onboarding features
- Onboarding step pages
- Email pairing
- Home empty
- Sidebar open
- Turn view
- Settings
- Archived chats
- About
- Paywall
- Delete dialog

## Failure Handling

- If login fails, verify the code is `424242` and the session was reset first.
- If a page opens but shows the wrong state, re-open it with the correct `flow=` or `page=` query param.
- If a screenshot is blurry or clipped, re-run after checking the hidden session is still on `https://localhost:3443`.
- If the app state looks stale, clear local storage again and reload.

## Recommended Output Folder

Store acceptance images under:

```bash
/Users/young/mx/tmp/phodex-web/.artifacts/qa-cdp/
```

