import mysql from "mysql2/promise";
import type { ConnectionConfig } from "../core/types.js";
import { DEFAULT_CONNECT_TIMEOUT_MS, buildTlsOptions } from "./tls.js";
import type {
  DBProvider,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  Constraint,
  IndexInfo,
  Relationship,
} from "./interface.js";

/**
 * Schemas that describe the server rather than the application.
 *
 * Only consulted when the DSN names no schema of its own: a connection that says
 * `.../app_db` is asked about `app_db` and nothing else.
 */
const SYSTEM_SCHEMAS =
  "'information_schema', 'mysql', 'performance_schema', 'sys'";

const CONSTRAINT_TYPES: Record<string, Constraint["type"]> = {
  "PRIMARY KEY": "PRIMARY_KEY",
  "FOREIGN KEY": "FOREIGN_KEY",
  UNIQUE: "UNIQUE",
  CHECK: "CHECK",
};

export class MySQLProvider implements DBProvider {
  private pool: any = null;
  /** Set instead of `pool` when the connection is readonly; see `connect`. */
  private connection: any = null;
  /**
   * The engine the server reported. Seeded from the config so a plan is still labelled
   * correctly on a server where `SELECT VERSION()` is not permitted, and corrected by
   * `detectFlavour` when it answers.
   */
  private flavour: string;

  constructor(engine: "mysql" | "mariadb" = "mysql") {
    this.flavour = engine;
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (this.pool || this.connection) return;
    const ssl = buildTlsOptions(config.ssl);
    // `mysql2` builds its config from the URI first and lets the options object win, so
    // the explicit `ssl` block supersedes a `?ssl=` in the DSN with no stripping — unlike
    // `pg`, which merges the connection string *over* its options. See `./tls.ts`.
    const options = {
      uri: config.dsn,
      connectTimeout: config.connect_timeout || DEFAULT_CONNECT_TIMEOUT_MS,
      ...(ssl ? { ssl } : {}),
    };

    if (config.readonly === true) {
      // `SET SESSION` is per-connection state, and a pool hands every statement whichever
      // connection happens to be idle, so the setting would hold on one pooled connection
      // and be missing from the next. One connection is also all a readonly caller can
      // use: nothing it is allowed to run benefits from a second one.
      this.connection = await (mysql as any).createConnection(options);
      try {
        await this.connection.query("SET SESSION TRANSACTION READ ONLY");
      } catch (error: any) {
        // Fail closed. A connection whose `readonly: true` could not be applied is not a
        // readonly connection, and handing it to a caller would be the same silent
        // failure this guard exists to end.
        await this.disconnect().catch(() => {});
        throw new Error(
          `Could not open this MySQL/MariaDB connection as read-only, so it was closed: ${error?.message ?? error}`,
        );
      }
    } else {
      this.pool = (mysql as any).createPool(options);
    }

    await this.detectFlavour();
  }

