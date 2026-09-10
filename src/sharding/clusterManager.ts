import 'dotenv/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClusterManager, HeartbeatManager, ReClusterManager } from 'discord-hybrid-sharding';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Hybrid Sharding ClusterManager entry point.
 *
 * Run via: `node dist/sharding/clusterManager.js` (production) or `tsx src/sharding/clusterManager.ts` (dev).
 * This spawns N cluster processes, each hosting shardsPerClusters internal shards.
 *
 * Memory efficiency (big-bot learnings):
 * - idle process ≈ 200 MB. Naive 600 shards = 600 * 200 MB = 120 GB.
 * - Hybrid shardsPerClusters=5 on 600 shards → 120 clusters → ~24 GB + shared heap → 40-60% saving measured.
 * - Tune shardsPerClusters (2-10) for your host: higher = more saving, less isolation.
 * - totalShards: 'auto' fetches recommended from Discord (guilds/1000). Override via env TOTAL_SHARDS.
 * - totalClusters: 'auto' = ceil(totalShards / shardsPerClusters). Override via env TOTAL_CLUSTERS.
 *
 * Zero-downtime reclustering: `manager.recluster.start({ restartMode: 'gracefulSwitch' })`
 * Heartbeat: auto-respawns unresponsive clusters.
 *
 * Dev fallback: if you run `npm run dev` (src/index.ts directly), bot runs single-process
 * with env.SHARDS. No ClusterManager required. This file is optional in development.
 */

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = dirname(dirname(dirname(currentFile)));

// Resolve bot entry file. In dev it's tsx src/index.ts, in prod it's dist/index.js.
// ClusterManager expects a file path that Node can execute. For ESM, point to compiled JS in prod.
// When running via tsx, __filename points to src/sharding/clusterManager.ts → resolve to src/index.ts.
// Heuristic: compiled files end with .js; source files end with .ts.
const isCompiled = currentFile.endsWith('.js');
const botFile = isCompiled ? resolve(projectRoot, 'dist', 'index.js') : resolve(projectRoot, 'src', 'index.ts');

// Prefer explicit TOTAL_SHARDS env over legacy SHARDS. Support both.
// env.SHARDS is 'auto' | number[]. TOTAL_SHARDS is 'auto' | number | undefined.
const legacyShards = env.SHARDS;
const totalShardsOption: number | 'auto' =
  env.TOTAL_SHARDS !== undefined
    ? (env.TOTAL_SHARDS as number | 'auto')
    : legacyShards === 'auto'
      ? 'auto'
      : Array.isArray(legacyShards)
        ? legacyShards.length || 'auto'
        : 'auto';

const totalClustersOption: number | 'auto' = env.TOTAL_CLUSTERS as number | 'auto';
const shardsPerClusters = env.SHARDS_PER_CLUSTER;

const manager = new ClusterManager(botFile, {
  totalShards: totalShardsOption,
  totalClusters: totalClustersOption,
  shardsPerClusters,
  mode: env.CLUSTER_MODE,
  token: env.DISCORD_TOKEN,
  restarts: {
    max: env.CLUSTER_RESPAWN_MAX,
    interval: env.CLUSTER_RESPAWN_INTERVAL
  }
});

// Plugins — opt-in but recommended for large bots
manager.extend(
  new HeartbeatManager({
    interval: env.CLUSTER_HEARTBEAT_INTERVAL,
    maxMissedHeartbeats: env.CLUSTER_HEARTBEAT_MAX_MISSED
  }),
  new ReClusterManager()
);

// Logging
manager.on('clusterCreate', (cluster) => {
  logger.info({ clusterId: cluster.id, shards: cluster.shardList }, `Launched Cluster ${cluster.id}`);
  cluster.on('message', (message) => {
    // IPC custom messages from bot clusters
    logger.debug({ clusterId: cluster.id, message }, 'Cluster message');
  });
  cluster.on('death', () => logger.warn({ clusterId: cluster.id }, `Cluster ${cluster.id} died`));
  cluster.on('error', (error) => logger.error({ err: error, clusterId: cluster.id }, 'Cluster error'));
  cluster.on('spawn', () => logger.info({ clusterId: cluster.id }, `Cluster ${cluster.id} spawned`));
});

manager.on('clusterReady', (cluster) => {
  logger.info({ clusterId: cluster.id }, `Cluster ${cluster.id} ready`);
});

manager.on('debug', (message) => logger.debug({ manager: true }, message));

// Spawn — queue auto manages concurrency respecting Discord identify rate limits (1 per 5s)
await manager.spawn({ timeout: -1 });

logger.info(
  {
    totalShards: manager.totalShards,
    totalClusters: manager.totalClusters,
    shardsPerClusters: manager.shardsPerClusters,
    mode: manager.mode,
    botFile
  },
  'ClusterManager spawned'
);

// Graceful shutdown of manager + clusters
const shutdown = async () => {
  logger.info('ClusterManager shutting down...');
  for (const cluster of manager.clusters.values()) {
    try {
      cluster.kill({ reason: 'Manager shutdown', force: false });
    } catch (error) {
      logger.error({ err: error, clusterId: cluster.id }, 'Error killing cluster during shutdown');
    }
  }
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

// Optional: expose manager for evalOnManager / IPC
// Example from a cluster: `client.cluster.evalOnManager(m => m.totalShards)`

export { manager };
