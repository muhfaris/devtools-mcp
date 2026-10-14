import { Tool } from "../../core/types.js";
import { createProvider, type DBProvider } from "../../providers/index.js";
import { getProviderConfig } from "../../core/provider-config.js";
import { isProviderEnabled } from "../../core/security.js";
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
    if (!isProviderEnabled(config, "database")) {
      throw new Error(
        "Database provider is disabled in configuration. Enable providers.database.enabled in .devtools/config.yaml.",
      );
    }
    const { connectionName, connection: connConfig } =
      requireDatabaseConnection(config, params.connection);

    const provider = createProvider(
      getProviderConfig(config, "database")?.default_engine ?? "postgresql",
    );

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
      // The engine that answered, not the one the config named: `mariadb` and `mysql`
      // share a config value, and knowing which one replied is what decides how to read
      // the types below.
      const engine = provider.getEngine();
      await provider.disconnect();

      const result = {
        connection: connectionName,
        engine,
        tables: schema.tables,
        relationships: schema.relationships,
        totalTables: schema.tables.length,
        totalRelationships: schema.relationships.length,
      };

      // The assembled answer is what gets cached, not the raw introspection: caching the
      // raw one made the second call a different shape from the first — same tables, no
      // `engine`, no counts — so a reader could not tell the two responses apart from a
      // truncated one.
      schemaCache.set(cacheKey, { data: result, timestamp: Date.now() });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      await provider.disconnect().catch(() => {});
      throw databaseRequestError("introspect the schema", error);
    }
  },
};
