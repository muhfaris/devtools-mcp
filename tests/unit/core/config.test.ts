import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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
