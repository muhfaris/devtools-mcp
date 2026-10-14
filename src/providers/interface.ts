import type { ConnectionConfig } from "../core/types.js";

export interface SchemaInfo {
  tables: TableInfo[];
  relationships: Relationship[];
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  constraints: Constraint[];
  indexes: IndexInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: any;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  refTable?: string;
  refColumn?: string;
}

export interface Constraint {
  type: "PRIMARY_KEY" | "FOREIGN_KEY" | "UNIQUE" | "CHECK";
  columns: string[];
  refTable?: string;
  refColumns?: string[];
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface Relationship {
  from: { table: string; column: string };
  to: { table: string; column: string };
}

export interface DBProvider {
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  introspect(tableName?: string): Promise<SchemaInfo>;
  executeQuery(query: string, params?: any[]): Promise<any[]>;
  /**
   * The plan for `query`. `analyze` runs the statement for real timings, which is why
   * `explain_query` sends a non-read statement through the write gate before calling
   * this: the two are the same operation when the flag is on.
   */
  explainQuery(query: string, analyze?: boolean): Promise<any>;
  healthCheck(): Promise<boolean>;
  /**
   * The engine answering right now. MySQL and MariaDB are different servers with
   * different plan output, so a provider that can reach either reports which one it
   * actually got, not the name the config asked for.
   */
  getEngine(): string;
}
