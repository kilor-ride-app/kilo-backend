import { RedisOptions } from 'ioredis';

// Turns a REDIS_URL connection string (redis:// or rediss://, e.g. Railway's
// managed Redis) into a plain ioredis RedisOptions object rather than a
// live client — BullMQ only auto-sets the required maxRetriesPerRequest:
// null for Worker/blocking commands when given options, not an already
// -constructed client (see bullmq's RedisConnection constructor).
export function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
  };
}
