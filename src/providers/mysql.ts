import mysql from "mysql2/promise";
import type { ConnectionConfig } from "../core/types.js";
import type {
  DBProvider,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  Constraint,
  IndexInfo,
  Relationship,
} from "./interface.js";

export class MySQLProvider implements DBProvider {
  private pool: mysql.Pool | null = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config;
    this.pool = mysql.createPool({
      uri: config.dsn,
      connectionLimit: config.pool_size || 10,
      timeout: config.timeout || 30000,
    });
    // Test connection
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  getEngine(): string {
    return "mysql";
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.pool) return false;
      const conn = await this.pool.getConnection();
      conn.release();
      return true;
    } catch {
      return false;
    }
  }

  async introspect(tableName?: string): Promise<SchemaInfo> {
    if (!this.pool) throw new Error("Not connected to database");

    const tables: TableInfo[] = [];
    const relationships: Relationship[] = [];

    const dbName =
      this.config?.dsn?.match(/\/\/([^\/]+)\//)?.[1] ||
      (await this.getDatabaseName());

    // Get all tables
    const tableQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ?
      AND table_type = 'BASE TABLE'
      ${tableName ? "AND table_name = ?" : ""}
      ORDER BY table_name
    `;
    const params = tableName ? [dbName, tableName] : [dbName];
    const [tableRows] = await this.pool.query<any[]>(tableQuery, params);

    for (const row of tableRows) {
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
        WHERE table_schema = ?
        AND table_name = ?
        ORDER BY ordinal_position
      `;
      const [colRows] = await this.pool.query<any[]>(colQuery, [
        dbName,
        tblName,
      ]);

      for (const col of colRows) {
        columns.push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.nullable === 1,
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
        WHERE tc.table_schema = ?
        AND tc.table_name = ?
      `;
      const [constRows] = await this.pool.query<any[]>(constQuery, [
        dbName,
        tblName,
      ]);

      const constraintMap = new Map<string, Constraint>();

      for (const c of constRows) {
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
          index_name,
          column_name,
          non_unique
        FROM information_schema.statistics
        WHERE table_schema = ?
        AND table_name = ?
        ORDER BY index_name, seq_in_index
      `;
      const [idxRows] = await this.pool.query<any[]>(idxQuery, [
        dbName,
        tblName,
      ]);

      const indexMap = new Map<string, IndexInfo>();
      for (const idx of idxRows) {
        const key = idx.index_name;
        if (!indexMap.has(key)) {
          indexMap.set(key, {
            name: key,
            columns: [],
            unique: idx.non_unique === 0,
          });
        }
        indexMap.get(key)!.columns.push(idx.column_name);
      }
      indexes.push(...indexMap.values());

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

  private async getDatabaseName(): Promise<string> {
    if (!this.pool) throw new Error("Not connected");
    const [rows] = await this.pool.query<any[]>("SELECT DATABASE() as db");
    return rows[0]?.db || "";
  }

  async executeQuery(query: string, params: any[] = []): Promise<any[]> {
    if (!this.pool) throw new Error("Not connected to database");
    const [rows] = await this.pool.query(query, params);
    return rows as any[];
  }

  async explainQuery(query: string): Promise<any> {
    if (!this.pool) throw new Error("Not connected to database");
    const [rows] = await this.pool.query(
      `EXPLAIN ANALYZE FORMAT=JSON ${query}`,
    );
    return rows;
  }
}
