# Security Policy

## Supported Versions

This project is pre-release. Security fixes are handled on the current main development line unless a release branch explicitly says otherwise.

## Reporting A Vulnerability

Do not open a public issue for a vulnerability that exposes secrets, user data, authentication bypasses, bridge tokens, or local filesystem access.

Report privately to the repository maintainer using the private contact channel published with the project. Include:

- A short description of the issue.
- Reproduction steps or a proof of concept.
- Affected commit, branch, or release.
- Any known impact and suggested mitigation.

## Security Expectations

- Do not commit secrets, tokens, credentials, private keys, or production user data.
- Do not add OTP bypasses, static auth codes, or local auth lookup endpoints.
- Keep Codex and filesystem execution behind the local outbound bridge.
- Use HTTPS/WSS for public deployments.
- Rotate any credential that may have appeared in logs, screenshots, issues, or commits.
