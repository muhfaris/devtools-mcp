import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providersInfoTool } from "../../../../src/tools/providers/info.js";
import { createProvider } from "../../../../src/providers/index.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

vi.mock("../../../../src/providers/index.js", () => ({
  createProvider: vi.fn(),
}));

const mockedCreateProvider = createProvider as ReturnType<typeof vi.fn>;
const originalConfig = (global as any).__devtools_config;

const provider = (overrides: Record<string, unknown> = {}) => ({
  connect: vi.fn().mockResolvedValue(undefined),
  healthCheck: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  mockedCreateProvider.mockReset();
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
        },
        {
          name: "malformed",
          engine: "postgresql",
          database: null,
          default: false,
        },
      ],
    });
    expect(result.gitlab).toEqual({
      enabled: true,
      token_configured: true,
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
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /db-secret|redis-secret|glpat-secret|glpat-|postgresql:\/\/|gitlab\.example|projectId/,
    );
    expect(mockedCreateProvider).not.toHaveBeenCalled();
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
    mockedCreateProvider.mockReturnValueOnce(first as any).mockReturnValueOnce(second as any);
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
    expect(result.database.connections.map((item: any) => item.healthy)).toEqual([
      true,
      false,
    ]);
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
    expect(mockedCreateProvider).not.toHaveBeenCalled();
  });
});
