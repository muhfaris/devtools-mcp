import type { Config, ConnectionConfig, Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";
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
    "Show configured providers and optionally check database connection health without exposing credentials",
  params: {
    live: {
      type: "boolean",
      optional: true,
      default: false,
      description: "Check configured database connections (default: false)",
    },
  },
  execute: async (params) => {
    const config: Config = (global as any).__devtools_config || {};
    const safeConfig = getSafeConfigView(config);
    const databaseConfig = config.providers?.database ?? config.database;
    const databaseEnabled = config.providers?.database?.enabled ?? true;
    const engine = databaseConfig?.default_engine ?? null;

    const connections = await Promise.all(
      Object.entries(databaseConfig?.connections ?? {}).map(
        async ([name, connection]) => {
          const info: Record<string, unknown> = {
            name,
            engine,
            database: configuredDatabase(connection),
            default: name === Object.keys(databaseConfig?.connections ?? {})[0],
          };

          if (params.live === true && databaseEnabled && engine) {
            const provider = createProvider(engine);
            try {
              await provider.connect(connection);
              info.healthy = await provider.healthCheck();
            } catch {
              info.healthy = false;
            } finally {
              await provider.disconnect().catch(() => {});
            }
          }

          return info;
        },
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
          }
        : null,
      redis: safeConfig.redis,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
