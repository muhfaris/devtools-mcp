import { Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";

export const executeQueryTool: Tool = {
  name: "execute_query",
  description:
    "Execute a read-only SQL query against the database (SELECT only by default)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description:
        'Connection name from config (e.g., "dev"). Default: first connection',
    },
    query: {
      type: "string",
      description:
        "SQL query to execute (SELECT only unless write explicitly enabled in config)",
    },
    params: {
      type: "array",
      optional: true,
      description: "Query parameters (for prepared statements)",
      default: [],
    },
    limit: {
      type: "number",
      optional: true,
      description: "Maximum number of rows to return (default: 100)",
      default: 100,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    if (!config?.database?.connections) {
      throw new Error(
        "No database connections configured in devtools.config.yaml",
      );
    }

    const connectionName =
      params.connection || Object.keys(config.database.connections)[0];
    if (!connectionName) {
      throw new Error("No database connections found in config");
    }

    const connConfig = config.database.connections[connectionName];
    if (!connConfig) {
      throw new Error(`Connection "${connectionName}" not found in config`);
    }

    // Security: Check if write is allowed
    const query = (params.query || "").trim();
    const isWrite = !/^\s*SELECT/i.test(query);

    if (isWrite) {
      const allowWrite = config.security?.execute_query?.allow_write || false;
      if (!allowWrite) {
        throw new Error(
          "Write queries are disabled by default. Set `security.execute_query.allow_write: true` in config to enable.",
        );
      }
      // Check blocked environments
      const blockedEnvs = config.security?.execute_query?.blocked_env || [
        "production",
        "prod",
      ];
      // Try to detect env from DSN or connection name
      if (
        blockedEnvs.some((env) => connectionName.toLowerCase().includes(env))
      ) {
        throw new Error(
          `Write queries are blocked on "${connectionName}" environment.`,
        );
      }
    }

    // Add LIMIT to SELECT queries if not present
    let finalQuery = query;
    if (!isWrite && !/LIMIT\s+\d+/i.test(finalQuery)) {
      const limit = Math.min(Number(params.limit) || 100, 1000);
      finalQuery = `${finalQuery} LIMIT ${limit}`;
    }

    const engine = config.database.default_engine || "postgresql";
    const provider = createProvider(engine);
    const queryParams = params.params || [];

    try {
      await provider.connect(connConfig);
      const rows = await provider.executeQuery(finalQuery, queryParams);
      await provider.disconnect();

      const result = {
        connection: connectionName,
        rows,
        rowCount: rows.length,
        truncated: rows.length === Math.min(Number(params.limit) || 100, 1000),
        query:
          finalQuery.substring(0, 200) + (finalQuery.length > 200 ? "..." : ""),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      await provider.disconnect().catch(() => {});
      throw new Error(`Query execution failed: ${error.message}`);
    }
  },
};
