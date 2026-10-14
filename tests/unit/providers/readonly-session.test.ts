import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `vi.mock` factories are hoisted, so everything they touch is created with `vi.hoisted`.
 * Only what a test asserts on is recorded: these tests are about one statement sent at
 * connect time, and a fake that models more of the driver would model it wrongly.
 */
const state = vi.hoisted(() => ({
  pgQueries: [] as string[],
  pgReleased: 0,
  pgEnded: 0,
  poolCreated: 0,
  mysqlQueries: [] as string[],
  mysqlConnections: 0,
  mysqlPools: 0,
  mysqlEnded: 0,
  refuseReadOnly: false,
}));

vi.mock("pg", () => {
  class Pool {
    private client = {
      query: async (sql: string) => {
        state.pgQueries.push(sql);
        if (state.refuseReadOnly && /READ ONLY/i.test(sql)) {
          throw new Error("cannot set transaction read only");
        }
        return { rows: [] };
      },
      release: () => {
        state.pgReleased++;
      },
    };
    constructor() {
      state.poolCreated++;
    }
    connect = async () => this.client;
    end = async () => {
      state.pgEnded++;
    };
  }
  return { Pool };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: () => {
      state.mysqlPools++;
      return {
        query: async () => [],
        execute: async () => [[]],
        end: async () => {},
      };
    },
    createConnection: async () => {
      state.mysqlConnections++;
      return {
        query: async (sql: string) => {
          state.mysqlQueries.push(sql);
          if (state.refuseReadOnly && /READ ONLY/i.test(sql)) {
            throw new Error("cannot set transaction read only");
          }
          return [];
        },
        execute: async () => [[]],
        end: async () => {
          state.mysqlEnded++;
        },
      };
    },
  },
}));

import { PostgresProvider } from "../../../src/providers/postgres.js";
import { MySQLProvider } from "../../../src/providers/mysql.js";

const DSN = "postgres://user:pass@127.0.0.1:5432/app";

beforeEach(() => {
  state.pgQueries.length = 0;
  state.mysqlQueries.length = 0;
  state.pgReleased = 0;
  state.pgEnded = 0;
  state.poolCreated = 0;
  state.mysqlConnections = 0;
  state.mysqlPools = 0;
  state.mysqlEnded = 0;
  state.refuseReadOnly = false;
});

describe("PostgreSQL read-only session", () => {
  it("opens the session read-only when the connection says so", async () => {
    const provider = new PostgresProvider();

    await provider.connect({ dsn: DSN, readonly: true });

    // The tool gate reads the statement; this does not read anything at all, so it covers
    // the writes no parser can be expected to recognise.
    expect(state.pgQueries).toEqual([
      "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
    ]);
  });

  it("leaves the session alone when the connection does not", async () => {
    const provider = new PostgresProvider();

    await provider.connect({ dsn: DSN });

    expect(state.pgQueries).toEqual([]);
  });

  it("closes the connection rather than using it when the setting is refused", async () => {
    state.refuseReadOnly = true;
    const provider = new PostgresProvider();

    await expect(
      provider.connect({ dsn: DSN, readonly: true }),
    ).rejects.toThrow(/read-only/);
    // A connection that claims to be readonly and is not must not reach a caller: the
    // guard would hold on paper only.
    expect(state.pgReleased).toBe(1);
    expect(state.pgEnded).toBe(1);
  });
});

describe("MySQL/MariaDB read-only session", () => {
  it("uses a single read-only connection, not a pool, when the connection says so", async () => {
    const provider = new MySQLProvider();

    await provider.connect({
      dsn: "mysql://user:pass@127.0.0.1:3306/app",
      readonly: true,
    });

    // `SET SESSION` is per-connection state and a pool hands out whichever connection is
    // idle, so the setting would hold on one and be missing from the next. The second
    // statement is the flavour probe that runs on every connect.
    expect(state.mysqlConnections).toBe(1);
    expect(state.mysqlPools).toBe(0);
    expect(state.mysqlQueries).toEqual([
      "SET SESSION TRANSACTION READ ONLY",
      "SELECT VERSION() AS version",
    ]);
  });

  it("pools as before when the connection is writable", async () => {
    const provider = new MySQLProvider();

    await provider.connect({ dsn: "mysql://user:pass@127.0.0.1:3306/app" });

    expect(state.mysqlPools).toBe(1);
    expect(state.mysqlConnections).toBe(0);
  });

  it("closes the connection rather than using it when the setting is refused", async () => {
    state.refuseReadOnly = true;
    const provider = new MySQLProvider();

    await expect(
      provider.connect({
        dsn: "mysql://user:pass@127.0.0.1:3306/app",
        readonly: true,
      }),
    ).rejects.toThrow(/read-only/);
    expect(state.mysqlEnded).toBe(1);
  });
});
