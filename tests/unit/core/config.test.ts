import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
const originalCwd = process.cwd.bind(process);

const CONFIG_DIR = ".devtools";
const CONFIG_FILE = "config.yaml";

const writeConfig = (relativeDir: string, contents: string) => {
  const dir = join(tmpDir, relativeDir, CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CONFIG_FILE), contents, "utf-8");
};

const configPathIn = (...segments: string[]) =>
  join(tmpDir, ...segments, CONFIG_DIR, CONFIG_FILE);

/**
 * `configPath` is module-level state, so each case needs its own module instance.
 */
const loadFreshModule = async () => {
  vi.resetModules();
  return import("../../../src/core/config.js");
};

beforeEach(() => {
  // Each case re-imports the module, which re-runs dotenv; keep its tip banner out of
  // the test output.
  vi.stubEnv("DOTENV_CONFIG_QUIET", "true");
  tmpDir = mkdtempSync(join(tmpdir(), "devtools-config-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd());
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("config discovery", () => {
  it("finds the config by walking up from a nested working directory", async () => {
    writeConfig(".", "id_generator:\n  default: uuid\n");
    mkdirSync(join(tmpDir, "packages", "app"), { recursive: true });
    process.chdir(join(tmpDir, "packages", "app"));

    const { loadConfig, getConfigPath } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(config.id_generator).toEqual({ default: "uuid" });
    expect(getConfigPath()).toBe(configPathIn());
  });

  it("uses the nearest config when several exist up the tree", async () => {
    writeConfig(".", "id_generator:\n  default: ulid\n");
    writeConfig("packages/app", "id_generator:\n  default: uuid\n");
    process.chdir(join(tmpDir, "packages", "app"));

    const { loadConfig, getConfigPath } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(config.id_generator).toEqual({ default: "uuid" });
    expect(getConfigPath()).toBe(configPathIn("packages", "app"));
  });

  it("returns an empty config and a null path when no config exists", async () => {
    const { loadConfig, getConfigPath } = await loadFreshModule();

    expect(await loadConfig()).toEqual({});
    expect(getConfigPath()).toBeNull();
  });
});

describe("environment variable resolution", () => {
  it("resolves placeholders in scalars, nested maps and arrays", async () => {
    vi.stubEnv("DEV_DATABASE_URL", "postgresql://localhost/app");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    writeConfig(
      ".",
      [
        "providers:",
        "  database:",
        "    connections:",
        "      dev:",
        "        dsn: ${DEV_DATABASE_URL}",
        "blocked:",
        "  - ${REDIS_URL}",
        "  - literal",
        "mixed: prefix-${REDIS_URL}-suffix",
        "",
      ].join("\n"),
    );

    const { loadConfig } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(config.providers.database.connections.dev.dsn).toBe(
      "postgresql://localhost/app",
    );
    expect(config.blocked).toEqual(["redis://localhost:6379", "literal"]);
    expect(config.mixed).toBe("prefix-redis://localhost:6379-suffix");
  });

  it("resolves several placeholders inside one string", async () => {
    vi.stubEnv("HOST", "db.internal");
    vi.stubEnv("PORT", "5432");
    writeConfig(".", 'dsn: "postgresql://${HOST}:${PORT}/app"\n');

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).dsn).toBe(
      "postgresql://db.internal:5432/app",
    );
  });

  it("turns an unknown placeholder into an empty string instead of failing", async () => {
    writeConfig(".", "token: ${DEFINITELY_NOT_SET_ANYWHERE}\n");

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).token).toBe("");
  });

  it("leaves non-string values untouched", async () => {
    writeConfig(".", "count: 5\nenabled: true\nnothing: null\n");

    const { loadConfig } = await loadFreshModule();

    expect(await loadConfig()).toEqual({ count: 5, enabled: true, nothing: null });
  });
});

describe("reloadConfig", () => {
  it("re-reads the tracked path and sees edited content", async () => {
    writeConfig(".", "id_generator:\n  default: ulid\n");
    const { loadConfig, reloadConfig, getConfigPath } = await loadFreshModule();
    await loadConfig();

    writeConfig(".", "id_generator:\n  default: uuid\n");
    const reloaded = (await reloadConfig()) as any;

    expect(reloaded.id_generator).toEqual({ default: "uuid" });
    expect(getConfigPath()).toBe(configPathIn());
  });

  it("re-runs discovery when the tracked file disappears", async () => {
    writeConfig(".", "id_generator:\n  default: ulid\n");
    const mod = await loadFreshModule();
    await mod.loadConfig();
    expect(mod.getConfigPath()).toBe(configPathIn());

    rmSync(configPathIn());
    writeConfig("packages/app", "id_generator:\n  default: uuid\n");
    process.chdir(join(tmpDir, "packages", "app"));

    const reloaded = (await mod.reloadConfig()) as any;

    expect(reloaded.id_generator).toEqual({ default: "uuid" });
    expect(mod.getConfigPath()).toBe(configPathIn("packages", "app"));
  });

  it("returns an empty config when the tracked file is gone and nothing replaces it", async () => {
    writeConfig(".", "id_generator:\n  default: ulid\n");
    const mod = await loadFreshModule();
    await mod.loadConfig();

    rmSync(configPathIn());
    mkdirSync(join(tmpDir, "packages"), { recursive: true });
    process.chdir(join(tmpDir, "packages"));

    expect(await mod.reloadConfig()).toEqual({});
    expect(mod.getConfigPath()).toBeNull();
  });
});


