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

## Backups and migrations

Take a verified backup before schema or index changes. Treat destructive data changes as explicit migrations; do not hide them in application startup. Test restores, not only backups.
