import { getConfigPath } from "../../core/config.js";
import { getConfigRuntimeState } from "../../core/runtime-config.js";
import type { Config, ConnectionConfig, Tool } from "../../core/types.js";

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

export const getSafeConfigView = (config: Config = {}) => {
  const db = config.providers?.database ?? config.database;
  const gitlab = config.providers?.gitlab ?? config.gitlab;
  const redis = config.providers?.redis ?? config.redis;
  return {
    config_path: getConfigPath(),
    runtime: getConfigRuntimeState(),
    database: db
      ? {
          enabled: config.providers?.database?.enabled ?? true,
          default_engine: db.default_engine,
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
          enabled: config.providers?.gitlab?.enabled ?? true,
          url: gitlab.url || "https://gitlab.com",
          projectId: gitlab.projectId ?? null,
          token_configured: Boolean(gitlab.token),
        }
      : null,
    redis: redis
      ? {
          enabled: config.providers?.redis?.enabled ?? true,
          default_connection: redis.default_connection ?? null,
          connections: Object.keys(redis.connections || {}),
        }
      : null,
    security: {
      execute_query: {
        allow_write:
          config.providers?.database?.security?.allow_write ??
          config.security?.execute_query?.allow_write ??
          false,
        blocked_env:
          config.providers?.database?.security?.blocked_env ??
          config.security?.execute_query?.blocked_env ??
          ["production", "prod"],
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
