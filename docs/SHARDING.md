# Sharding and clustering

Run a single process during local development:

```bash
npm run dev
```

For a built clustered deployment:

```bash
npm run build
npm run start:cluster
```

The cluster manager reads the optional `TOTAL_SHARDS`, `SHARDS_PER_CLUSTER`, `TOTAL_CLUSTERS` and `CLUSTER_ID` environment variables. Values must be positive integers. Leave them unset unless your deployment platform assigns a topology.

Discord recommends sharding for larger bots and may require it at scale. A cluster is an operating-system process that owns one or more Discord shards. MongoDB provides the durable shared state across processes.

## Production notes

- Run `npm run db:indexes` once per release, not once per cluster.
- Give each process the same application configuration and unique platform identity.
- Terminate gracefully so shard sessions, timers and database connections close cleanly.
- Monitor the `/health` endpoint per process. It returns an unhealthy status when MongoDB is unavailable.
- Scale from observed event-loop delay, memory, REST rate limits and Discord gateway load—not only guild count.
