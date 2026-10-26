# Database operations

MongoDB is Bolt's durable source of truth.

## Connections

The application uses a bounded MongoDB pool and finite selection/socket timeouts. Development enables automatic index creation for convenience. Production disables it to keep startup predictable.

Run this during deployment after updating the application and before shifting traffic:

```bash
npm run db:indexes
```

This synchronizes the indexes declared in every registered model. Review removed indexes before running against a large production collection, because index deletion or construction can be operationally expensive.

## Query design

- Guild configuration is fetched by unique `guildId` and cached with a bounded TTL.
- Moderation indexes start with guild and user/status fields used by case, warning and mute lookups.
- Redundant single-field indexes are intentionally avoided when a compound index already serves the same prefix.
- Greeting deletion jobs use unique `messageId` and compound `{ guildId, nextAttemptAt }` indexes for idempotent completion and per-process due-job queries. They retain failed deletions for retry rather than using TTL expiry, which would lose the Discord cleanup operation.

## Backups and migrations

Take a verified backup before schema or index changes. Treat destructive data changes as explicit migrations; do not hide them in application startup. Test restores, not only backups.

The configurable greeting update adds `GuildConfig.greetDurationMs` and the `GreetDeletion` collection. Missing durations use 2 seconds without a data migration. Legacy `welcome` fields are no longer read or written; no startup job removes those fields or previously sent welcome messages. Run `npm run db:indexes` explicitly with the updated code before shifting production traffic; it includes the new greeting model.
