import { Tool } from "../../core/types.js";

export const databaseSetConnectionTool: Tool = {
  name: "database_set_connection",
  description:
    "Add or update a database connection configuration for the current session",
  params: {
    name: {
      type: "string",
      description: "Connection name (e.g., 'dev', 'staging')",
    },
    dsn: {
      type: "string",
      description:
        "Database connection string (e.g., postgresql://user:pass@host:port/db)",
    },
    engine: {
      type: "string",
      optional: true,
      description:
        'Database engine: "postgresql", "mysql", "mariadb" (default: "postgresql")',
    },
    readonly: {
      type: "boolean",
      optional: true,
      description: "Whether the connection is read-only (default: false)",
      default: false,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config || {};
    if (!config.database)
      config.database = { default_engine: "postgresql", connections: {} };
    if (!config.database.connections) config.database.connections = {};

    const name = params.name;
    const dsn = params.dsn;
    const engine = params.engine || "postgresql";
    const readonly = params.readonly || false;

    config.database.connections[name] = { dsn, readonly };
    if (!config.database.default_engine) {
      config.database.default_engine = engine;
    }

    // (Optional) Test connection
    // We could try to connect to validate, but that might be slow.

    return {
      content: [
        {
          type: "text",
          text: `✅ Database connection '${name}' added successfully.`,
        },
      ],
    };
  },
};