  /**
   * Learn whether this is MySQL or MariaDB.
   *
   * The two answer the same SQL with different plan output, so a fixed label is a guess
   * the caller would then read as fact: a MariaDB `ANALYZE FORMAT=JSON` document carries
   * `r_rows` and `r_total_time_ms`, and no MySQL plan has either.
   */
  private async detectFlavour(): Promise<void> {
    try {
      const rows = await this.read("SELECT VERSION() AS version");
      const version = String(rows?.[0]?.version ?? "");
      if (/mariadb/i.test(version)) this.flavour = "mariadb";
      else if (version) this.flavour = "mysql";
    } catch {
      // A label is not a precondition. A user without the privilege for `VERSION()`
      // still gets introspection and plans; they are labelled with what the config asked
      // for instead of with a probe that was refused.
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /** The single connection when readonly, the pool otherwise. */
  private get runner(): any {
    return this.connection ?? this.pool;
  }

  /**
   * Rows from a statement, over the protocol that suits it: the text protocol when there
   * is nothing to bind (MariaDB refuses to prepare `ANALYZE`), a prepared statement when
   * there is.
   */
  private async read(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.runner) throw new Error("Database not connected");
    const [rows] =
      params.length > 0
        ? await this.runner.execute(sql, params)
        : await this.runner.query(sql);
    return rows as any[];
  }

  async executeQuery(query: string, params: any[] = []): Promise<any[]> {
    if (!this.runner) throw new Error("Database not connected");
    const [rows] = await this.runner.execute(query, params);
    return rows;
  }

  async explainQuery(query: string, analyze = true): Promise<any> {
    if (!this.runner) throw new Error("Database not connected");

    if (!analyze) return this.read(`EXPLAIN FORMAT=JSON ${query}`);

    if (this.getEngine() === "mariadb") {
      // MariaDB's `ANALYZE FORMAT=JSON` is the one that carries `r_rows` and
      // `r_total_time_ms`; plain `EXPLAIN` reports only what it estimated.
      return this.read(`ANALYZE FORMAT=JSON ${query}`);
    }

    // MySQL's `EXPLAIN ANALYZE` answers as a tree in text, and needs 8.0.18 or newer.
    // Anything older fails loudly here rather than quietly answering with estimates.
    return this.read(`EXPLAIN ANALYZE ${query}`);
  }

  /**
   * Read the schema out of `information_schema`.
   *
   * Four statements for the whole scope rather than three per table: a schema with two
   * hundred tables would otherwise cost six hundred round trips to answer one question,
   * and the tool would time out before it finished telling anyone what the tables are.
   */
  async introspect(tableName?: string): Promise<SchemaInfo> {
    if (!this.runner) throw new Error("Database not connected");

    const [{ db }] = await this.read("SELECT DATABASE() AS db");
    const schema = db ? String(db) : null;

    /** A `table_schema`/`table_name` clause, optionally qualified by a table alias. */
    const scopeFor = (alias = ""): string => {
      const prefix = alias ? `${alias}.` : "";
      return [
        schema
          ? `${prefix}table_schema = ?`
          : `${prefix}table_schema NOT IN (${SYSTEM_SCHEMAS})`,
        ...(tableName ? [`${prefix}table_name = ?`] : []),
      ].join(" AND ");
    };
    const scopeParams = schema
      ? [schema, ...(tableName ? [tableName] : [])]
      : [...(tableName ? [tableName] : [])];

    const tableRows = await this.read(
      `SELECT table_name
         FROM information_schema.tables
        WHERE ${scopeFor()} AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      scopeParams,
    );

    const tables = new Map<string, TableInfo>(
      tableRows.map((row) => [
        String(row.table_name),
        {
          name: String(row.table_name),
          columns: [],
          constraints: [],
          indexes: [],
        },
      ]),
    );
    if (tables.size === 0) return { tables: [], relationships: [] };

    const columnRows = await this.read(
      `SELECT table_name, column_name, column_type, data_type, is_nullable,
              column_default
         FROM information_schema.columns
        WHERE ${scopeFor()}
        ORDER BY table_name, ordinal_position`,
      scopeParams,
    );

    for (const row of columnRows) {
      const table = tables.get(String(row.table_name));
      if (!table) continue;
      const column: ColumnInfo = {
        name: String(row.column_name),
        // `column_type` keeps the width (`varchar(255)`) that `data_type` drops — a
        // schema you cannot size an index against is one you will guess about later.
        type: String(row.column_type ?? row.data_type),
        nullable: row.is_nullable === "YES",
        default: row.column_default ?? undefined,
      };
      table.columns.push(column);
    }

    const keyRows = await this.read(
      `SELECT tc.table_name, tc.constraint_type, tc.constraint_name, kcu.column_name,
              kcu.referenced_table_name, kcu.referenced_column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_schema = tc.constraint_schema
          AND kcu.constraint_name = tc.constraint_name
          AND kcu.table_name = tc.table_name
        WHERE ${scopeFor("tc")}
        ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
      scopeParams,
    );

    const constraints = new Map<string, Constraint>();
    for (const row of keyRows) {
      const table = tables.get(String(row.table_name));
      if (!table) continue;

      const key = `${row.table_name}.${row.constraint_name}`;
      let constraint = constraints.get(key);
      if (!constraint) {
        constraint = {
          type: CONSTRAINT_TYPES[String(row.constraint_type)] ?? "CHECK",
          columns: [],
        };
        constraints.set(key, constraint);
        table.constraints.push(constraint);
      }
      if (row.column_name) constraint.columns.push(String(row.column_name));

      // Rows arrive in `ordinal_position` order, so each referenced column lands in the
      // slot its own column occupies — which is what makes a composite foreign key
      // (`(a, b) references x(c, d)`) line up as `a→c, b→d` rather than as a guess.
      if (row.referenced_table_name)
        constraint.refTable = String(row.referenced_table_name);
      if (row.referenced_column_name) {
        constraint.refColumns = [
          ...(constraint.refColumns ?? []),
          String(row.referenced_column_name),
        ];
      }
    }

    const indexRows = await this.read(
      `SELECT table_name, index_name, non_unique, seq_in_index, column_name
         FROM information_schema.statistics
        WHERE ${scopeFor()}
        ORDER BY table_name, index_name, seq_in_index`,
      scopeParams,
    );

    const indexes = new Map<string, IndexInfo>();
    for (const row of indexRows) {
      const table = tables.get(String(row.table_name));
      if (!table) continue;

      const key = `${row.table_name}.${row.index_name}`;
      let index = indexes.get(key);
      if (!index) {
        index = {
          name: String(row.index_name),
          columns: [],
          unique: Number(row.non_unique) === 0,
        };
        indexes.set(key, index);
        table.indexes.push(index);
      }
      if (row.column_name) index.columns.push(String(row.column_name));
    }

    const relationships: Relationship[] = [];
    for (const table of tables.values()) {
      for (const constraint of table.constraints) {
        if (constraint.type === "PRIMARY_KEY") {
          for (const name of constraint.columns) {
            const column = table.columns.find((c) => c.name === name);
            if (column) column.isPrimaryKey = true;
          }
        }
        if (constraint.type !== "FOREIGN_KEY" || !constraint.refTable) continue;

        constraint.columns.forEach((name, position) => {
          const column = table.columns.find((c) => c.name === name);
          if (!column) return;
          column.isForeignKey = true;
          column.refTable = constraint.refTable;
          column.refColumn =
            constraint.refColumns?.[position] ?? constraint.refColumns?.[0];
          relationships.push({
            from: { table: table.name, column: column.name },
            to: {
              table: constraint.refTable!,
              column: column.refColumn || "id",
            },
          });
        });
      }
    }

    return { tables: [...tables.values()], relationships };
  }

  /**
   * `createPool` connects lazily, so a probe is the only way to learn whether a MySQL
   * connection works — returning `true` unconditionally reported every MySQL and MariaDB
   * connection as healthy, including ones nothing was listening for.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.runner) return false;
    try {
      await this.runner.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  getEngine(): string {
    return this.flavour;
  }
}
