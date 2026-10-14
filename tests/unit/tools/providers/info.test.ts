import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providersInfoTool } from "../../../../src/tools/providers/info.js";
import { createProvider } from "../../../../src/providers/index.js";
import { RedisProvider } from "../../../../src/providers/redis.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

vi.mock("../../../../src/providers/index.js", () => ({
  createProvider: vi.fn(),
}));

vi.mock("../../../../src/providers/redis.js", () => ({
  RedisProvider: vi.fn(),
}));

const mockedCreateProvider = createProvider as ReturnType<typeof vi.fn>;
const mockedRedisProvider = RedisProvider as unknown as ReturnType<
  typeof vi.fn
>;
const originalConfig = (global as any).__devtools_config;

const provider = (overrides: Record<string, unknown> = {}) => ({
  connect: vi.fn().mockResolvedValue(undefined),
  healthCheck: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  mockedCreateProvider.mockReset();
  mockedRedisProvider.mockReset();
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("providers_info", () => {
  it("returns safe configured provider information without connecting", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          enabled: true,
          default_engine: "postgresql",
          connections: {
            primary: {
              dsn: "postgresql://admin:db-secret@localhost:5432/app_db",
            },
            malformed: { dsn: "not a dsn" },
          },
        },
        gitlab: {
          enabled: true,
          token: "glpat-secret",
          url: "https://gitlab.example.com",
          projectId: 42,
        },
        redis: {
          enabled: true,
          default_connection: "cache",
          connections: {
            cache: { url: "redis://:redis-secret@localhost:6379" },
          },
        },
      },
    };

    const result = await parseToolJson(providersInfoTool, {});

    expect(result.database).toEqual({
      enabled: true,
      default_engine: "postgresql",
      connections: [
        {
          name: "primary",
          engine: "postgresql",
          database: "app_db",
          default: true,
          checked: false,
        },
        {
          name: "malformed",
          engine: "postgresql",
          database: null,
          default: false,
          checked: false,
        },
      ],
    });
    // GitLab is never contacted, and says so rather than leaving it to be guessed.
    expect(result.gitlab).toEqual({
      enabled: true,
      token_configured: true,
      checked: false,
    });
    expect(result.redis).toEqual({
      enabled: true,
      default_connection: "cache",
      // Denied by default: this config grants nothing, so writes are off.
      security: { allow_write: false, blocked_env: ["production", "prod"] },
      connections: {
        cache: {
          mode: "standalone",
          url: "redis://:***@localhost:6379",
          sentinels: [],
          master_name: null,
          role: null,
          sentinel_tls: null,
          auth_configured: true,
          sentinel_auth_configured: false,
          db: null,
          timeout: null,
          readonly: false,
          write_policy: { can_write: false, denied_by: ["no_grant"] },
          checked: false,
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /db-secret|redis-secret|glpat-secret|glpat-|postgresql:\/\/|gitlab\.example|projectId/,
    );
    expect(mockedCreateProvider).not.toHaveBeenCalled();
    expect(mockedRedisProvider).not.toHaveBeenCalled();
  });

  it.each([{}, { live: false }])(
    "does not create database providers when live checking is disabled",
    async (params) => {
      (global as any).__devtools_config = {
        providers: {
          database: {
            default_engine: "mysql",
            connections: {
              dev: { dsn: "mysql://localhost/dev" },
            },
          },
        },
      };

      await providersInfoTool.execute(params);

      expect(mockedCreateProvider).not.toHaveBeenCalled();
    },
  );

  it("checks every database connection and disconnects after success", async () => {
    const first = provider();
    const second = provider({ healthCheck: vi.fn().mockResolvedValue(false) });
    mockedCreateProvider
      .mockReturnValueOnce(first as any)
      .mockReturnValueOnce(second as any);
    (global as any).__devtools_config = {
      providers: {
        database: {
          default_engine: "postgresql",
          connections: {
            first: { dsn: "postgresql://localhost/first_db" },
            second: { dsn: "postgresql://localhost/second_db" },
          },
        },
      },
    };

    const result = await parseToolJson(providersInfoTool, { live: true });

    expect(mockedCreateProvider).toHaveBeenCalledTimes(2);
    expect(mockedCreateProvider).toHaveBeenNthCalledWith(1, "postgresql");
    expect(first.connect).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "postgresql://localhost/first_db" }),
    );
    expect(second.connect).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "postgresql://localhost/second_db" }),
    );
    expect(
      result.database.connections.map((item: any) => item.healthy),
    ).toEqual([true, false]);
    expect(
      result.database.connections.map((item: any) => item.checked),
    ).toEqual([true, true]);
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(second.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["connect", "healthCheck"])(
    "reports unhealthy and disconnects when %s fails",
    async (method) => {
      const failing = provider({
        [method]: vi.fn().mockRejectedValue(new Error("connection secret")),
      });
      mockedCreateProvider.mockReturnValue(failing as any);
      (global as any).__devtools_config = {
        providers: {
          database: {
            default_engine: "mariadb",
            connections: {
              dev: { dsn: "mariadb://localhost/app" },
            },
          },
        },
      };

      const result = await parseToolJson(providersInfoTool, { live: true });

      expect(result.database.connections[0].healthy).toBe(false);
      expect(failing.disconnect).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain("connection secret");
    },
  );

  it.each(["connect", "healthCheck"])(
    "names a reason when %s fails, without echoing the driver message",
    async (method) => {
      const failing = provider({
        [method]: vi
          .fn()
          .mockRejectedValue(new Error("probe could not complete")),
      });
      mockedCreateProvider.mockReturnValue(failing as any);
      (global as any).__devtools_config = {
        providers: {
          database: {
            default_engine: "postgresql",
            connections: { dev: { dsn: "postgresql://localhost/app" } },
          },
        },
      };

      const result = await parseToolJson(providersInfoTool, { live: true });
      const connection = result.database.connections[0];

      // `healthy: false` on its own is the dead end this replaces.
      expect(connection.healthy).toBe(false);
      expect(connection.failure.reason).toBe("connection_failed");
      expect(connection.failure.code).toBeNull();
      expect(connection.failure.hint).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain("probe could not complete");
    },
  );

  it("turns a TLS failure into the CA hint an agent can act on", async () => {
    const failing = provider({
      connect: vi
        .fn()
        .mockRejectedValue(
          Object.assign(
            new Error(
              "self-signed certificate in certificate chain for postgres://admin:hunter2@db.example.com:12273/db",
            ),
            { code: "SELF_SIGNED_CERT_IN_CHAIN" },
          ),
        ),
    });
    mockedCreateProvider.mockReturnValue(failing as any);
    (global as any).__devtools_config = {
      providers: {
        database: {
          default_engine: "postgresql",
          connections: {
            prod: {
              dsn: "postgres://admin:hunter2@db.example.com:12273/db?sslmode=require",
            },
          },
        },
      },
    };

    const result = await parseToolJson(providersInfoTool, { live: true });

    expect(result.database.connections[0].failure).toMatchObject({
      reason: "tls_certificate_untrusted",
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    expect(result.database.connections[0].failure.hint).toContain("ssl.ca");
    expect(JSON.stringify(result)).not.toMatch(/hunter2|db.example.com/);
  });

  it("does not connect when the database provider is disabled", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          enabled: false,
          default_engine: "postgresql",
          connections: {
            dev: { dsn: "postgresql://localhost/app" },
          },
        },
      },
    };

    const result = await parseToolJson(providersInfoTool, { live: true });

    expect(result.database.enabled).toBe(false);
    expect(result.database.connections[0]).not.toHaveProperty("healthy");
    expect(result.database.connections[0].checked).toBe(false);
    expect(mockedCreateProvider).not.toHaveBeenCalled();
  });

  it("checks every Redis connection and reports each one's health", async () => {
    const healthy = provider();
    const unreachable = provider({
      connect: vi
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED secret-host")),
    });
    mockedRedisProvider
      .mockImplementationOnce(() => healthy as any)
      .mockImplementationOnce(() => unreachable as any);

    (global as any).__devtools_config = {
      providers: {
        redis: {
          enabled: true,
          default_connection: "cache",
          connections: {
            cache: { url: "redis://:redis-secret@localhost:6379" },
            sessions: { url: "redis://:session-secret@redis.internal:6379" },
          },
        },
      },
    };

    const result = await parseToolJson(providersInfoTool, { live: true });

    expect(result.redis.connections.cache).toMatchObject({
      checked: true,
      healthy: true,
    });
    expect(result.redis.connections.sessions).toMatchObject({
      checked: true,
      healthy: false,
    });
    // The failure is classified rather than merely flagged, so the report says why.
    expect(result.redis.connections.sessions.failure.reason).toBe(
      "connection_failed",
    );
    expect(result.redis.connections.cache).not.toHaveProperty("failure");
    expect(mockedRedisProvider).toHaveBeenCalledTimes(2);
    expect(healthy.healthCheck).toHaveBeenCalledOnce();
    expect(healthy.disconnect).toHaveBeenCalledOnce();
    // The unreachable connection still releases its client and does not fail the report.
    expect(unreachable.disconnect).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(
      /redis-secret|session-secret|secret-host/,
    );
  });

  it("does not probe Redis when the provider is disabled", async () => {
    (global as any).__devtools_config = {
      providers: {
        redis: {
          enabled: false,
          connections: { cache: { url: "redis://localhost:6379" } },
        },
      },
    };

    const result = await parseToolJson(providersInfoTool, { live: true });

    expect(result.redis.connections.cache).toMatchObject({ checked: false });
    expect(result.redis.connections.cache).not.toHaveProperty("healthy");
    expect(mockedRedisProvider).not.toHaveBeenCalled();
  });
});
