import { afterEach, describe, expect, it } from "vitest";
import { showConfigTool } from "../../../../src/tools/config/show.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("show_config", () => {
  it("exposes development DSNs and sanitizes other connection credentials", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          enabled: true,
          default_engine: "mariadb",
          connections: {
            dev: {
              dsn: "mariadb://dev:secret@localhost:3306/app?ssl=true",
            },
            staging: {
              dsn: "mariadb://stage:secret@db.example.com/app?password=hidden&access_token=also-hidden&ssl=true",
            },
          },
        },
        gitlab: {
          enabled: true,
          url: "https://gitlab.example.com",
          token: "glpat-secret",
          projectId: 42,
        },
      },
      security: {
        allow_write: true,
        blocked_env: ["production"],
      },
    };

    const result = await parseToolJson(showConfigTool, {});

    expect(result.database.connections.dev).toMatchObject({
      dsn: "mariadb://dev:secret@localhost:3306/app?ssl=true",
      credentials_exposed: true,
    });
    expect(result.database.connections.staging).toMatchObject({
      dsn: "mariadb://***:***@db.example.com/app?password=***&access_token=***&ssl=true",
      credentials_exposed: false,
    });
    expect(JSON.stringify(result)).not.toContain("glpat-secret");
    expect(result.gitlab).toEqual({
      enabled: true,
      url: "https://gitlab.example.com",
      projectId: 42,
      security: { allow_write: true, blocked_env: ["production"] },
      token_configured: true,
    });
    // One chain serves every provider, so the shared grant reaches the database too.
    expect(result.database.security).toEqual({
      allow_write: true,
      blocked_env: ["production"],
    });
    expect(result.security).toEqual({ allow_write: true, blocked_env: ["production"] });
  });

  it("echoes an unset shared block and the per-provider default", async () => {
    (global as any).__devtools_config = {
      providers: {
        redis: { enabled: true, connections: { dev: { url: "redis://localhost" } } },
      },
    };

    const result = await parseToolJson(showConfigTool, {});

    expect(result.security).toEqual({ allow_write: null, blocked_env: null });
    expect(result.redis.security).toEqual({
      allow_write: false,
      blocked_env: ["production", "prod"],
    });
  });

  it.each(["local", "LOCAL", "development"])(
    "recognizes %s as a development connection",
    async (name) => {
      (global as any).__devtools_config = {
        database: {
          default_engine: "postgresql",
          connections: {
            [name]: {
              dsn: "postgresql://user:pass@localhost/app",
            },
          },
        },
      };

      const result = await parseToolJson(showConfigTool, {});
      expect(result.database.connections[name].credentials_exposed).toBe(true);
    },
  );

  it("does not treat prefixed names as development", async () => {
    (global as any).__devtools_config = {
      database: {
        default_engine: "postgresql",
        connections: {
          "dev-production": {
            dsn: "postgresql://user:pass@host/app",
          },
        },
      },
    };

    const result = await parseToolJson(showConfigTool, {});
    expect(
      result.database.connections["dev-production"].credentials_exposed,
    ).toBe(false);
  });

  it("describes standalone and sentinel Redis connections without secrets", async () => {
    (global as any).__devtools_config = {
      providers: {
        redis: {
          enabled: true,
          default_connection: "sentinel-dev",
          connections: {
            dev: {
              url: "redis://:dev-secret@localhost:6379/2",
              db: 2,
              timeout: 5000,
            },
            "sentinel-prod": {
              sentinels: [
                { host: "10.0.0.1", port: 26379 },
                { host: "10.0.0.2" },
              ],
              master_name: "mymaster",
              role: "slave",
              sentinel_username: "sentinel-user",
              sentinel_password: "sentinel-pass",
              password: "data-pass",
              sentinel_tls: true,
            },
          },
        },
      },
    };

    const result = await parseToolJson(showConfigTool, {});
    const connections = result.redis.connections;

    expect(connections.dev).toMatchObject({
      mode: "standalone",
      url: "redis://:dev-secret@localhost:6379/2",
      sentinels: [],
      master_name: null,
      role: null,
      db: 2,
      timeout: 5000,
      auth_configured: true,
    });

    expect(connections["sentinel-prod"]).toEqual({
      mode: "sentinel",
      url: null,
      sentinels: ["10.0.0.1:26379", "10.0.0.2:26379"],
      master_name: "mymaster",
      role: "slave",
      sentinel_tls: true,
      auth_configured: true,
      sentinel_auth_configured: true,
      db: null,
      timeout: null,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /sentinel-pass|data-pass|sentinel-user|data-user/,
    );
  });
});
