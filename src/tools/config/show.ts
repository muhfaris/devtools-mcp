import { getCmdKeys, getConfigPath, isCmdAllowed } from "../../core/config.js";
import { getConfigRuntimeState } from "../../core/runtime-config.js";
import type {
  Config,
  ConnectionConfig,
  RedisConnectionConfig,
  Tool,
} from "../../core/types.js";
import { isProviderEnabled, resolveSecurity } from "../../core/security.js";
import { getProviderConfig } from "../../core/provider-config.js";

/**
 * The only connections an explicit `show_credentials` may unmask. Kept narrow on
 * purpose: a DSN in a tool response reaches the model's context and the transcript, and
 * `docs/Configuration.md` promises credentials are never returned.
 */
const unmaskableConnectionNames = new Set(["local", "dev", "development"]);
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

const showConnection = (
  name: string,
  connection: ConnectionConfig,
  showCredentials: boolean,
) => {
  const credentialsExposed =
    showCredentials && unmaskableConnectionNames.has(name.toLowerCase());
  return {
    dsn: credentialsExposed ? connection.dsn : sanitizeDsn(connection.dsn),
    pool_size: connection.pool_size ?? null,
    timeout: connection.timeout ?? null,
    connect_timeout: connection.connect_timeout ?? null,
    // Paths only: the certificate itself is read at connect time and never held here, so
    // reporting where it lives cannot disclose it.
    ssl: connection.ssl
      ? {
          ca: connection.ssl.ca ?? null,
          cert: connection.ssl.cert ?? null,
          key: connection.ssl.key ?? null,
          rejectUnauthorized: connection.ssl.rejectUnauthorized ?? null,
        }
      : null,
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
const showRedisConnection = (
  name: string,
  connection: RedisConnectionConfig,
  showCredentials: boolean,
) => {
  const credentialsExposed =
    showCredentials && unmaskableConnectionNames.has(name.toLowerCase());
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
    timeout: connection.timeout ?? null,
  };
};

export const getSafeConfigView = (
  config: Config = {},
  showCredentials = false,
) => {
  const db = getProviderConfig(config, "database");
  const gitlab = getProviderConfig(config, "gitlab");
  const redis = getProviderConfig(config, "redis");
  return {
    config_path: getConfigPath(),
    runtime: getConfigRuntimeState(),
    command_values: {
      enabled: isCmdAllowed(),
      values: getCmdKeys(),
    },
    id_generator: {
      default: config.id_generator?.default ?? null,
    },
    database: db
      ? {
          enabled: isProviderEnabled(config, "database"),
          default_engine: db.default_engine,
          security: resolveSecurity(config, "database"),
          connections: Object.fromEntries(
            Object.entries(db.connections || {}).map(([name, connection]) => [
              name,
              showConnection(name, connection, showCredentials),
            ]),
          ),
        }
      : null,
    gitlab: gitlab
      ? {
          enabled: isProviderEnabled(config, "gitlab"),
          url: gitlab.url || "https://gitlab.com",
          projectId: gitlab.projectId ?? null,
          security: resolveSecurity(config, "gitlab"),
          token_configured: Boolean(gitlab.token),
        }
      : null,
    redis: redis
      ? {
          enabled: isProviderEnabled(config, "redis"),
          default_connection: redis.default_connection ?? null,
          security: resolveSecurity(config, "redis"),
          connections: Object.fromEntries(
            Object.entries(redis.connections || {}).map(([name, connection]) => [
              name,
              showRedisConnection(name, connection, showCredentials),
            ]),
          ),
        }
      : null,
  };
};

export const showConfigTool: Tool = {
  name: "show_config",
  description:
    "Show the effective runtime configuration and reload status with credentials masked",
  params: {
    show_credentials: {
      type: "boolean",
      optional: true,
      default: false,
      description:
        "Return database DSNs and Redis URLs unmasked for connections named local, dev, or development. Off by default: those values enter the model's context and the transcript. Every other connection stays sanitized either way.",
    },
  },
  execute: async (params) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          getSafeConfigView(
            (global as any).__devtools_config || {},
            params?.show_credentials === true,
          ),
          null,
          2,
        ),
      },
    ],
  }),
};
