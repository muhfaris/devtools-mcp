import mysql from "mysql2/promise";
import type { ConnectionConfig } from "../core/types.js";
import type { DBProvider } from "./index.js";

export class MySQLProvider implements DBProvider {
  private pool: any = null;

  async connect(config: ConnectionConfig): Promise<void> {
    if (this.pool) return;
    this.pool = (mysql as any).createPool(config.dsn);
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

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getEngine(): string {
    return "mysql";
  }
}
