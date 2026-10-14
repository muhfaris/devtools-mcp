import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findIgnoredKeys } from "../../../src/core/known-keys.js";

describe("findIgnoredKeys", () => {
  it("reports nothing for the documented surface", () => {
    expect(
      findIgnoredKeys({
        id_generator: { default: "ulid" },
        security: { allow_write: false, blocked_env: ["production"] },
        codegraph: { enabled: true, exclude: ["node_modules"] },
        providers: {
          database: {
            enabled: true,
            default_engine: "mariadb",
            security: { allow_write: false },
            connections: {
              dev: {
                dsn: "mariadb://localhost/app",
                pool_size: 5,
                timeout: 30000,
                connect_timeout: 10000,
                readonly: true,
                ssl: { ca: "/etc/ca.pem", rejectUnauthorized: true },
              },
            },
          },
          redis: {
            enabled: true,
            default_connection: "dev",
            security: {},
            connections: {
              dev: { url: "redis://localhost", readonly: true },
              sentinel: {
                sentinels: [{ host: "10.0.0.1", port: 26379 }],
                master_name: "mymaster",
                role: "slave",
                sentinel_username: "u",
                sentinel_password: "p",
                sentinel_tls: true,
                username: "u",
                password: "p",
                db: 0,
                timeout: 5000,
              },
            },
          },
          gitlab: {
            enabled: true,
            url: "https://gitlab.com",
            token: "t",
            projectId: 1,
          },
        },
      }),
    ).toEqual([]);
  });

  it("names a stray key by its full path", () => {
    expect(
      findIgnoredKeys({
        providers: {
          database: { connections: { dev: { dsn: "x", readonlyd: true } } },
        },
      }),
    ).toEqual([{ key: "providers.database.connections.dev.readonlyd" }]);
  });

  it("says where a key that moved belongs", () => {
    const [finding] = findIgnoredKeys({
      database: { connections: { dev: { dsn: "x" } } },
    });

    expect(finding.key).toBe("database");
    expect(finding.hint).toContain("providers.database");
  });

  it("reports a nested block the schema does not have", () => {
    expect(
      findIgnoredKeys({ providers: { database: { connect_timeout: 10 } } }),
    ).toEqual([{ key: "providers.database.connect_timeout" }]);
  });

  it("treats every name under connections as a connection", () => {
    expect(
      findIgnoredKeys({
        providers: {
          redis: { connections: { "whatever-name": { url: "x", bogus: 1 } } },
        },
      }),
    ).toEqual([{ key: "providers.redis.connections.whatever-name.bogus" }]);
  });

  it("does not descend into a value the table declares a leaf", () => {
    // `blocked_env` is a list, not a block: its contents are entries, not keys.
    expect(
      findIgnoredKeys({ security: { blocked_env: ["production"] } }),
    ).toEqual([]);
    expect(findIgnoredKeys({ id_generator: { default: "ulid" } })).toEqual([]);
  });

  it("survives a config that is not shaped like a config", () => {
    expect(findIgnoredKeys(undefined)).toEqual([]);
    expect(findIgnoredKeys(null)).toEqual([]);
    expect(findIgnoredKeys("not a config")).toEqual([]);
  });
});

describe("loadConfig reports what it did not read", () => {
  const dirs: string[] = [];
  const originalCwd = process.cwd();

  /** Write a config, make it the one discovery finds, and load it. */
  const withConfig = async (yaml: string) => {
    const dir = mkdtempSync(join(tmpdir(), "devtools-known-keys-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".devtools"), { recursive: true });
    writeFileSync(join(dir, ".devtools", "config.yaml"), yaml);
    process.chdir(dir);
    const config = await import("../../../src/core/config.js");
    return {
      config,
      configPath: join(dir, ".devtools", "config.yaml"),
      loaded: await config.loadConfig(),
    };
  };

  afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("warns on stderr and remembers the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { config } = await withConfig(
      [
        "providers:",
        "  database:",
        "    default_engine: mariadb",
        "    connections:",
        "      dev:",
        "        dsn: mysql://localhost/app",
        "        readonly: true",
        "        poolsize: 5",
      ].join("\n"),
    );

    expect(config.getIgnoredKeys()).toEqual([
      { key: "providers.database.connections.dev.poolsize" },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain(
      "providers.database.connections.dev.poolsize",
    );
  });

  it("reports the same list through show_config", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loaded } = await withConfig(
      [
        "providers:",
        "  gitlab:",
        "    token: t",
        "    projectId: 1",
        "    host: https://gitlab.example.com",
      ].join("\n"),
    );

    const { getSafeConfigView } =
      await import("../../../src/tools/config/show.js");

    expect(getSafeConfigView(loaded).ignored_keys).toEqual([
      {
        key: "providers.gitlab.host",
        hint: "The GitLab instance address is `url` (e.g. `url: https://gitlab.example.com`).",
      },
    ]);
  });

  it("clears the list when the file is deleted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { config, configPath } = await withConfig(
      ["providers:", "  gitlab:", "    token: t", "    host: x"].join("\n"),
    );

    expect(config.getIgnoredKeys()).toHaveLength(1);

    rmSync(configPath);

    // The file is gone: the findings were about a document that no longer exists, and
    // carrying them into the next load would report a key nobody can go and fix.
    expect(await config.reloadConfig()).toEqual({});
    expect(config.getIgnoredKeys()).toEqual([]);
  });
});
