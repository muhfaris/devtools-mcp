import { Tool } from "../../core/types.js";
import { createProvider, type DBProvider } from "../../providers/index.js";
import { databaseRequestError, requireDatabaseConnection } from "./errors.js";

// Cache for schema introspection (per connection, TTL 60s)
const schemaCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

export const getDbSchemaTool: Tool = {
  name: "get_db_schema",
  description:
    "Introspect database schema: tables, columns, types, constraints, indexes, and relationships",
  params: {
    connection: {
      type: "string",
      optional: true,
      description:
        'Connection name from config (e.g., "dev", "staging"). Default: first connection',
    },
    table: {
      type: "string",
      optional: true,
      description:
        "Specific table name to inspect. If omitted, returns all tables.",
    },
    refresh: {
      type: "boolean",
      optional: true,
      description: "Force refresh cache (default: false)",
      default: false,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const { connectionName, connection: connConfig } =
      requireDatabaseConnection(config, params.connection);

    const engine = config.database.default_engine || "postgresql";
    const provider = createProvider(engine);

    const cacheKey = `${connectionName}:${params.table || "all"}`;

    // Check cache
    if (!params.refresh) {
      const cached = schemaCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return {
          content: [
            { type: "text", text: JSON.stringify(cached.data, null, 2) },
          ],
        };
      }
    }

    try {
      await provider.connect(connConfig);
      const schema = await provider.introspect(params.table);
      await provider.disconnect();

      // Cache the result
      schemaCache.set(cacheKey, { data: schema, timestamp: Date.now() });

      const result = {
        connection: connectionName,
        engine,
        tables: schema.tables,
        relationships: schema.relationships,
        totalTables: schema.tables.length,
        totalRelationships: schema.relationships.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      await provider.disconnect().catch(() => {});
      throw databaseRequestError("introspect the schema", error);
    }
  },
};
