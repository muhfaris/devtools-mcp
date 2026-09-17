import type { Config } from "../core/types.js";
import { RedisProvider } from "./redis.js";
import {
  findBlockedEnvironment,
  isProviderEnabled,
  resolveAllowWrite,
} from "../core/security.js";

const getRedisConfig = (config: Config) =>
  config.providers?.redis ?? config.redis;

const assertEnabled = (config: Config) => {
  if (!isProviderEnabled(config, "redis")) {
    throw new Error(
      "Redis is disabled in configuration. Enable providers.redis.enabled in .devtools/config.yaml.",
    );
  }
};

/**
 * Check whether writes are allowed on the given connection.
 * Throws unless the provider grants writes and the connection name is not blocked.
 */
export const assertWriteAllowed = (
  config: Config,
  connectionName: string,
): void => {
  const redis = getRedisConfig(config);
  if (!redis?.connections?.[connectionName]) {
    throw new Error(`Redis connection "${connectionName}" not found.`);
  }

  if (!resolveAllowWrite(config, "redis")) {
    throw new Error(
      "Redis writes are disabled. Set `providers.redis.security.allow_write: true` " +
        "(or the shared `security.allow_write`) in .devtools/config.yaml to enable them.",
    );
  }

  const blockedEnv = findBlockedEnvironment(config, "redis", connectionName);
  if (blockedEnv) {
    throw new Error(
      `Write operations are blocked on "${connectionName}" — it matches the blocked_env entry "${blockedEnv}".`,
    );
  }
};

export const withRedis = async <T>(
  config: Config,
  connectionName: string | undefined,
  callback: (provider: RedisProvider, name: string) => Promise<T>,
): Promise<T> => {
  assertEnabled(config);
  const redis = getRedisConfig(config);
  if (!redis?.connections || Object.keys(redis.connections).length === 0) {
    throw new Error(
      "No Redis connections configured. Add `redis.connections` in .devtools/config.yaml.",
    );
  }

  const name =
    connectionName ||
    redis.default_connection ||
    Object.keys(redis.connections)[0];
  const connConfig = redis.connections[name];

  if (!connConfig) {
    throw new Error(
      `Redis connection "${name}" not found. Available: ${Object.keys(redis.connections).join(", ")}`,
    );
  }

  const provider = new RedisProvider();
  try {
    await provider.connect(connConfig);
    return await callback(provider, name);
  } finally {
    await provider.disconnect().catch(() => {});
  }
};

/**
 * Same as withRedis, but enforces write permissions before connecting.
 */
export const withRedisWrite = async <T>(
  config: Config,
  connectionName: string | undefined,
  callback: (provider: RedisProvider, name: string) => Promise<T>,
): Promise<T> => {
  assertEnabled(config);
  const redis = getRedisConfig(config);
  if (!redis?.connections || Object.keys(redis.connections).length === 0) {
    throw new Error("No Redis connections configured.");
  }

  const name =
    connectionName ||
    redis.default_connection ||
    Object.keys(redis.connections)[0];
  assertWriteAllowed(config, name);

  return withRedis(config, name, callback);
};
