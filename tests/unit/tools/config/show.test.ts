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
      database: {
        default_engine: "mariadb",
        connections: {
          dev: {
            dsn: "mariadb://dev:secret@localhost:3306/app?ssl=true",
            readonly: false,
          },
          staging: {
            dsn: "mariadb://stage:secret@db.example.com/app?password=hidden&access_token=also-hidden&ssl=true",
            readonly: true,
          },
        },
      },
      gitlab: {
        url: "https://gitlab.example.com",
        token: "glpat-secret",
        projectId: 42,
      },
      security: {
        execute_query: { allow_write: false, blocked_env: ["production"] },
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
      url: "https://gitlab.example.com",
      projectId: 42,
      token_configured: true,
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
              readonly: true,
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
            readonly: true,
          },
        },
      },
    };

    const result = await parseToolJson(showConfigTool, {});
    expect(
      result.database.connections["dev-production"].credentials_exposed,
    ).toBe(false);
  });
});
