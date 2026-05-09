# Phodex Web

[中文 README](README.zh-CN.md)

Phodex Web is a Bun monorepo that recreates the Remodex-style mobile experience for Codex on the web. It provides a public web relay, email OTP sign-in, and a local outbound bridge that connects the browser session to a real local Codex app-server.

This project is source-driven and still under active reconstruction. The current code is useful for development, experimentation, and self-hosting, but it is not a finished product.

## What Works

- Email OTP authentication through the relay.
- Public HTTP and websocket relay for the web client.
- Local outbound bridge for Codex app-server integration.
- Chat creation, thread listing, message send, streaming responses, stop, rename, archive, queued drafts, and draft resume.
- Lazy project browsing and selected-thread history hydration.

## Current Limits

- Visual and interaction parity is incomplete.
- Purchase and restore flows are preview-only.
- Rich turn surfaces and structured input replacement are partial.
- QR login, camera pairing, and end-to-end encryption are intentionally out of scope.

## Repository Layout

```text
apps/web        Vue 3 + Vite mobile web client
apps/server     Bun relay and local Codex bridge runtimes
packages/shared Shared protocol and record types
docs/ai         Project context, architecture notes, and verification guidance
```

## Requirements

- Bun `1.3.13` or compatible.
- A running Codex app-server for bridge-backed local operation.
- Email delivery credentials for OTP sign-in when running the public relay.

## Setup

Install dependencies:

```sh
bun install
```

Start the web client:

```sh
bun run dev:web
```

Start the public relay:

```sh
bun run dev:relay
```

Start the local bridge:

```sh
bun run dev:bridge
```

Build the web client:

```sh
bun run build:web
```

## Configuration

The relay reads OTP mail configuration from environment variables:

```sh
PHODEX_RESEND_API_KEY=...
PHODEX_AUTH_EMAIL_FROM=...
```

The server also accepts the shorter fallback names `RESEND_API_KEY` and `AUTH_EMAIL_FROM`. Keep secrets in environment variables or untracked secret files. Do not commit API keys, session tokens, bridge tokens, or production credentials.

Use [.env.example](.env.example) as a reference for local relay and bridge settings. Values in that file are examples only; leave secrets empty until you provide them through your own environment.

## Development Notes

- Use the current code and runtime behavior as source of truth.
- Keep the local bridge outbound; public relay code should not execute local filesystem work.
- Do not add OTP bypasses, static test codes, or fake production data.
- Preserve the product constraints documented in `docs/ai`.

## Acknowledgements

This project references and learns from upstream projects and ecosystems, especially:

- [Remodex](https://github.com/Emanuele-web04/remodex) (the primary upstream reference for source behavior and UI reconstruction targets)
- Codex and related app-server workflows
- Bun, Vue, Vite, and Resend

Thanks to the upstream maintainers and contributors for their public work and documentation.

## License

MIT. See [LICENSE](LICENSE).

## Notices

See [NOTICE.md](NOTICE.md) for project status, trademark, affiliation, and security statements.
