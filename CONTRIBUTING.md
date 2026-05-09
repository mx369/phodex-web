# Contributing

Thanks for considering a contribution. Phodex Web is still evolving quickly, so small focused changes are easiest to review.

## Before You Start

- Read `docs/ai/00-start-here.md`.
- For web changes, also read `apps/web/AGENTS.md`.
- For server or bridge changes, also read `apps/server/AGENTS.md`.
- Use the current code and runtime behavior as source of truth.

## Development

Install dependencies:

```sh
bun install
```

Run the web build before submitting changes that affect the client:

```sh
bun run build:web
```

For server, relay, bridge, auth, or protocol changes, exercise the affected runtime path directly and document what was verified.

## Pull Requests

- Keep changes narrow and intentional.
- Explain behavior changes and remaining verification gaps.
- Do not include production secrets, private user data, generated credentials, or unrelated artifacts.
- Do not add fake production data, OTP bypasses, static auth codes, or unsupported success states.
