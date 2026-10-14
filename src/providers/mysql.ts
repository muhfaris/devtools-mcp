import mysql from "mysql2/promise";
import type { ConnectionConfig } from "../core/types.js";
import { DEFAULT_CONNECT_TIMEOUT_MS, buildTlsOptions } from "./tls.js";
import type { DBProvider } from "./index.js";

export class MySQLProvider implements DBProvider {
  private pool: any = null;

  async connect(config: ConnectionConfig): Promise<void> {
    if (this.pool) return;
    const ssl = buildTlsOptions(config.ssl);
    // `mysql2` builds its config from the URI first and lets the options object win, so
    // the explicit `ssl` block supersedes a `?ssl=` in the DSN with no stripping — unlike
    // `pg`, which merges the connection string *over* its options. See `./tls.ts`.
    this.pool = (mysql as any).createPool({
      uri: config.dsn,
      connectTimeout: config.connect_timeout || DEFAULT_CONNECT_TIMEOUT_MS,
      ...(ssl ? { ssl } : {}),
    });
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async executeQuery(query: string, params: any[] = []): Promise<any[]> {
    if (!this.pool) throw new Error("Database not connected");
    const [rows] = await this.pool.execute(query, params);
    return rows;
  }

  async explainQuery(query: string): Promise<any> {
    if (!this.pool) throw new Error("Database not connected");
    const [rows] = await this.pool.execute(`EXPLAIN FORMAT=JSON ${query}`);
    return rows;
  }

  async introspect(tableName?: string): Promise<any> {
    if (!this.pool) throw new Error("Database not connected");
    return { tables: [], relationships: [] };
  }

  /**
   * `createPool` connects lazily, so a probe is the only way to learn whether a MySQL
   * connection works — returning `true` unconditionally reported every MySQL and MariaDB
   * connection as healthy, including ones nothing was listening for.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  getEngine(): string {
    return "mysql";
  }
}
