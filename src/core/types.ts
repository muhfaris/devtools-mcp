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
  /** Shared write policy; a `providers.<provider>.security` block overrides it. */
  security?: SecurityConfig;
  /** Reserved for the planned `codegraph` tool (PRD 5.5) — not read yet. */
  codegraph?: CodegraphConfig;
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

/**
 * TLS settings for a connection, applied on top of its DSN.
 *
 * `ca`, `cert`, and `key` are **file paths**, read at connect time: a certificate is far
 * too large to keep in a config file, and a path lets `show_config` report the setting
 * without ever holding the secret. A backend signed by a private CA — Aiven's per-project
 * CA, for one — is the case this exists for, and a DSN `sslmode` cannot express it.
 */
export interface ConnectionTlsConfig {
  /** Path to one or more PEM CA certificates to trust. */
  ca?: string;
  /** Path to a client certificate. */
  cert?: string;
  /** Path to the private key for `cert`. */
  key?: string;
  /**
   * Verify the server certificate chain. Defaults to the driver's own default (`true`).
   * Setting `false` encrypts without authenticating the server, so it belongs to a local
   * stopgap, not a settled setup.
   */
  rejectUnauthorized?: boolean;
}

export interface ConnectionConfig {
  dsn: string;
  pool_size?: number;
  /** Idle timeout in ms for a pooled connection. Default 30000. */
  timeout?: number;
  /**
   * How long to wait for a connection to be established, in ms. Default 10000 — without
   * it a host that accepts TCP and then stalls holds the tool open forever (PRD 5:
   * a provider call may not hang).
   */
  connect_timeout?: number;
  /**
   * TLS settings, which supersede any TLS parameter the DSN carries. A DSN says how to
   * reach a server; this says whether to trust it.
   */
  ssl?: ConnectionTlsConfig;
  /**
   * A hard, per-connection write deny that **outranks** `security.allow_write`.
   *
   * `blocked_env` matches a name, which cannot protect a connection called `dev` that
   * happens to point at live data; this states the intent instead of inferring it. It is
   * enforced twice: the tool refuses a write before it runs, and the session is opened
   * read-only (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`), so a statement
   * that slips past the first gate still fails at the server.
   */
  readonly?: boolean;
}

export interface SecurityConfig {
  /**
   * Write grant for every provider. Denied by default, so a missing or misspelled
   * block fails closed. A `providers.<provider>.security` block overrides this, and a
   * `readonly: true` connection still refuses writes of its own.
   */
  allow_write?: boolean;
  /**
   * Identifiers that may not write: the connection name for database and Redis, the
   * resolved project path or ID for GitLab.
   */
  blocked_env?: string[];
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
  /** AUTH password for the data node (Redis 6+). */
  password?: string;
  db?: number;
  timeout?: number;
  /**
   * A hard, per-connection write deny that **outranks** `security.allow_write`, on the
   * same terms as a database connection's. Redis has no session-level equivalent to
   * enforce it a second time, so the write tools are the only gate.
   */
  readonly?: boolean;
}

export interface RedisConfig {
  connections: Record<string, RedisConnectionConfig>;
  default_connection?: string;
}
