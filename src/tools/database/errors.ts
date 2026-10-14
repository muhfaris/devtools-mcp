import { ToolError } from "../../core/errors.js";
import { getProviderConfig } from "../../core/provider-config.js";
import type { ConnectionWritePolicy } from "../../core/security.js";

export const requireDatabaseConnection = (
  config: any,
  requestedConnection?: unknown,
) => {
  const connections = getProviderConfig(config, "database")?.connections;
  if (!connections || Object.keys(connections).length === 0) {
    throw new ToolError(
      "DATABASE_CONNECTION_REQUIRED",
      "A database connection is required.",
      "Ask the user to configure a database connection with database_set_connection, then retry this tool.",
      true,
      {
        configKey: "providers.database.connections",
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

/**
 * Turn a refused write into the error that names the rule which refused it.
 *
 * One error per reason, because "writes are disabled" and "this connection is readonly"
 * send the reader to two different lines of the config, and a shared message would leave
 * them editing the one that was never in the way.
 */
export const databaseWriteRefused = (
  policy: ConnectionWritePolicy,
  connectionName: string,
): ToolError => {
  const configKey = `providers.database.connections.${connectionName}`;
  const reason = policy.denied_by[0];
  const also = policy.denied_by.slice(1);
  const alsoText = also.length ? ` Also refused by: ${also.join(", ")}.` : "";

  switch (reason) {
    case "connection_readonly":
      return new ToolError(
        "DATABASE_CONNECTION_READONLY",
        `Database connection "${connectionName}" is readonly: true, so writes are refused here regardless of any allow_write grant.` +
          alsoText,
        "Run this statement on a writable connection, or ask the user to remove `readonly: true` from this connection if it was not meant to be a guard. Do not retry the same statement on this connection.",
        false,
        { parameter: "connection", configKey: `${configKey}.readonly` },
      );
    case "environment_blocked":
      return new ToolError(
        "DATABASE_ENVIRONMENT_BLOCKED",
        `Database writes are blocked for connection "${connectionName}" — it matches the blocked_env entry "${policy.detail}".` +
          alsoText,
        "Choose an explicitly permitted configured connection; do not retry against this connection.",
        false,
        { parameter: "connection" },
      );
    case "provider_disabled":
      return new ToolError(
        "DATABASE_DISABLED",
        "Database provider is disabled in configuration.",
        "Enable providers.database.enabled in .devtools/config.yaml, then retry this tool.",
        true,
        { configKey: "providers.database.enabled" },
      );
    default:
      return new ToolError(
        "DATABASE_WRITE_DISABLED",
        `Database write statements are disabled on "${connectionName}": no allow_write grant covers it.` +
          alsoText,
        "Ask the user to enable providers.database.security.allow_write if this write is intentional, then retry this tool.",
        true,
        { configKey: "providers.database.security.allow_write" },
      );
  }
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
