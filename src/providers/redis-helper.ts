import type { Config } from "../core/types.js";
import { RedisProvider } from "./redis.js";
import { getProviderConfig } from "../core/provider-config.js";
import { isProviderEnabled, resolveConnectionWrite } from "../core/security.js";

const getRedisConfig = (config: Config) => getProviderConfig(config, "redis");

const assertEnabled = (config: Config) => {
  if (!isProviderEnabled(config, "redis")) {
    throw new Error(
      "Redis is disabled in configuration. Enable providers.redis.enabled in .devtools/config.yaml.",
    );
  }
};

/**
 * Check whether writes are allowed on the given connection, and refuse with the rule that
 * refused it: a grant that does not exist and a connection marked `readonly` are fixed in
 * two different places.
 */
export const assertWriteAllowed = (
  config: Config,
  connectionName: string,
): void => {
  const redis = getRedisConfig(config);
  const connection = redis?.connections?.[connectionName];
  if (!connection) {
    throw new Error(`Redis connection "${connectionName}" not found.`);
  }

  const policy = resolveConnectionWrite(
    config,
    "redis",
    connectionName,
    connection.readonly,
  );
  if (policy.can_write) return;

  const reason = policy.denied_by[0];
  if (reason === "connection_readonly") {
    throw new Error(
      `Connection "${connectionName}" is readonly: true in .devtools/config.yaml, ` +
        "so writes are refused here regardless of any allow_write grant. Remove the flag if it was not meant to be a guard.",
    );
  }
  if (reason === "environment_blocked") {
    throw new Error(
      `Write operations are blocked on "${connectionName}" — it matches the blocked_env entry "${policy.detail}".`,
    );
  }

  throw new Error(
    "Redis writes are disabled. Set `providers.redis.security.allow_write: true` " +
      "(or the shared `security.allow_write`) in .devtools/config.yaml to enable them.",
  );
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
