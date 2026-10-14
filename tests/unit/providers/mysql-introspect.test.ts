import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A scripted `information_schema`.
 *
 * The provider asks four questions and assembles the answers; what matters here is the
 * assembly — which constraint becomes which column flag, which index keeps its order, and
 * which referenced column pairs with which local one — so the fixture is the returned
 * rows, and the assertions are about the schema that comes out.
 */
const state = vi.hoisted(() => ({
  version: "10.11.6-MariaDB-1:10.11.6+maria~ubu2204",
  schema: "app_db" as string | null,
  statements: [] as string[],
  params: [] as unknown[][],
  tables: [] as any[],
  columns: [] as any[],
  keys: [] as any[],
  indexes: [] as any[],
}));

const rowsFor = (sql: string): any[] => {
  if (/VERSION\(\)/i.test(sql))
    return state.version ? [{ version: state.version }] : [];
  if (/DATABASE\(\)/i.test(sql)) return [{ db: state.schema }];
  if (/information_schema\.tables/i.test(sql)) return state.tables;
  if (/information_schema\.columns/i.test(sql)) return state.columns;
  if (/table_constraints/i.test(sql)) return state.keys;
  if (/information_schema\.statistics/i.test(sql)) return state.indexes;
  return [];
};

const connection = {
  query: async (sql: string) => {
    state.statements.push(sql.replace(/\s+/g, " ").trim());
    return [rowsFor(sql)];
  },
  execute: async (sql: string, params: unknown[] = []) => {
    state.statements.push(sql.replace(/\s+/g, " ").trim());
    state.params.push(params);
    return [rowsFor(sql)];
  },
  end: async () => {},
};

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: () => connection,
    createConnection: async () => connection,
  },
}));

import { MySQLProvider } from "../../../src/providers/mysql.js";

const DSN = "mysql://user:pass@127.0.0.1:3306/app_db";

const connect = async (engine: "mysql" | "mariadb" = "mariadb") => {
  const provider = new MySQLProvider(engine);
  await provider.connect({ dsn: DSN });
  return provider;
};

const lastStatement = () => state.statements[state.statements.length - 1];

