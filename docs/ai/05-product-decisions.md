# Product Decisions

This file contains durable product overrides that should be read early and treated as current truth.

## Authentication

- Do not implement QR-code login.
- Do not implement camera-based pairing.
- The only allowed login path is email verification code.
- Do not ship OTP backdoors, static bypass codes, or dev-only auth lookup endpoints.

## Security Scope

- Do not implement end-to-end encryption.
- Do not preserve upstream encryption key exchange, identity key, or encrypted envelope concepts.
- HTTPS and WSS transport are sufficient for this project.

## Reconstruction Rule

- Recreate the app's useful mobile UI and behavior, not every upstream security or pairing mechanism.
- If an upstream screen exists only to support QR pairing or E2EE, treat it as excluded scope unless the user later re-adds it.

## Real Data Rule

- This is a real product. Do not ship fake, mock, random, hardcoded, or placeholder product data in production paths.
- If a real backend signal, metric, or state is unavailable, display an explicit unavailable/unknown state, hide that surface, or document the verification gap instead of fabricating a value.

## Documentation Rule

- Future AI agents should treat these decisions as stronger than older source-audit notes that describe QR pairing or E2EE in the original app.
