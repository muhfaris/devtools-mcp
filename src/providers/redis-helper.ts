import type { Config } from "../core/types.js";
import { RedisProvider } from "./redis.js";

const BLOCKED_ENV_TERMS = ["production", "prod"];

const getRedisConfig = (config: Config) =>
  config.providers?.redis ?? config.redis;

const getBlockedEnvs = (config: Config): string[] =>
  config.providers?.redis?.security?.blocked_env ??
  config.security?.execute_query?.blocked_env ??
  BLOCKED_ENV_TERMS;

const assertEnabled = (config: Config) => {
  if (config.providers?.redis?.enabled === false) {
    throw new Error(
      "Redis is disabled in configuration. Enable providers.redis.enabled in .devtools/config.yaml.",
    );
  }
};

/**
 * Check whether writes are allowed on the given connection.
 * Throws an error if the connection is read-only or the environment is blocked.
 */
export const assertWriteAllowed = (
  config: Config,
  connectionName: string,
): void => {
  const redis = getRedisConfig(config);
  const connConfig = redis?.connections?.[connectionName];
  if (!connConfig) {
    throw new Error(`Redis connection "${connectionName}" not found.`);
  }

  // Layer 1: readonly flag
  if (connConfig.readonly !== false) {
    throw new Error(
      `Write operations are blocked on connection "${connectionName}". ` +
        `Set \`redis.connections.${connectionName}.readonly: false\` in devtools.config.yaml to enable writes.`,
    );
  }

  // Layer 2: blocked environment names
  const blocked = getBlockedEnvs(config);
  if (
    blocked.some((env) =>
      connectionName.toLowerCase().includes(env.toLowerCase()),
    )
  ) {
    throw new Error(
      `Write operations are blocked on "${connectionName}" — environment name matches blocked list (${blocked.join(", ")}).`,
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
