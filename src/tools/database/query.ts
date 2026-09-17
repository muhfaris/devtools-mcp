import { Tool } from "../../core/types.js";
import { createProvider } from "../../providers/index.js";
import { ToolError } from "../../core/errors.js";
import {
  findBlockedEnvironment,
  isProviderEnabled,
  resolveAllowWrite,
} from "../../core/security.js";
import { getProviderConfig } from "../../core/provider-config.js";
import {
  databaseRequestError,
  requireDatabaseConnection,
  requireQuery,
} from "./errors.js";

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

    // Security: Check if write is allowed
    const query = requireQuery(params.query);
    const isWrite = !/^\s*SELECT/i.test(query);

    if (isWrite) {
      if (!resolveAllowWrite(config, "database")) {
        throw new ToolError(
          "DATABASE_WRITE_DISABLED",
          "Database write queries are disabled.",
          "Ask the user to enable providers.database.security.allow_write if this write is intentional, then retry this tool.",
          true,
          { configKey: "providers.database.security.allow_write" },
        );
      }
      // The connection name is the environment signal: a blocked entry appearing
      // anywhere in it (e.g. "production") blocks writes on that connection.
      if (findBlockedEnvironment(config, "database", connectionName)) {
        throw new ToolError(
          "DATABASE_ENVIRONMENT_BLOCKED",
          `Database writes are blocked for connection "${connectionName}".`,
          "Choose an explicitly permitted configured connection; do not retry against this connection.",
          false,
          { parameter: "connection" },
        );
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
