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
  providers?: ProvidersConfig;
  // Legacy top-level fields (deprecated, fallback when providers.* absent)
  database?: DatabaseConfig;
  security?: SecurityConfig;
  codegraph?: CodegraphConfig;
  gitlab?: GitLabConfig;
  redis?: RedisConfig;
}

export interface ProvidersConfig {
  database?: DatabaseProviderConfig;
  gitlab?: GitLabProviderConfig;
  redis?: RedisProviderConfig;
}

export interface ProviderSecurityConfig {
  allow_write?: boolean;
  blocked_env?: string[];
}

export interface DatabaseProviderConfig extends DatabaseConfig {
  enabled?: boolean;
  security?: ProviderSecurityConfig;
}

export interface GitLabProviderConfig extends GitLabConfig {
  enabled?: boolean;
  security?: ProviderSecurityConfig;
}

export interface RedisProviderConfig extends RedisConfig {
  enabled?: boolean;
  security?: ProviderSecurityConfig;
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

export interface RedisSentinelNode {
  host: string;
  port?: number;
}

/**
 * A Redis connection is either standalone (`url`) or sentinel-backed
 * (`sentinels` + `master_name`). Exactly one of the two must be provided;
 * this is enforced at connect time by RedisProvider.
 */
export interface RedisConnectionConfig {
  url?: string;
  sentinels?: RedisSentinelNode[];
  /** Sentinel master group name. Required when `sentinels` is set. */
  master_name?: string;
  /** Which node to resolve. Defaults to "master". */
  role?: "master" | "slave";
  sentinel_username?: string;
  sentinel_password?: string;
  /** Enable TLS when talking to the sentinels themselves. */
  sentinel_tls?: boolean;
  /** AUTH username for the data node (Redis 6+). */
  username?: string;
  /** AUTH password for the data node. */
  password?: string;
  readonly?: boolean;
  db?: number;
  timeout?: number;
}

export interface RedisConfig {
  connections: Record<string, RedisConnectionConfig>;
  default_connection?: string;
}
