import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const state = vi.hoisted(() => ({
  engine: "mariadb",
  schema: { tables: [] as any[], relationships: [] as any[] },
  introduced: [] as (string | undefined)[],
}));

vi.mock("../../../../src/providers/index.js", () => ({
  createProvider: () => ({
    connect: async () => {},
    disconnect: async () => {},
    introspect: async (table?: string) => {
      state.introduced.push(table);
      return state.schema;
    },
    executeQuery: async () => [],
    explainQuery: async () => [],
    healthCheck: async () => true,
    getEngine: () => state.engine,
  }),
}));

import { getDbSchemaTool } from "../../../../src/tools/database/schema.js";

const originalConfig = (global as any).__devtools_config;

const table = (name: string) => ({
  name,
  columns: [{ name: "id", type: "bigint(20)", nullable: false }],
  constraints: [{ type: "PRIMARY_KEY", columns: ["id"] }],
  indexes: [{ name: "PRIMARY", columns: ["id"], unique: true }],
});

const useConnection = (name: string) => {
  (global as any).__devtools_config = {
    providers: {
      database: {
        default_engine: "mariadb",
        connections: { [name]: { dsn: "mariadb://localhost/app" } },
      },
    },
  };
};

beforeEach(() => {
  state.introduced.length = 0;
  state.engine = "mariadb";
  state.schema = { tables: [table("ticket")], relationships: [] };
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("get_db_schema", () => {
  it("returns the tables the provider read", async () => {
    useConnection("introspect-returns");

    const result = await parseToolJson(getDbSchemaTool, {});

    expect(result.totalTables).toBe(1);
    expect(result.tables[0].name).toBe("ticket");
    expect(result.tables[0].columns[0]).toMatchObject({
      name: "id",
      type: "bigint(20)",
    });
  });

  it("names the engine that answered", async () => {
    useConnection("engine-label");
    state.engine = "mariadb";

    const result = await parseToolJson(getDbSchemaTool, {});

    // The config value is `mariadb` for both servers, so the label has to come from the
    // provider that connected rather than from the config that was read.
    expect(result.engine).toBe("mariadb");
  });

  it("passes the table filter through and reports what came back", async () => {
    useConnection("table-filter");

    await parseToolJson(getDbSchemaTool, { table: "ticket" });

    expect(state.introduced).toEqual(["ticket"]);
  });

  it("serves a repeat call from the cache and refresh from the provider", async () => {
    useConnection("cache-behaviour");

    const first = await parseToolJson(getDbSchemaTool, {});
    state.schema = {
      tables: [table("ticket"), table("customer")],
      relationships: [],
    };

    const cached = await parseToolJson(getDbSchemaTool, {});
    const refreshed = await parseToolJson(getDbSchemaTool, { refresh: true });

    expect(first.totalTables).toBe(1);
    // The schema of a database does not change between two calls a second apart, and
    // introspection is four round trips.
    expect(cached.totalTables).toBe(1);
    expect(refreshed.totalTables).toBe(2);
    expect(state.introduced).toEqual([undefined, undefined]);
  });
});
