import { Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";
import { ToolError } from "../../core/errors.js";
import {
  isProviderEnabled,
  resolveConnectionWrite,
} from "../../core/security.js";
import { getProviderConfig } from "../../core/provider-config.js";
import {
  databaseRequestError,
  databaseWriteRefused,
  requireDatabaseConnection,
  requireQuery,
} from "./errors.js";
import { classifyStatement } from "./statement.js";

export const executeQueryTool: Tool = {
  name: "execute_query",
  description:
    "Execute a SQL statement against a configured database connection. A statement that is not a read runs only when every guard allows it: the provider grants writes (security.allow_write), the connection is not `readonly: true`, and its name does not match blocked_env. A readonly connection also opens its session read-only, so a write fails at the server even if it is not recognised here.",
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
        "SQL statement to execute. Reads run anywhere; writes need the provider's allow_write grant and a connection that is neither `readonly: true` nor blocked by blocked_env.",
    },
    params: {
      type: "array",
      optional: true,
      description: "Query parameters (for prepared statements)",
      default: [],
      items: {},
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
    const db = getProviderConfig(config, "database");
    if (!isProviderEnabled(config, "database")) {
      throw new ToolError(
        "DATABASE_DISABLED",
        "Database provider is disabled in configuration.",
        "Enable providers.database.enabled in .devtools/config.yaml, then retry this tool.",
        true,
        { configKey: "providers.database.enabled" },
      );
    }
    const { connectionName, connection: connConfig } =
      requireDatabaseConnection(config, params.connection);

    // Security: classify the statement, then let one resolver decide. The previous test
    // was "does it start with SELECT", which a leading `WITH` defeated.
    const query = requireQuery(params.query);
    const isWrite = classifyStatement(query) === "write";

    if (isWrite) {
      // The connection name is the environment signal for `blocked_env`, while
      // `readonly: true` is the connection's own word; both are decided in one place so
      // this gate and `show_config` cannot describe the policy differently.
      const policy = resolveConnectionWrite(
        config,
        "database",
        connectionName,
        connConfig.readonly,
      );
      if (!policy.can_write) {
        throw databaseWriteRefused(policy, connectionName);
      }
    }

    // Remove trailing statement terminators before appending clauses.
    let finalQuery = query.replace(/;+\s*$/, "");
    if (!isWrite && !/LIMIT\s+\d+/i.test(finalQuery)) {
      const limit = Math.min(Number(params.limit) || 100, 1000);
      finalQuery = `${finalQuery} LIMIT ${limit}`;
    }

    const engine = db?.default_engine || "postgresql";
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
      throw databaseRequestError("execute the query", error);
    }
  },
};
