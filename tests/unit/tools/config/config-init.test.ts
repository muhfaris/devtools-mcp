import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolError } from "../../../../src/core/errors.js";
import { configInitTool } from "../../../../src/tools/misc/config-init.js";

const originalChdir = process.chdir;
const originalCwd = process.cwd.bind(process);
let tmpDir: string;

const resetRuntime = () => {
  (global as any).__devtools_config = undefined;
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "config-init-"));
  process.chdir(tmpDir);
  resetRuntime();
});

afterEach(() => {
  process.chdir = originalChdir;
  process.chdir(originalCwd());
  rmSync(tmpDir, { recursive: true, force: true });
  resetRuntime();
});

const run = async (params: Record<string, any>) => {
  const res = await configInitTool.execute(params as any);
  return JSON.parse(res.content?.[0]?.text || "{}");
};

describe("config_init", () => {
  it("refuses to overwrite an existing .devtools/config.yaml", async () => {
    const dir = join(tmpDir, ".devtools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.yaml"), "existing", "utf-8");
    await expect(configInitTool.execute({} as any)).rejects.toThrow(ToolError);
  });

  it("writes a config.yaml with database, gitlab, and redis", async () => {
    const out = await run({
      database: [
        {
          name: "dev",
          dsn: "postgresql://localhost/dev",
          engine: "postgresql",
        },
      ],
      gitlab: {
        url: "https://gitlab.com",
        tokenEnv: "GITLAB_TOKEN",
        projectId: "123",
      },
      redis: [{ name: "cache", url: "redis://localhost:6379/1", db: 1 }],
    });

    expect(out.ok).toBe(true);
    const file = readFileSync(
      join(tmpDir, ".devtools", "config.yaml"),
      "utf-8",
    );
    expect(file).toContain("dsn: postgresql://localhost/dev");
    expect(file).toContain("${GITLAB_TOKEN}");
    expect(file).toContain("url: redis://localhost:6379/1");
    expect(file).toContain("id_generator:");
    // Asserted as a connection key, not as the word: the scaffolded comments mention
    // `readonly` to explain the option, and a plain substring test would fail on prose.
    expect(file).not.toMatch(/^\s+readonly:/m);
    expect(out.data.path).toContain(".devtools/config.yaml");
  });

  it("updates runtime so show_config reflects the new file", async () => {
    await run({
      database: [{ name: "prod", dsn: "postgresql://localhost/prod" }],
    });
    expect((global as any).__devtools_config).toBeTruthy();
  });

  it("writes a minimal valid file when no providers given", async () => {
    const out = await run({ idGenerator: "uuid" });
    expect(out.ok).toBe(true);
    const file = readFileSync(
      join(tmpDir, ".devtools", "config.yaml"),
      "utf-8",
    );
    expect(file).toContain("id_generator:");
    expect(file).toContain("uuid");
  });

  it("emits readonly only for a connection that asked for it", async () => {
    await run({
      database: [
        { name: "dev", dsn: "postgresql://localhost/dev" },
        {
          name: "reporting",
          dsn: "postgresql://localhost/reporting",
          readonly: true,
        },
      ],
    });

    const file = readFileSync(
      join(tmpDir, ".devtools", "config.yaml"),
      "utf-8",
    );
    const dbBlock = file.slice(file.indexOf("  database:"));

    expect(file.match(/^\s+readonly: true$/gm)).toHaveLength(1);
    expect(dbBlock).toContain("reporting:");
    // The guard belongs to the connection it was asked for, not to the provider.
    expect(dbBlock.slice(0, dbBlock.indexOf("reporting:"))).not.toContain(
      "readonly",
    );
  });

  it("scaffolds the shared write policy once, with no per-connection flag", async () => {
    await run({
      redis: [{ name: "cache", url: "redis://localhost:6379/1" }],
    });

    const file = readFileSync(
      join(tmpDir, ".devtools", "config.yaml"),
      "utf-8",
    );
    expect(file).not.toMatch(/^\s+readonly:/m);

    // No provider-scoped block: the shared one is the single place to edit.
    const redisBlock = file.slice(file.indexOf("  redis:"));
    expect(redisBlock).not.toContain("security:");
    expect(redisBlock).not.toContain("allow_write");

    const sharedBlock = file.slice(
      file.indexOf("security:"),
      file.indexOf("providers:"),
    );
    expect(sharedBlock).toContain("allow_write: false");
    expect(sharedBlock).toContain("blocked_env: [production, prod]");
    expect(file.match(/^security:/gm)).toHaveLength(1);
  });
});
