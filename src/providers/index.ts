import type { ConnectionConfig } from "../core/types.js";
import type { DBProvider } from "./interface.js";
import { PostgresProvider } from "./postgres.js";
import { MySQLProvider } from "./mysql.js";

export type DBEngine = "postgresql" | "mysql" | "mariadb";

export const createProvider = (engine: DBEngine): DBProvider => {
  switch (engine) {
    case "postgresql":
      return new PostgresProvider();
    case "mysql":
    case "mariadb":
      return new MySQLProvider();
    default:
      throw new Error(`Unsupported database engine: ${engine}`);
  }
};

export {
  type DBProvider,
  type SchemaInfo,
  type TableInfo,
  type ColumnInfo,
} from "./interface.js";
