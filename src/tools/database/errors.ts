import { ToolError } from "../../core/errors.js";

export const requireDatabaseConnection = (
  config: any,
  requestedConnection?: unknown,
) => {
  const connections = config?.database?.connections;
  if (!connections || Object.keys(connections).length === 0) {
    throw new ToolError(
      "DATABASE_CONNECTION_REQUIRED",
      "A database connection is required.",
      "Ask the user to configure a database connection with database_set_connection, then retry this tool.",
      true,
      {
        configKey: "database.connections",
        setupTool: "database_set_connection",
      },
    );
  }

  const availableValues = Object.keys(connections);
  const connectionName = requestedConnection || availableValues[0];
  const connection = connections[String(connectionName)];
  if (!connection) {
    throw new ToolError(
      "DATABASE_CONNECTION_NOT_FOUND",
      `Database connection "${String(connectionName)}" is not configured.`,
      "Choose a configured connection name, then retry this tool with connection.",
      true,
      { parameter: "connection", availableValues },
    );
  }

  return { connectionName: String(connectionName), connection };
};

export const requireQuery = (query: unknown): string => {
  const value = typeof query === "string" ? query.trim() : "";
  if (!value) {
    throw new ToolError(
      "DATABASE_QUERY_REQUIRED",
      "A SQL query is required.",
      "Provide a SQL query in query, then retry this tool.",
      true,
      { parameter: "query" },
    );
  }
  return value;
};

export const databaseRequestError = (operation: string, cause: unknown) => {
  if (cause instanceof ToolError) return cause;
  return new ToolError(
    "DATABASE_REQUEST_FAILED",
    `The database could not ${operation}.`,
    "Report the database failure to the user; do not retry automatically.",
    false,
    { cause },
  );
};
