import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
        { name: "dev", dsn: "postgresql://localhost/dev", readonly: false, engine: "postgresql" },
      ],
      gitlab: { url: "https://gitlab.com", tokenEnv: "GITLAB_TOKEN", projectId: "123" },
      redis: [{ name: "cache", url: "redis://localhost:6379/1", readonly: true, db: 1 }],
    });

    expect(out.ok).toBe(true);
    const file = readFileSync(join(tmpDir, ".devtools", "config.yaml"), "utf-8");
    expect(file).toContain("dsn: postgresql://localhost/dev");
    expect(file).toContain("${GITLAB_TOKEN}");
    expect(file).toContain("url: redis://localhost:6379/1");
    expect(file).toContain("id_generator:");
    expect(out.data.path).toContain(".devtools/config.yaml");
  });

  it("updates runtime so show_config reflects the new file", async () => {
    await run({
      database: [{ name: "prod", dsn: "postgresql://localhost/prod", readonly: true }],
    });
    expect((global as any).__devtools_config).toBeTruthy();
  });

  it("writes a minimal valid file when no providers given", async () => {
    const out = await run({ idGenerator: "uuid" });
    expect(out.ok).toBe(true);
    const file = readFileSync(join(tmpDir, ".devtools", "config.yaml"), "utf-8");
    expect(file).toContain("id_generator:");
    expect(file).toContain("uuid");
  });

  it("does not emit a Redis security block that would disable writes", async () => {
    await run({
      redis: [{ name: "cache", url: "redis://localhost:6379/1", readonly: false }],
    });
    const file = readFileSync(join(tmpDir, ".devtools", "config.yaml"), "utf-8");
    const redisBlock = file.slice(file.indexOf("  redis:"));
    expect(redisBlock).toContain("readonly: false");
    expect(redisBlock).not.toContain("allow_write");
    expect(redisBlock).not.toContain("security:");
  });
});