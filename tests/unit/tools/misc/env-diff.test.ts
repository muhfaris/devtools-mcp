import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { envDiffTool } from "../../../../src/tools/misc/env-diff.js";

describe("envDiffTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-diff-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should detect missing, extra, and empty keys via raw text", async () => {
    const envText = `
PORT=3000
DATABASE_URL=postgres://localhost:5432/db
EXTRA_KEY=foo
EMPTY_KEY=
    `.trim();

    const exampleText = `
PORT=8080
DATABASE_URL=
MISSING_KEY=some_value
EMPTY_KEY=placeholder
    `.trim();

    const result = await envDiffTool.execute({
      envText,
      exampleText,
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.synced).toBe(false);
    expect(data.missing).toEqual(["MISSING_KEY"]);
    expect(data.extra).toEqual(["EXTRA_KEY"]);
    expect(data.empty).toEqual(["EMPTY_KEY"]);
    expect(data.matching).toContain("PORT");
    expect(data.matching).toContain("DATABASE_URL");
    expect(data.values).toBeUndefined();
  });

  it("should report synced when env matches example without empty keys", async () => {
    const envText = `
PORT=3000
DB_HOST=127.0.0.1
    `.trim();

    const exampleText = `
PORT=
DB_HOST=
    `.trim();

    const result = await envDiffTool.execute({
      envText,
      exampleText,
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.synced).toBe(true);
    expect(data.missing).toHaveLength(0);
    expect(data.empty).toHaveLength(0);
  });

  it("should include values when includeValues is true", async () => {
    const envText = "PORT=3000";
    const exampleText = "PORT=8080";

    const result = await envDiffTool.execute({
      envText,
      exampleText,
      includeValues: true,
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.values).toBeDefined();
    expect(data.values.env.PORT).toBe("3000");
    expect(data.values.example.PORT).toBe("8080");
  });

  it("should compare files on disk", async () => {
    const envPath = path.join(tmpDir, ".env");
    const examplePath = path.join(tmpDir, ".env.example");

    await fs.writeFile(envPath, "FOO=bar\nBAR=baz");
    await fs.writeFile(examplePath, "FOO=\nBAR=\nBAZ=");

    const result = await envDiffTool.execute({
      envPath,
      examplePath,
    });

    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.missing).toEqual(["BAZ"]);
    expect(data.sources.env).toBe(envPath);
    expect(data.sources.example).toBe(examplePath);
  });

  it("should throw error if file is missing", async () => {
    await expect(
      envDiffTool.execute({
        envPath: path.join(tmpDir, "non-existent.env"),
        exampleText: "FOO=bar",
      }),
    ).rejects.toThrow("Failed to read env file");
  });
});
