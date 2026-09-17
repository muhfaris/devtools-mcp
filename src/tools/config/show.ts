import { getConfigPath } from "../../core/config.js";
import { getConfigRuntimeState } from "../../core/runtime-config.js";
import type {
  Config,
  ConnectionConfig,
  RedisConnectionConfig,
  Tool,
} from "../../core/types.js";
import {
  isProviderEnabled,
  resolveAllowWrite,
  resolveBlockedEnvs,
  type SecurityProvider,
} from "../../core/security.js";

const developmentConnectionNames = new Set(["local", "dev", "development"]);
const sensitiveQueryKeys =
  /^(password|pass|pwd|token|access[_-]?token|secret|api[_-]?key|private[_-]?key|sslkey)$/i;

const sanitizeDsn = (dsn: string): string => {
  try {
    const url = new URL(dsn);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    for (const key of url.searchParams.keys()) {
      if (sensitiveQueryKeys.test(key)) url.searchParams.set(key, "***");
    }
    return url.toString();
  } catch {
    return "***";
  }
};

const showConnection = (name: string, connection: ConnectionConfig) => {
  const credentialsExposed = developmentConnectionNames.has(name.toLowerCase());
  return {
    dsn: credentialsExposed ? connection.dsn : sanitizeDsn(connection.dsn),
    readonly: connection.readonly,
    pool_size: connection.pool_size ?? null,
    timeout: connection.timeout ?? null,
    credentials_exposed: credentialsExposed,
  };
};

/** True when the URL itself carries AUTH credentials (redis://user:pass@host). */
const urlHasCredentials = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
};

/**
 * Describe a Redis connection without leaking any credential.
 * Sentinel host:port pairs are safe to show; passwords and usernames never are.
 */
const showRedisConnection = (name: string, connection: RedisConnectionConfig) => {
  const credentialsExposed = developmentConnectionNames.has(name.toLowerCase());
  const sentinels = connection.sentinels ?? [];
  const isSentinel = sentinels.length > 0;

  return {
    mode: isSentinel ? "sentinel" : "standalone",
    url:
      connection.url && !isSentinel
        ? credentialsExposed
          ? connection.url
          : sanitizeDsn(connection.url)
        : null,
    sentinels: isSentinel
      ? sentinels.map((node) => `${node.host}:${node.port ?? 26379}`)
      : [],
    master_name: isSentinel ? (connection.master_name ?? null) : null,
    role: isSentinel ? (connection.role ?? "master") : null,
    sentinel_tls: isSentinel ? Boolean(connection.sentinel_tls) : null,
    auth_configured:
      Boolean(connection.password || connection.username) ||
      urlHasCredentials(connection.url),
    sentinel_auth_configured: Boolean(
      connection.sentinel_password || connection.sentinel_username,
    ),
    db: connection.db ?? null,
    readonly: connection.readonly ?? true,
    timeout: connection.timeout ?? null,
  };
};

/**
 * Effective security settings for a provider, so the resolved gates can be inspected
 * without re-deriving the precedence chains by hand.
 */
const showProviderSecurity = (config: Config, provider: SecurityProvider) => ({
  allow_write: resolveAllowWrite(config, provider),
  blocked_env: resolveBlockedEnvs(config, provider),
});

export const getSafeConfigView = (config: Config = {}) => {
  const db = config.providers?.database ?? config.database;
  const gitlab = config.providers?.gitlab ?? config.gitlab;
  const redis = config.providers?.redis ?? config.redis;
  return {
    config_path: getConfigPath(),
    runtime: getConfigRuntimeState(),
    id_generator: {
      default: config.id_generator?.default ?? null,
    },
    database: db
      ? {
          enabled: isProviderEnabled(config, "database"),
          default_engine: db.default_engine,
          security: showProviderSecurity(config, "database"),
          connections: Object.fromEntries(
            Object.entries(db.connections || {}).map(([name, connection]) => [
              name,
              showConnection(name, connection),
            ]),
          ),
        }
      : null,
    gitlab: gitlab
      ? {
          enabled: isProviderEnabled(config, "gitlab"),
          url: gitlab.url || "https://gitlab.com",
          projectId: gitlab.projectId ?? null,
          security: showProviderSecurity(config, "gitlab"),
          token_configured: Boolean(gitlab.token),
        }
      : null,
    redis: redis
      ? {
          enabled: isProviderEnabled(config, "redis"),
          default_connection: redis.default_connection ?? null,
          security: showProviderSecurity(config, "redis"),
          connections: Object.fromEntries(
            Object.entries(redis.connections || {}).map(([name, connection]) => [
              name,
              showRedisConnection(name, connection),
            ]),
          ),
        }
      : null,
    // Legacy aggregate view, kept for clients that predate the per-provider blocks.
    security: {
      execute_query: {
        allow_write: resolveAllowWrite(config, "database"),
        blocked_env: resolveBlockedEnvs(config, "database"),
      },
    },
  };
};

export const showConfigTool: Tool = {
  name: "show_config",
  description:
    "Show the effective runtime configuration and reload status without exposing non-development credentials",
  execute: async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          getSafeConfigView((global as any).__devtools_config || {}),
          null,
          2,
        ),
      },
    ],
  }),
};
