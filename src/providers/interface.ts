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
  explainQuery(query: string): Promise<any>;
  healthCheck(): Promise<boolean>;
  getEngine(): string;
}
