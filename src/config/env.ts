import { z } from 'zod';

const autoOrPositiveInteger = z.union([z.literal('auto'), z.coerce.number().int().positive()]);

const shardList = z
  .string()
  .default('auto')
  .transform((value, context) => {
    if (value === 'auto') return value;

    const shards = value.split(',').map((shard) => Number.parseInt(shard.trim(), 10));
    if (shards.length === 0 || shards.some((shard) => !Number.isInteger(shard) || shard < 0)) {
      context.addIssue({ code: 'custom', message: 'SHARDS must be "auto" or comma-separated non-negative integers' });
      return z.NEVER;
    }

    return [...new Set(shards)];
  });

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(20),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'DISCORD_CLIENT_ID must be a Discord snowflake'),
  MONGO_URI: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'MONGO_URI must use mongodb:// or mongodb+srv://'
    ),
  DEFAULT_PREFIX: z.string().trim().min(1).max(5).default('!'),
  EXPRESS_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  EXPRESS_HOST: z.ipv4().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default(process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
  SHARDS: shardList,
  TOTAL_SHARDS: autoOrPositiveInteger.default('auto'),
  SHARDS_PER_CLUSTER: z.coerce.number().int().min(1).max(32).default(5),
  TOTAL_CLUSTERS: autoOrPositiveInteger.default('auto'),
  CLUSTER_MODE: z.enum(['process', 'worker']).default('process'),
  CLUSTER_HEARTBEAT_INTERVAL: z.coerce.number().int().min(500).default(2000),
  CLUSTER_HEARTBEAT_MAX_MISSED: z.coerce.number().int().min(1).default(5),
  CLUSTER_RESPAWN_MAX: z.coerce.number().int().min(1).default(5),
  CLUSTER_RESPAWN_INTERVAL: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60 * 60 * 1000)
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.flatten().fieldErrors;
  console.error('Invalid environment configuration', formatted);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
