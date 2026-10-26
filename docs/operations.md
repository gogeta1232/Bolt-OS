# Operations

## Configuration and startup

Bolt requires Node.js 20.19 or newer, MongoDB and a Discord application. Copy `.env.example` to `.env` for local development and supply your own credentials. Node loads the optional working-directory `.env` before validation; host environment variables take priority. Keep credentials out of Git and logs.

```bash
npm ci
npm run dev
```

Enable the Server Members and Message Content intents in the Discord Developer Portal. Invite your application with the `bot` and `applications.commands` scopes and the permissions needed by your enabled features. See the [invite guide](https://boltdoc.vercel.app/guides/invite-permissions).

## Production releases

Run the quality gates before a release:

```bash
npm run validate
npm run docs:check
npm audit --omit=dev --audit-level=high
```

`validate` includes the production build. Review schema and index changes, verify a database backup, then apply indexes as an explicit deployment operation:

```bash
npm run db:indexes
npm start
```

MongoDB is the durable source of truth. Production startup does not automatically synchronize indexes. The index job synchronizes declared model indexes, including removals, so review its effect before running it against production. Run it once per release rather than once per cluster. Test restores as well as backups; destructive migrations must be explicit and must not run implicitly at startup.

Guild configuration uses a unique `guildId` index. Moderation queries use compound guild/user/status indexes. Greeting deletion jobs use a unique `messageId` and a `{ guildId, nextAttemptAt }` index so failed deletions remain retryable rather than expiring from storage.

## Greetings and scheduled actions

Automatic greetings use `/setgreetchannel`. Durations range from 1 second to 365 days, with a 2-second default. Pending greeting deletions and mute schedules persist in MongoDB and resume after a restart. Downtime or missing Discord permissions can delay execution.

The greeting configuration adds `GuildConfig.greetDurationMs` and the `GreetDeletion` collection. Existing configurations without a duration use the default without a data migration. Retired welcome fields and previously sent welcome messages are left untouched; no destructive cleanup runs at startup.

## Health and shutdown

The HTTP server listens on `EXPRESS_HOST` and `EXPRESS_PORT`. `GET /health` returns MongoDB readiness and process uptime. It does not confirm the Discord gateway connection; check for `Bot ready` in runtime logs when investigating an offline bot.

Allow graceful termination so Discord sessions, HTTP, database connections and schedulers close cleanly. Scheduled timers re-arm until their actual deadline and do not keep the process alive unnecessarily.

## Clustering

The single-process entry point is `npm start`. For an explicitly configured cluster deployment, use:

```bash
npm run start:cluster
```

The cluster manager reads `TOTAL_SHARDS`, `SHARDS_PER_CLUSTER`, `TOTAL_CLUSTERS` and `CLUSTER_MODE` from the validated environment configuration. Shard and cluster counts accept `auto` or positive integers where specified in `.env.example`. MongoDB provides shared durable state across processes. Choose topology from observed gateway load, memory, event-loop delay and rate limits.

## Command documentation

After changing commands, regenerate and commit the registry:

```bash
npm run docs:export
npm run docs:check
```

The output is `docs/commands.json`. The [bolt-docs repository](https://github.com/gogeta1232/bolt-docs) fetches it from public `main` through a dispatch or scheduled sync. User guides and the website belong there; no website build is required in this bot repository.
