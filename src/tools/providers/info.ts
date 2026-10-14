import type { Config, ConnectionConfig, Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";
import { RedisProvider } from "../../providers/redis.js";
import { getProviderConfig } from "../../core/provider-config.js";
import { isProviderEnabled } from "../../core/security.js";
import {
  classifyConnectionError,
  healthProbeFailure,
} from "../../core/connect-error.js";
import { getSafeConfigView } from "../config/show.js";

const configuredDatabase = (connection: ConnectionConfig): string | null => {
  try {
    const pathname = new URL(connection.dsn).pathname.replace(/^\//, "");
    return pathname || null;
  } catch {
    return null;
  }
};

export const providersInfoTool: Tool = {
  name: "providers_info",
  description:
    "Show configured providers and optionally check database and Redis connection health without exposing credentials",
  params: {
    live: {
      type: "boolean",
      optional: true,
      default: false,
      description:
        "Check every configured database and Redis connection (default: false). GitLab is never contacted.",
    },
  },
  execute: async (params) => {
    const config: Config = (global as any).__devtools_config || {};
    const safeConfig = getSafeConfigView(config);
    const databaseConfig = getProviderConfig(config, "database");
    const databaseEnabled = isProviderEnabled(config, "database");
    const engine = databaseConfig?.default_engine ?? null;
    const redisConfig = getProviderConfig(config, "redis");
    const redisEnabled = isProviderEnabled(config, "redis");
    const live = params.live === true;

    const connections = await Promise.all(
      Object.entries(databaseConfig?.connections ?? {}).map(
        async ([name, connection]) => {
          // `checked` records whether a probe ran at all, so an absent `healthy` can no
          // longer be read as either "fine" or "never asked".
          const info: Record<string, unknown> = {
            name,
            engine,
            database: configuredDatabase(connection),
            default: name === Object.keys(databaseConfig?.connections ?? {})[0],
            checked: live && databaseEnabled && Boolean(engine),
          };

          if (live && databaseEnabled && engine) {
            const provider = createProvider(engine);
            try {
              await provider.connect(connection);
              const healthy = await provider.healthCheck();
              info.healthy = healthy;
              if (!healthy) info.failure = healthProbeFailure();
            } catch (error) {
              info.healthy = false;
              // Classified, never echoed. A driver's own message is whatever it was
              // handed, which for a failed connection is close to the DSN itself.
              info.failure = classifyConnectionError(error);
            } finally {
              await provider.disconnect().catch(() => {});
            }
          }

          return info;
        },
      ),
    );

    // Redis is probed connection by connection, so one unreachable server reports
    // `healthy: false` instead of failing the whole response.
    const redisConnections = Object.fromEntries(
      await Promise.all(
        Object.entries(safeConfig.redis?.connections ?? {}).map(
          async ([name, safeConnection]): Promise<
            [string, Record<string, unknown>]
          > => {
            const rawConnection = redisConfig?.connections?.[name];
            if (!live || !redisEnabled || !rawConnection) {
              return [name, { ...safeConnection, checked: false }];
            }

            const provider = new RedisProvider();
            let healthy = false;
            try {
              await provider.connect(rawConnection);
              healthy = await provider.healthCheck();
              if (!healthy) {
                return [
                  name,
                  {
                    ...safeConnection,
                    checked: true,
                    healthy,
                    failure: healthProbeFailure(),
                  },
                ];
              }
            } catch (error) {
              return [
                name,
                {
                  ...safeConnection,
                  checked: true,
                  healthy: false,
                  failure: classifyConnectionError(error),
                },
              ];
            } finally {
              await provider.disconnect().catch(() => {});
            }

            return [name, { ...safeConnection, checked: true, healthy }];
          },
        ),
      ),
    );

    const result = {
      database: databaseConfig
        ? {
            enabled: databaseEnabled,
            default_engine: engine,
            connections,
          }
        : null,
      gitlab: safeConfig.gitlab
        ? {
            enabled: safeConfig.gitlab.enabled,
            token_configured: safeConfig.gitlab.token_configured,
            // Spelled out so the report never implies GitLab was probed.
            checked: false,
          }
        : null,
      redis: safeConfig.redis
        ? { ...safeConfig.redis, connections: redisConnections }
        : null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
