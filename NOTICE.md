# Notices

## Project Status

Phodex Web is under active development. Some flows are production-backed, while visual parity, purchases, rich turn rendering, and several source-app interactions remain incomplete. Treat this repository as an evolving implementation unless a specific release states otherwise.

## Affiliation

This project is independently maintained. It is not affiliated with, endorsed by, or sponsored by OpenAI or the maintainers of Codex, Remodex, Bun, Vue, Vite, or Resend.

Product names, service names, trademarks, and logos belong to their respective owners. References to those names are for identification and interoperability only.

## Upstream Reference

This repository is a source-driven reconstruction project. It references upstream behaviors, interfaces, and documentation to improve compatibility and developer experience.

Primary upstream reference:
- Remodex: https://github.com/Emanuele-web04/remodex

We appreciate the work of upstream maintainers and contributors. This acknowledgement does not imply partnership, endorsement, or trademark license beyond nominative use.

## Security And Secrets

This repository must not contain production secrets, API keys, session tokens, bridge tokens, private certificates, or user data. Configure deployments through environment variables, secret managers, or untracked local files.

The local bridge is designed to connect outward from a user's machine to a relay. Do not expose local filesystem or Codex execution capabilities directly on a public relay.

## Data And Availability

The software is provided as-is under the MIT License. Operators are responsible for their own deployments, authentication setup, backups, monitoring, and compliance obligations.
