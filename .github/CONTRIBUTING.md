# Contributing to Bolt

Thanks for helping Bolt become safer and friendlier. Keep changes focused, explain the user-visible effect, and preserve existing behavior unless the change intentionally revises it.

## Development flow

1. Use Node.js 20.19 or newer and install with `npm ci`.
2. Copy `.env.example` to `.env` and use development-only credentials.
3. Create a focused branch and make the smallest coherent change.
4. Add or update tests for behavior you changed.
5. Run `npm run validate` and `npm audit --omit=dev`.
6. Open a pull request describing the problem, approach, validation, and rollout concerns.

## Code expectations

- TypeScript stays strict. Avoid `any`, unchecked casts and non-null assertions where a guard is practical.
- Commands should delegate durable state and domain logic to services.
- Recheck permissions when an interaction is handled; do not trust permissions captured when UI was first shown.
- Validate input at system boundaries. Keep secrets and personal data out of logs.
- Use atomic database operations for counters and configuration updates.
- Add indexes for repeated query shapes, but avoid redundant indexes.
- Timers must be disposable during graceful shutdown and must not keep the process alive unnecessarily.

Security findings belong in the private process described in [SECURITY.md](SECURITY.md), not a public issue.

## Testing

Bolt uses Vitest for unit tests and a strict compiler/linter gate for structural safety.

```bash
npm test             # unit tests once
npm run test:watch   # focused local loop
npm run test:coverage
npm run validate     # types + lint + tests + production build
```

### What to test

- Parsers: valid boundaries, malformed input and oversized values.
- Permissions: owner/admin/moderator paths and permission revocation between UI steps.
- Services: cache miss/failure fallback and lifecycle cleanup.
- Moderation: hierarchy, self-targeting, protected bot role and partial Discord failures.
- Security boundaries: allowlists, redirects, size limits and secret-free errors.

Mock Discord and external infrastructure at the boundary. Prefer testing public behavior rather than private implementation details. A bug fix should include a regression test whenever the failing behavior can be isolated reliably.

Integration tests that need MongoDB or a Discord test guild should use dedicated disposable resources and credentials. Never point automated tests at production.

### Discord smoke tests

Many important failures happen in deterministic application logic: parsing a duration, evaluating role hierarchy, validating a URL, selecting a database transition or formatting a response. Those tests are faster and more reliable when the Discord boundary is mocked.

A real Discord connection is useful for a narrow smoke suite covering command registration, gateway delivery, interaction acknowledgement and Discord's permission behavior. Such tests require a dedicated bot and private test guild, must be explicitly invoked, and must never run against untrusted pull requests or production resources.

## Repository layout

Keep runtime code in `src/` and regression tests in `tests/`. User guides live in [bolt-docs](https://github.com/gogeta1232/bolt-docs); this repository keeps architecture and operations notes in `docs/`. Generate `docs/commands.json` with `npm run docs:export` after command changes and verify it with `npm run docs:check`. The docs site fetches this committed registry from public `main`.

The root `tsconfig.json` controls the production build. ESLint, Vitest and their supporting TypeScript configuration live in `config/`; use the npm scripts so these tools load the correct configuration. `.npmrc` restricts installation scripts, `package-lock.json` makes `npm ci` reproducible, and Prettier settings live in `package.json`. Keep design experiments, local reports and site prototypes out of the public bot repository.