beforeEach(() => {
  state.version = "10.11.6-MariaDB-1:10.11.6+maria~ubu2204";
  state.schema = "app_db";
  state.statements.length = 0;
  state.params.length = 0;
  state.tables = [
    { table_name: "customer" },
    { table_name: "ticket" },
    { table_name: "ticket_tag" },
  ];
  state.columns = [
    {
      table_name: "customer",
      column_name: "id",
      column_type: "bigint(20)",
      data_type: "bigint",
      is_nullable: "NO",
      column_default: null,
    },
    {
      table_name: "customer",
      column_name: "name",
      column_type: "varchar(255)",
      data_type: "varchar",
      is_nullable: "NO",
      column_default: null,
    },
    {
      table_name: "ticket",
      column_name: "id",
      column_type: "bigint(20)",
      data_type: "bigint",
      is_nullable: "NO",
      column_default: null,
    },
    {
      table_name: "ticket",
      column_name: "customer_id",
      column_type: "bigint(20)",
      data_type: "bigint",
      is_nullable: "YES",
      column_default: null,
    },
    {
      table_name: "ticket",
      column_name: "subject",
      column_type: "varchar(255)",
      data_type: "varchar",
      is_nullable: "YES",
      column_default: "'untitled'",
    },
    {
      table_name: "ticket_tag",
      column_name: "tenant_id",
      column_type: "int(11)",
      data_type: "int",
      is_nullable: "NO",
      column_default: null,
    },
    {
      table_name: "ticket_tag",
      column_name: "tag_id",
      column_type: "int(11)",
      data_type: "int",
      is_nullable: "NO",
      column_default: null,
    },
  ];
  state.keys = [
    {
      table_name: "customer",
      constraint_type: "PRIMARY KEY",
      constraint_name: "PRIMARY",
      column_name: "id",
      referenced_table_name: null,
      referenced_column_name: null,
    },
    {
      table_name: "ticket",
      constraint_type: "PRIMARY KEY",
      constraint_name: "PRIMARY",
      column_name: "id",
      referenced_table_name: null,
      referenced_column_name: null,
    },
    {
      table_name: "ticket",
      constraint_type: "UNIQUE",
      constraint_name: "uq_ticket_subject",
      column_name: "subject",
      referenced_table_name: null,
      referenced_column_name: null,
    },
    {
      table_name: "ticket",
      constraint_type: "FOREIGN KEY",
      constraint_name: "fk_ticket_customer",
      column_name: "customer_id",
      referenced_table_name: "customer",
      referenced_column_name: "id",
    },
    {
      table_name: "ticket_tag",
      constraint_type: "FOREIGN KEY",
      constraint_name: "fk_ticket_tag",
      column_name: "tenant_id",
      referenced_table_name: "tag",
      referenced_column_name: "tenant_id",
    },
    {
      table_name: "ticket_tag",
      constraint_type: "FOREIGN KEY",
      constraint_name: "fk_ticket_tag",
      column_name: "tag_id",
      referenced_table_name: "tag",
      referenced_column_name: "id",
    },
  ];
  state.indexes = [
    {
      table_name: "ticket",
      index_name: "PRIMARY",
      non_unique: 0,
      seq_in_index: 1,
      column_name: "id",
    },
    {
      table_name: "ticket",
      index_name: "idx_ticket_customer",
      non_unique: 1,
      seq_in_index: 1,
      column_name: "customer_id",
    },
    {
      table_name: "ticket",
      index_name: "idx_ticket_customer",
      non_unique: 1,
      seq_in_index: 2,
      column_name: "subject",
    },
    {
      table_name: "ticket",
      index_name: "uq_ticket_subject",
      non_unique: 0,
      seq_in_index: 1,
      column_name: "subject",
    },
  ];
});

