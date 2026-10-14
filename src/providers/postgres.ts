import { Pool, PoolClient } from "pg";
import type { ConnectionConfig } from "../core/types.js";
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  buildTlsOptions,
  stripTlsParams,
} from "./tls.js";
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
 * The pool options for one connection.
 *
 * Exported so the TLS merge can be tested without a live server — the failure this
 * replaces (`SELF_SIGNED_CERT_IN_CHAIN` against a managed endpoint) is not reproducible
 * on demand, and a rule this easy to invert deserves a test that does not need one.
 */
export const buildPoolOptions = (config: ConnectionConfig) => {
  const ssl = buildTlsOptions(config.ssl);

  return {
    connectionString: ssl ? stripTlsParams(config.dsn) : config.dsn,
    max: config.pool_size || 10,
    idleTimeoutMillis: config.timeout || 30000,
    connectionTimeoutMillis:
      config.connect_timeout || DEFAULT_CONNECT_TIMEOUT_MS,
    ...(ssl ? { ssl } : {}),
  };
};

export class PostgresProvider implements DBProvider {
  private pool: Pool | null = null;
  private client: PoolClient | null = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config;
    this.pool = new Pool(buildPoolOptions(config));
    this.client = await this.pool.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.release();
      this.client = null;
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  getEngine(): string {
    return "postgresql";
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) return false;
      await this.client.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async introspect(tableName?: string): Promise<SchemaInfo> {
    if (!this.client) throw new Error("Not connected to database");

    const tables: TableInfo[] = [];
    const relationships: Relationship[] = [];

    // Get all tables
    const tableQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      AND table_type = 'BASE TABLE'
      ${tableName ? "AND table_name = $1" : ""}
      ORDER BY table_name
    `;
    const tableResult = await this.client.query(
      tableQuery,
      tableName ? [tableName] : [],
    );

    for (const row of tableResult.rows) {
      const tblName = row.table_name;
      const columns: ColumnInfo[] = [];
      const constraints: Constraint[] = [];
      const indexes: IndexInfo[] = [];

      // Get columns
      const colQuery = `
        SELECT
          column_name,
          data_type,
          is_nullable = 'YES' as nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        AND table_name = $1
        ORDER BY ordinal_position
      `;
      const colResult = await this.client.query(colQuery, [tblName]);

      for (const col of colResult.rows) {
        columns.push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.nullable,
          default: col.column_default,
        });
      }

      // Get constraints
      const constQuery = `
        SELECT
          tc.constraint_type,
          tc.constraint_name,
          kcu.column_name,
          kcu.referenced_table_name,
          kcu.referenced_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema NOT IN ('information_schema', 'pg_catalog')
        AND tc.table_name = $1
      `;
      const constResult = await this.client.query(constQuery, [tblName]);

      const constraintMap = new Map<string, Constraint>();

      for (const c of constResult.rows) {
        const key = c.constraint_name;
        if (!constraintMap.has(key)) {
          const type =
            c.constraint_type === "PRIMARY KEY"
              ? "PRIMARY_KEY"
              : c.constraint_type === "FOREIGN KEY"
                ? "FOREIGN_KEY"
                : c.constraint_type === "UNIQUE"
                  ? "UNIQUE"
                  : "CHECK";
          constraintMap.set(key, {
            type,
            columns: [],
            refTable: c.referenced_table_name || undefined,
            refColumns: c.referenced_column_name
              ? [c.referenced_column_name]
              : undefined,
          });
        }
        const con = constraintMap.get(key)!;
        if (c.column_name) {
          con.columns.push(c.column_name);
        }
      }

      constraints.push(...constraintMap.values());

      // Get indexes
      const idxQuery = `
        SELECT
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
        AND tablename = $1
      `;
      const idxResult = await this.client.query(idxQuery, [tblName]);

      for (const idx of idxResult.rows) {
        const def = idx.indexdef;
        const isUnique = def.includes("UNIQUE");
        const columnsMatch = def.match(/\(([^)]+)\)/);
        const idxColumns = columnsMatch
          ? columnsMatch[1].split(",").map((c) => c.trim())
          : [];
        indexes.push({
          name: idx.indexname,
          columns: idxColumns,
          unique: isUnique,
        });
      }

      // Mark primary keys and foreign keys on columns
      for (const con of constraints) {
        if (con.type === "PRIMARY_KEY") {
          for (const colName of con.columns) {
            const col = columns.find((c) => c.name === colName);
            if (col) col.isPrimaryKey = true;
          }
        }
        if (con.type === "FOREIGN_KEY") {
          for (const colName of con.columns) {
            const col = columns.find((c) => c.name === colName);
            if (col) {
              col.isForeignKey = true;
              col.refTable = con.refTable;
              col.refColumn = con.refColumns?.[0];
            }
          }
        }
      }

      tables.push({
        name: tblName,
        columns,
        constraints,
        indexes,
      });
    }

    // Build relationships
    for (const table of tables) {
      for (const col of table.columns) {
        if (col.isForeignKey && col.refTable) {
          relationships.push({
            from: { table: table.name, column: col.name },
            to: { table: col.refTable, column: col.refColumn || "id" },
          });
        }
      }
    }

    return { tables, relationships };
  }

  async executeQuery(query: string, params: any[] = []): Promise<any[]> {
    if (!this.client) throw new Error("Not connected to database");
    const result = await this.client.query(query, params);
    return result.rows;
  }

  async explainQuery(query: string): Promise<any> {
    if (!this.client) throw new Error("Not connected to database");
    const result = await this.client.query(
      `EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) ${query}`,
    );
    return result.rows[0]?.["QUERY PLAN"] || result.rows;
  }
}
