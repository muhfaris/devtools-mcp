export type ToolParamSchema = {
  type: "string" | "number" | "boolean" | "object" | "array";
  optional?: boolean;
  description?: string;
  default?: any;
  items?: Partial<ToolParamSchema>;
};

export type ToolParams = Record<string, any>;

export type ToolResult = {
  content?: Array<{ type: "text" | "image"; text?: string; data?: string }>;
  [key: string]: any;
};

export interface Tool {
  name: string;
  description: string;
  params?: Record<string, ToolParamSchema>;
  execute: (params: ToolParams) => Promise<ToolResult>;
}

export interface Provider {
  name: string;
  introspect: (config: any) => Promise<SchemaInfo>;
  executeQuery: (query: string, params?: any[]) => Promise<any>;
  healthCheck: () => Promise<boolean>;
}

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

export interface GitLabConfig {
  url: string;
  token: string;
  projectId: number | string;
}

export interface Config {
  id_generator?: { default?: string };
  database?: DatabaseConfig;
  security?: SecurityConfig;
  codegraph?: CodegraphConfig;
  gitlab?: GitLabConfig;
}

export interface DatabaseConfig {
  default_engine: "postgresql" | "mysql" | "mariadb";
  connections: Record<string, ConnectionConfig>;
}

export interface ConnectionConfig {
  dsn: string;
  readonly: boolean;
  pool_size?: number;
  timeout?: number;
}

export interface SecurityConfig {
  execute_query: {
    allow_write: boolean;
    blocked_env: string[];
  };
}

export interface CodegraphConfig {
  enabled: boolean;
  exclude: string[];
}