describe("MySQLProvider.introspect", () => {
  it("reads tables, columns, keys, and indexes instead of returning nothing", async () => {
    // The finding this replaces: `introspect` returned `{ tables: [] }` unconditionally,
    // so get_db_schema answered "0 tables" for every MySQL and MariaDB connection while a
    // direct query on the same connection worked.
    const provider = await connect();
    const schema = await provider.introspect();

    expect(schema.tables.map((table) => table.name)).toEqual([
      "customer",
      "ticket",
      "ticket_tag",
    ]);
    expect(schema.tables[1].columns).toEqual([
      {
        name: "id",
        type: "bigint(20)",
        nullable: false,
        default: undefined,
        isPrimaryKey: true,
      },
      {
        name: "customer_id",
        type: "bigint(20)",
        nullable: true,
        default: undefined,
        isForeignKey: true,
        refTable: "customer",
        refColumn: "id",
      },
      {
        name: "subject",
        type: "varchar(255)",
        nullable: true,
        default: "'untitled'",
      },
    ]);
  });

  it("names the engine the server reported", async () => {
    expect((await connect()).getEngine()).toBe("mariadb");

    state.version = "8.0.36";
    expect((await connect("mariadb")).getEngine()).toBe("mysql");

    // A probe that is refused leaves the configured name standing, rather than guessing.
    state.version = "";
    expect((await connect("mariadb")).getEngine()).toBe("mariadb");
  });

  it("marks primary keys and keeps a unique constraint as one", async () => {
    const schema = await (await connect()).introspect();
    const ticket = schema.tables.find((table) => table.name === "ticket")!;

    expect(ticket.columns[0]).toMatchObject({ name: "id", isPrimaryKey: true });
    expect(ticket.constraints).toEqual([
      { type: "PRIMARY_KEY", columns: ["id"] },
      { type: "UNIQUE", columns: ["subject"] },
      {
        type: "FOREIGN_KEY",
        columns: ["customer_id"],
        refTable: "customer",
        refColumns: ["id"],
      },
    ]);
  });

  it("pairs a composite foreign key's columns with the ones they reference", async () => {
    // Both rows belong to one constraint, and the order they arrive in is the order that
    // pairs them: reading the first referenced column for both would point `tag_id` at
    // `tag.tenant_id`.
    const schema = await (await connect()).introspect();
    const pairs = schema.relationships
      .filter((relationship) => relationship.from.table === "ticket_tag")
      .map(
        (relationship) =>
          `${relationship.from.column}->${relationship.to.table}.${relationship.to.column}`,
      );

    expect(pairs).toEqual(["tenant_id->tag.tenant_id", "tag_id->tag.id"]);
  });

  it("keeps the column order of a multi-column index", async () => {
    const schema = await (await connect()).introspect();
    const ticket = schema.tables.find((table) => table.name === "ticket")!;

    expect(ticket.indexes).toEqual([
      { name: "PRIMARY", columns: ["id"], unique: true },
      {
        name: "idx_ticket_customer",
        columns: ["customer_id", "subject"],
        unique: false,
      },
      { name: "uq_ticket_subject", columns: ["subject"], unique: true },
    ]);
  });

  it("scopes to the schema the DSN selected", async () => {
    await (await connect()).introspect();

    const tableStatement = state.statements.find((sql) =>
      /information_schema\.tables/i.test(sql),
    )!;
    expect(tableStatement).toContain("table_schema = ?");
    expect(tableStatement).not.toContain("NOT IN");
    // The schema is bound, not interpolated: a database name is user input too.
    expect(state.params.flat()).toContain("app_db");
  });

  it("falls back to every non-system schema when the DSN selects none", async () => {
    state.schema = null;
    await (await connect()).introspect();

    const tableStatement = state.statements.find((sql) =>
      /information_schema\.tables/i.test(sql),
    )!;
    expect(tableStatement).toContain(
      "table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')",
    );
  });

  it("narrows every statement to one table when asked for one", async () => {
    const schema = await (await connect()).introspect("ticket");

    const scoped = state.statements.filter((sql) =>
      /information_schema/.test(sql),
    );
    // Tables, columns, keys, indexes — one statement each, all narrowed.
    expect(scoped).toHaveLength(4);
    for (const sql of scoped) {
      expect(sql).toContain("table_name = ?");
      expect(sql).not.toContain("table_name = 'ticket'");
    }
    expect(state.params.flat()).toEqual([
      "app_db",
      "ticket",
      "app_db",
      "ticket",
      "app_db",
      "ticket",
      "app_db",
      "ticket",
    ]);
    // The answers are the same fixture; the filter travels in the parameters.
    expect(schema.tables).toHaveLength(3);
  });

  it("asks for nothing further when the scope holds no tables", async () => {
    state.tables = [];
    const schema = await (await connect()).introspect();

    expect(schema).toEqual({ tables: [], relationships: [] });
    expect(
      state.statements.filter((sql) => /information_schema/.test(sql)),
    ).toHaveLength(1);
  });
});

describe("MySQLProvider.explainQuery", () => {
  it("uses MariaDB's ANALYZE FORMAT=JSON when timings were asked for", async () => {
    const provider = await connect("mariadb");
    await provider.explainQuery("SELECT 1", true);

    expect(lastStatement()).toBe("ANALYZE FORMAT=JSON SELECT 1");
  });

  it("uses MySQL's EXPLAIN ANALYZE on a MySQL server", async () => {
    state.version = "8.0.36";
    const provider = await connect();

    await provider.explainQuery("SELECT 1", true);

    expect(lastStatement()).toBe("EXPLAIN ANALYZE SELECT 1");
  });

  it("does not run the statement when analyze is false", async () => {
    const provider = await connect();

    await provider.explainQuery("DELETE FROM ticket", false);

    // `ANALYZE` executes what it explains: the flag has to change the statement.
    expect(lastStatement()).toBe("EXPLAIN FORMAT=JSON DELETE FROM ticket");
  });
});
