# Testing

Bolt uses Vitest for unit tests and a strict compiler/linter gate for structural safety.

```bash
npm test             # unit tests once
npm run test:watch   # focused local loop
npm run test:coverage
npm run validate     # types + lint + tests + production build
```

## What to test

- Parsers: valid boundaries, malformed input and oversized values.
- Permissions: owner/admin/moderator paths and permission revocation between UI steps.
- Services: cache miss/failure fallback and lifecycle cleanup.
- Moderation: hierarchy, self-targeting, protected bot role and partial Discord failures.
- Security boundaries: allowlists, redirects, size limits and secret-free errors.

Mock Discord and external infrastructure at the boundary. Prefer testing public behavior rather than private implementation details. A bug fix should include a regression test whenever the failing behavior can be isolated reliably.

Integration tests that need MongoDB or a Discord test guild should use dedicated disposable resources and credentials. Never point automated tests at production.

## Does a Discord bot need Discord for every test?

No. Most important failures happen in deterministic application logic: parsing a duration, evaluating role hierarchy, validating a URL, selecting a database transition or formatting a response. Those tests are faster and more reliable when the Discord boundary is mocked.

A real Discord connection is useful for a narrow smoke suite covering command registration, gateway delivery, interaction acknowledgement and Discord's permission behavior. Such tests require a dedicated bot and private test guild, must be explicitly invoked, and must never run against untrusted pull requests or production resources.
