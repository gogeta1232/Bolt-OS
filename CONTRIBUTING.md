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
