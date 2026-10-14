import { afterEach, describe, expect, it } from "vitest";
import { executeQueryTool } from "../../../../src/tools/database/query.js";
import { getDbSchemaTool } from "../../../../src/tools/database/schema.js";
import { databaseSetConnectionTool } from "../../../../src/tools/database/set-connection.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import { ToolError } from "../../../../src/core/errors.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("database tools error recovery", () => {
  it("throws DATABASE_CONNECTION_REQUIRED when no connections exist", async () => {
    (global as any).__devtools_config = {};

    await expect(
      executeQueryTool.execute({ query: "SELECT 1;" }),
    ).rejects.toThrowError(ToolError);

    try {
      await executeQueryTool.execute({ query: "SELECT 1;" });
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_CONNECTION_REQUIRED");
      expect(err.setupTool).toBe("database_set_connection");
    }
  });

  it("throws DATABASE_CONNECTION_NOT_FOUND with available_values for invalid connection name", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          connections: {
            dev: { dsn: "postgresql://localhost/dev", readonly: true },
            staging: { dsn: "postgresql://localhost/staging", readonly: true },
          },
        },
      },
    };

    try {
      await executeQueryTool.execute({
        connection: "prod",
        query: "SELECT 1;",
      });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_CONNECTION_NOT_FOUND");
      expect(err.parameter).toBe("connection");
      expect(err.availableValues).toEqual(["dev", "staging"]);
    }
  });

  it("throws DATABASE_QUERY_REQUIRED when query is empty or blank", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          connections: {
            dev: { dsn: "postgresql://localhost/dev", readonly: true },
          },
        },
      },
    };

    try {
      await executeQueryTool.execute({ query: "   " });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_QUERY_REQUIRED");
      expect(err.parameter).toBe("query");
    }
  });

  it("throws DATABASE_WRITE_DISABLED for non-SELECT queries when allow_write is false", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          connections: {
            dev: { dsn: "postgresql://localhost/dev", readonly: false },
          },
        },
      },
      security: {
        execute_query: {
          allow_write: false,
          blocked_env: ["prod"],
        },
      },
    };

    try {
      await executeQueryTool.execute({ query: "DELETE FROM users;" });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_WRITE_DISABLED");
      expect(err.configKey).toBe("providers.database.security.allow_write");
    }
  });

  it("refuses a write on a readonly connection even when writes are granted", async () => {
    (global as any).__devtools_config = {
      security: { allow_write: true, blocked_env: [] },
      providers: {
        database: {
          connections: {
            dev: { dsn: "mysql://localhost/dev", readonly: true },
          },
        },
      },
    };

    try {
      // The statement a reviewer used to prove the guard was not armed. It matches no
      // rows, which is exactly why the statement running at all is the finding.
      await executeQueryTool.execute({
        query: "UPDATE ticket SET deleted_at = deleted_at WHERE 1 = 0",
      });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_CONNECTION_READONLY");
      expect(err.configKey).toBe("providers.database.connections.dev.readonly");
      expect(err.retryable).toBe(false);
    }
  });

  it("refuses a write whose leading keyword hides it", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          connections: { dev: { dsn: "postgresql://localhost/dev" } },
        },
      },
    };

    try {
      // `WITH` used to make this a "read", so the gate was never consulted.
      await executeQueryTool.execute({
        query:
          "WITH stale AS (SELECT id FROM ticket) UPDATE ticket SET deleted_at = now() WHERE id IN (SELECT id FROM stale)",
      });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_WRITE_DISABLED");
    }
  });

  it("refuses a write on a connection listed in blocked_env", async () => {
    (global as any).__devtools_config = {
      security: { allow_write: true, blocked_env: ["prod"] },
      providers: {
        database: {
          connections: {
            "prod-replica": { dsn: "postgresql://localhost/prod" },
          },
        },
      },
    };

    try {
      await executeQueryTool.execute({
        connection: "prod-replica",
        query: "DELETE FROM ticket",
      });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("DATABASE_ENVIRONMENT_BLOCKED");
      expect(err.message).toContain('"prod"');
    }
  });

  it("database_set_connection returns structured success without exposing DSN", async () => {
    (global as any).__devtools_config = {};

    const res = await parseToolJson(databaseSetConnectionTool, {
      name: "staging",
      dsn: "postgresql://admin:supersecret@db.internal:5432/app",
      engine: "postgresql",
    });

    expect(res).toEqual({
      ok: true,
      data: {
        updated: true,
        name: "staging",
        engine: "postgresql",
        readonly: false,
      },
    });
    expect(JSON.stringify(res)).not.toContain("supersecret");
  });

  it("database_set_connection can add a connection that refuses writes", async () => {
    (global as any).__devtools_config = {};

    const res = await parseToolJson(databaseSetConnectionTool, {
      name: "reporting",
      dsn: "postgresql://readonly:pw@db.internal:5432/app",
      engine: "postgresql",
      readonly: true,
    });

    expect(res.data.readonly).toBe(true);
    // Persisted, not merely echoed: the write gate reads the connection, not the reply.
    expect(
      (global as any).__devtools_config.providers.database.connections
        .reporting,
    ).toMatchObject({ readonly: true });
  });
});
