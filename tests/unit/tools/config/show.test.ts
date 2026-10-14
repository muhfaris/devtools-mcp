import { afterEach, describe, expect, it } from "vitest";
import { showConfigTool } from "../../../../src/tools/config/show.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

const databaseConfig = (connections: Record<string, { dsn: string }>) => ({
  providers: {
    database: { enabled: true, default_engine: "mariadb", connections },
  },
});

describe("show_config", () => {
  it("masks credentials on every connection by default", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          enabled: true,
          default_engine: "mariadb",
          connections: {
            dev: {
              dsn: "mariadb://mariadb:mariadb@localhost:3306/app?ssl=true",
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
      dsn: "mariadb://***:***@localhost:3306/app?ssl=true",
      credentials_exposed: false,
    });
    expect(result.database.connections.staging).toMatchObject({
      dsn: "mariadb://***:***@db.example.com/app?password=***&access_token=***&ssl=true",
      credentials_exposed: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("mariadb:mariadb");
    expect(serialized).not.toContain("glpat-secret");
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
  });

  it("reports the TLS and timeout settings as paths, never as certificate contents", async () => {
    (global as any).__devtools_config = {
      providers: {
        database: {
          enabled: true,
          default_engine: "postgresql",
          connections: {
            prod: {
              dsn: "postgres://user:pass@db.example.com:12273/db?sslmode=require",
              connect_timeout: 10000,
              ssl: { ca: "/etc/ssl/aiven-ca.pem", rejectUnauthorized: true },
            },
            dev: { dsn: "postgresql://user:pass@127.0.0.1:5433/app" },
          },
        },
      },
    };

    const result = await parseToolJson(showConfigTool, {});

    expect(result.database.connections.prod).toMatchObject({
      connect_timeout: 10000,
      ssl: {
        ca: "/etc/ssl/aiven-ca.pem",
        cert: null,
        key: null,
        rejectUnauthorized: true,
      },
    });
    // A connection declaring no TLS block says so, rather than implying a default.
    expect(result.database.connections.dev).toMatchObject({
      connect_timeout: null,
      ssl: null,
    });
    // The certificate is read at connect time; `show_config` never holds its contents.
    expect(JSON.stringify(result)).not.toContain("BEGIN CERTIFICATE");
  });

  it("unmasks development connections only when show_credentials is set", async () => {
    (global as any).__devtools_config = databaseConfig({
      dev: { dsn: "mariadb://mariadb:mariadb@localhost:3306/app" },
      staging: { dsn: "mariadb://stage:secret@db.example.com/app" },
    });

    const result = await parseToolJson(showConfigTool, { show_credentials: true });

    expect(result.database.connections.dev).toMatchObject({
      dsn: "mariadb://mariadb:mariadb@localhost:3306/app",
      credentials_exposed: true,
    });
    expect(result.database.connections.staging).toMatchObject({
      dsn: "mariadb://***:***@db.example.com/app",
      credentials_exposed: false,
    });
  });

  it("stays masked when show_credentials is explicitly false", async () => {
    (global as any).__devtools_config = databaseConfig({
      dev: { dsn: "mariadb://mariadb:mariadb@localhost:3306/app" },
    });

    const result = await parseToolJson(showConfigTool, { show_credentials: false });

    expect(result.database.connections.dev).toMatchObject({
      dsn: "mariadb://***:***@localhost:3306/app",
      credentials_exposed: false,
    });
  });

  it("reports the per-provider default when nothing grants writes", async () => {
    (global as any).__devtools_config = {
      providers: {
        redis: { enabled: true, connections: { dev: { url: "redis://localhost" } } },
      },
    };

    const result = await parseToolJson(showConfigTool, {});

    expect(result.redis.security).toEqual({
      allow_write: false,
      blocked_env: ["production", "prod"],
    });
  });

  it.each(["local", "LOCAL", "development"])(
    "recognizes %s as opt-in-unmaskable",
    async (name) => {
      (global as any).__devtools_config = databaseConfig({
        [name]: { dsn: "postgresql://user:pass@localhost/app" },
      });

      const masked = await parseToolJson(showConfigTool, {});
      expect(masked.database.connections[name].credentials_exposed).toBe(false);

      const exposed = await parseToolJson(showConfigTool, {
        show_credentials: true,
      });
      expect(exposed.database.connections[name].credentials_exposed).toBe(true);
    },
  );

  it("does not unmask a prefixed name even when opted in", async () => {
    (global as any).__devtools_config = databaseConfig({
      "dev-production": { dsn: "postgresql://user:pass@host/app" },
    });

    const result = await parseToolJson(showConfigTool, { show_credentials: true });

    expect(result.database.connections["dev-production"]).toMatchObject({
      dsn: "postgresql://***:***@host/app",
      credentials_exposed: false,
    });
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
      url: "redis://:***@localhost:6379/2",
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
      /dev-secret|sentinel-pass|data-pass|sentinel-user|data-user/,
    );
  });

  it("unmasks the development Redis URL only when show_credentials is set", async () => {
    (global as any).__devtools_config = {
      providers: {
        redis: {
          enabled: true,
          connections: {
            dev: { url: "redis://:dev-secret@localhost:6379/2" },
            cache: { url: "redis://:cache-secret@localhost:6379/1" },
          },
        },
      },
    };

    const result = await parseToolJson(showConfigTool, { show_credentials: true });

    expect(result.redis.connections.dev.url).toBe(
      "redis://:dev-secret@localhost:6379/2",
    );
    expect(result.redis.connections.cache.url).toBe(
      "redis://:***@localhost:6379/1",
    );
  });
});
