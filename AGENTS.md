# Bolt Agent Rules

These instructions apply to every file in this repository. They are mandatory for automated coding agents and should also guide human contributions. More specific `AGENTS.md` files may add constraints for a subtree but must not weaken these rules.

## Project contract

Bolt is a production Discord moderation bot built with TypeScript, Sapphire, discord.js and MongoDB. Preserve existing user-visible behavior unless the task explicitly changes it. Security, moderation correctness and data integrity take priority over convenience or cleverness.

The repository is licensed under Elastic License 2.0. Do not remove or weaken license, copyright, security or attribution notices.

## Required workflow

1. Read the relevant command, handler, service, model, tests and configuration before editing.
2. Check `git status` and preserve unrelated work. Never discard user changes.
3. Make the smallest coherent change that solves the root cause.
4. Add or update regression tests for changed behavior whenever practical.
5. Run the required quality gates before declaring completion.
6. Summarize behavior changes, validation and any remaining risk accurately.

Do not commit, push, publish, deploy, rotate credentials, modify production data or contact users unless the user explicitly requests that action.

## Non-negotiable quality gates

Before a change is ready, run:

```bash
npm run format:check
npm run check
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Use `npm run validate` for the combined type, lint, test and build gate. Do not bypass failures, weaken configuration, delete a failing test or add blanket suppression merely to make a gate pass. If a gate cannot run because external infrastructure is unavailable, report that limitation explicitly.

## TypeScript rules

- Keep all strict compiler options enabled.
- Do not introduce `any`. Use `unknown`, generics or a precise interface and narrow at the boundary.
- Do not use `@ts-ignore`, `@ts-nocheck` or broad ESLint disables.
- Avoid non-null assertions and unsafe casts. Guard optional values and indexed access.
- Public service and boundary functions need explicit, meaningful return types.
- Validate environment variables and external payloads before use.
- Prefer immutable data and pure helpers where practical.
- Remove dead exports, imports, branches and dependencies instead of preserving speculative code.
- Never duplicate third-party types through local module augmentation when the library exposes an official type.

## Sapphire and Discord rules

- Keep Sapphire pieces in the correct lowercase store directory under `src/`.
- Commands, listeners, preconditions and interaction handlers must follow the existing piece lifecycle.
- Use explicit unique names for interaction handlers that could collide by filename.
- Register application commands through `registerApplicationCommands`; do not make direct REST registration calls from commands.
- Every accepted interaction must reply, update or defer within Discord's deadline on every path.
- Recheck the actor's current guild membership, permissions, configured roles and role hierarchy when the action executes. Never trust authorization captured when a menu or modal was first shown.
- Centralize reusable authorization in preconditions or permission helpers.
- Do not create a second listener or handler for behavior already owned by an existing piece.
- Request only intents and Discord permissions required by implemented features.
- Use `allowedMentions` for user-controlled output. Never allow accidental `@everyone`, `@here` or arbitrary role pings.
- Treat Discord API calls as fallible. Handle missing guilds, channels, members, partial objects, rate limits and deleted resources.
- Durable moderation state must survive reconnects and restarts.

## Security rules

- Never read secrets into logs, responses, snapshots, fixtures or committed files.
- `.env` must remain ignored. Only placeholder values belong in `.env.example`.
- Treat custom IDs, modal fields, command arguments, URLs, attachments and database documents as untrusted input.
- Prevent SSRF: server-side downloads require HTTPS, an exact trusted-host allowlist, redirect revalidation, a timeout, content-type validation and a streaming byte limit.
- Use cryptographically secure randomness for security-sensitive identifiers.
- Do not disable TLS certificate validation.
- Do not expose stack traces, tokens, database URLs or internal topology to Discord users or health endpoints.
- Apply least privilege to bot permissions, database users and deployment credentials.
- Do not publish vulnerability details before a fix is available; follow `SECURITY.md`.

## Database and cache rules

- MongoDB is the source of truth. Do not add a cache service without a measured need and a correctness-preserving fallback.
- Use atomic operations for counters, upserts, state transitions and concurrent configuration changes.
- Every repeated production query must have an intentional index. Avoid redundant indexes when a compound prefix serves the query.
- Do not enable automatic production index synchronization at application startup. Use `npm run db:indexes` as an explicit deployment operation.
- Bound every in-memory cache by size and lifetime. Provide invalidation after writes and guild removal.
- Avoid N+1 queries and repeated full-guild member fetches.
- Never perform destructive migrations implicitly. Document migrations and require a verified backup.

## Performance and lifecycle rules

- Measure before claiming a performance improvement.
- Avoid unbounded collections, recursive retries, busy polling and unlimited concurrency.
- Respect Discord pagination and rate limits; cursor-dependent pages cannot be fetched speculatively in parallel.
- Stream bounded remote bodies instead of buffering unlimited content.
- Timers longer than JavaScript's maximum delay must re-arm until the real deadline; they must never execute early.
- Background timers must be disposable, idempotently initialized and `unref`'d when they should not keep the process alive.
- Register shutdown cleanup for Discord, HTTP, MongoDB, schedulers and caches.
- Do not add a dependency when a small, well-tested platform API solution is sufficient.

## Testing strategy

Most Discord bot logic does not require a live Discord connection to test meaningfully.

- **Unit tests:** parsers, permission decisions, hierarchy rules, formatters, URL validation and pure command decisions. Mock only the Discord boundary.
- **Integration tests:** services, MongoDB models, schedulers and command-to-service behavior using disposable infrastructure or controlled fakes.
- **Live smoke tests:** a small, explicitly invoked suite using a dedicated bot and private test guild. Use it only for behavior that Discord itself must confirm, such as command registration, gateway events, permissions and interaction acknowledgement.

Never use a production bot token, production guild or production database in automated tests. Live tests must be opt-in, skip safely without dedicated credentials, clean up created resources and never run on untrusted pull requests. An empty test configuration is not a test suite and should not be kept.

Test externally visible behavior rather than private implementation details. Bug fixes should include a regression test when the failure can be isolated reliably.

## Structure and ownership

- `src/commands/`: translate Discord input and delegate domain work.
- `src/interaction-handlers/`: buttons, menus, modals and autocomplete.
- `src/listeners/`: event translation and lightweight orchestration.
- `src/services/`: reusable domain and infrastructure behavior with explicit lifecycle methods.
- `src/database/models/`: schemas, validation and indexes.
- `src/lib/`: shared stateless helpers and small infrastructure primitives.
- `src/setup/`: dependency construction and startup order.
- `src/scripts/`: explicit operational jobs that are not application startup behavior.
- `tests/unit/`: isolated deterministic tests.
- `tests/integration/`: disposable-infrastructure tests when added.
- `tests/live/`: optional dedicated-guild smoke tests when added.

Do not put business logic in Discord listeners, global singletons or database model hooks when a typed service is the correct owner.

## Documentation and dependency hygiene

- Update README and operational documentation when setup, environment variables, scripts, architecture or deployment behavior changes.
- Keep examples runnable and use placeholders for credentials and IDs.
- Pin critical runtime dependencies deliberately and review changelogs before upgrades.
- Remove unused direct dependencies and run the full test/build gate after lockfile changes.
- Keep `package.json` scripts real; do not retain scripts or configuration for nonexistent files.
- Do not claim the project is secure, complete, optimized or fully tested without evidence.