describe("command values (cmd:)", () => {
  it("resolves a cmd: value from the command's stdout", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "token: cmd:printf 'glpat-from-pass\\n'\n");

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).token).toBe("glpat-from-pass");
  });

  it("strips one trailing newline and nothing else", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "token: cmd:printf 'abc\\n\\n'\n");

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).token).toBe("abc\n");
  });

  it("only treats a whole-value cmd: prefix as a command", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "dsn: prefix-cmd:printf 'pwned'\n");

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).dsn).toBe("prefix-cmd:printf 'pwned'");
  });

  it("does not execute a value that only expands into cmd:", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    vi.stubEnv("INJECTED", "cmd:printf 'pwned'");
    writeConfig(".", "token: ${INJECTED}\n");

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).token).toBe("cmd:printf 'pwned'");
  });

  it("expands environment variables inside the command body", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    vi.stubEnv("ACCOUNT", "accountb");
    writeConfig(".", "token: cmd:echo ${ACCOUNT}\n");

    const { loadConfig } = await loadFreshModule();

    expect(((await loadConfig()) as any).token).toBe("accountb");
  });

  it("refuses to run when the gate is closed, without failing the load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeConfig(".", "providers:\n  gitlab:\n    token: cmd:printf 'pwned'\n");

    const { loadConfig, getCmdKeys, isCmdAllowed } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(isCmdAllowed()).toBe(false);
    expect(config.providers.gitlab.token).toBe("");
    expect(getCmdKeys()).toEqual([
      { key: "providers.gitlab.token", resolved: false },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("providers.gitlab.token"),
    );

    warn.mockRestore();
  });

  it("runs, and records the key, when the gate is open", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "true");
    writeConfig(".", "providers:\n  gitlab:\n    token: cmd:printf 'ok'\n");

    const { loadConfig, getCmdKeys } = await loadFreshModule();

    expect(((await loadConfig()) as any).providers.gitlab.token).toBe("ok");
    expect(getCmdKeys()).toEqual([
      { key: "providers.gitlab.token", resolved: true },
    ]);
  });

  it("names the key path for values nested in maps and arrays", async () => {
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "blocked:\n  - cmd:printf 'a'\n");

    const { loadConfig, getCmdKeys } = await loadFreshModule();

    expect(((await loadConfig()) as any).blocked).toEqual(["a"]);
    expect(getCmdKeys()).toEqual([{ key: "blocked[0]", resolved: true }]);
  });

  it("survives a command that exits non-zero, naming the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "token: cmd:sh -c 'echo SECRET; exit 3'\n");

    const { loadConfig, getCmdKeys } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(config.token).toBe("");
    expect(getCmdKeys()).toEqual([{ key: "token", resolved: false }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("token"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("exited with status 3"),
    );

    warn.mockRestore();
  });

  it("never echoes the command's own output when it fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "token: cmd:sh -c 'echo SECRET; exit 1'\n");

    const { loadConfig } = await loadFreshModule();
    await loadConfig();

    // The warning names the key, never the output: stdout holds the secret being fetched.
    expect(warn.mock.calls.flat().join(" ")).not.toContain("SECRET");

    warn.mockRestore();
  });

  it("gives up on a command that hangs without failing the load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(".", "token: cmd:sleep 6\n");

    const { loadConfig, getCmdKeys } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(config.token).toBe("");
    expect(getCmdKeys()).toEqual([{ key: "token", resolved: false }]);
    expect(warn.mock.calls.flat().join(" ")).toContain("timed out");

    warn.mockRestore();
  }, 15000);

  it("keeps the load alive when one provider's command fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(
      ".",
      "providers:\n  gitlab:\n    token: cmd:sh -c 'exit 1'\n  database:\n    default_engine: postgresql\n    connections:\n      dev:\n        dsn: postgresql://localhost/app\n",
    );

    const { loadConfig } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    // The failure has no way to know which provider the caller wanted, so it must not
    // decide for them: GitLab degrades, the database is untouched.
    expect(config.providers.gitlab.token).toBe("");
    expect(config.providers.database.connections.dev.dsn).toBe(
      "postgresql://localhost/app",
    );

    warn.mockRestore();
  });

  it("does not run a command under a provider that is disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    const marker = join(tmpDir, "ran");
    writeConfig(
      ".",
      `providers:\n  gitlab:\n    enabled: false\n    token: cmd:touch ${marker}\n`,
    );

    const { loadConfig, getCmdKeys } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(existsSync(marker)).toBe(false);
    expect(config.providers.gitlab.token).toBe("");
    expect(config.providers.gitlab.enabled).toBe(false);
    expect(getCmdKeys()).toEqual([
      { key: "providers.gitlab.token", resolved: false },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("enabled: false"),
    );

    warn.mockRestore();
  });

  it("still runs the commands of an enabled provider beside a disabled one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEVTOOLS_ALLOW_CMD", "1");
    writeConfig(
      ".",
      "providers:\n  gitlab:\n    enabled: false\n    token: cmd:printf 'never'\n  redis:\n    url: cmd:printf 'redis://localhost:6379'\n",
    );

    const { loadConfig } = await loadFreshModule();
    const config = (await loadConfig()) as any;

    expect(config.providers.redis.url).toBe("redis://localhost:6379");

    warn.mockRestore();
  });

  it("only accepts 1/true as the gate", async () => {
    const cases: Array<[string | undefined, boolean]> = [
      [undefined, false],
      ["", false],
      ["1", true],
      ["true", true],
      ["TRUE", true],
      ["yes", false],
    ];

    for (const [value, expected] of cases) {
      vi.stubEnv("DEVTOOLS_ALLOW_CMD", value);
      const { isCmdAllowed } = await loadFreshModule();
      expect(isCmdAllowed()).toBe(expected);
    }
  });
});
