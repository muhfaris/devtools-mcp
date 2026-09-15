import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { diffTool } from "../../../../src/tools/misc/diff.js";

describe("diffTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should detect identical texts", async () => {
    const result = await diffTool.execute({
      text1: "line1\nline2\nline3",
      text2: "line1\nline2\nline3",
    });
    const text = result.content?.[0]?.text;
    expect(text).toContain("(no differences)");
  });

  it("should generate unified diff for text differences", async () => {
    const result = await diffTool.execute({
      text1: "apple\nbanana\ncherry",
      text2: "apple\nblueberry\ncherry\ndate",
    });
    const text = result.content?.[0]?.text;
    expect(text).toContain("--- text1");
    expect(text).toContain("+++ text2");
    expect(text).toContain("-banana");
    expect(text).toContain("+blueberry");
    expect(text).toContain("+date");
  });

  it("should support json format output", async () => {
    const result = await diffTool.execute({
      text1: "hello\nworld",
      text2: "hello\nbrave\nnew\nworld",
      format: "json",
    });
    const parsed = JSON.parse(result.content?.[0]?.text || "{}");
    expect(parsed.identical).toBe(false);
    expect(parsed.stats.additions).toBe(2);
    expect(parsed.stats.deletions).toBe(0);
    expect(parsed.hunks).toBeDefined();
    expect(parsed.hunks.length).toBeGreaterThan(0);
  });

  it("should support summary format output", async () => {
    const result = await diffTool.execute({
      text1: "foo\nbar",
      text2: "foo\nbaz",
      format: "summary",
    });
    const parsed = JSON.parse(result.content?.[0]?.text || "{}");
    expect(parsed.identical).toBe(false);
    expect(parsed.additions).toBe(1);
    expect(parsed.deletions).toBe(1);
    expect(parsed.totalChanges).toBe(2);
  });

  it("should support ignoreWhitespace option", async () => {
    const resultNoIgnore = await diffTool.execute({
      text1: "const x = 1;",
      text2: "const x  =  1; ",
      ignoreWhitespace: false,
      format: "summary",
    });
    const summaryNoIgnore = JSON.parse(resultNoIgnore.content?.[0]?.text || "{}");
    expect(summaryNoIgnore.identical).toBe(false);

    const resultIgnore = await diffTool.execute({
      text1: "const x = 1;",
      text2: "const x  =  1; ",
      ignoreWhitespace: true,
      format: "summary",
    });
    const summaryIgnore = JSON.parse(resultIgnore.content?.[0]?.text || "{}");
    expect(summaryIgnore.identical).toBe(true);
  });

  it("should compare files from disk", async () => {
    const file1 = path.join(tmpDir, "file1.txt");
    const file2 = path.join(tmpDir, "file2.txt");

    await fs.writeFile(file1, "alpha\nbeta\ngamma");
    await fs.writeFile(file2, "alpha\nbeta 2.0\ngamma");

    const result = await diffTool.execute({
      file1,
      file2,
      format: "unified",
    });

    const text = result.content?.[0]?.text;
    expect(text).toContain(`--- ${file1}`);
    expect(text).toContain(`+++ ${file2}`);
    expect(text).toContain("-beta");
    expect(text).toContain("+beta 2.0");
  });

  it("should throw error if input files/texts are missing", async () => {
    await expect(diffTool.execute({})).rejects.toThrow(
      "Either 'file1' or 'text1' must be provided",
    );
    await expect(diffTool.execute({ text1: "abc" })).rejects.toThrow(
      "Either 'file2' or 'text2' must be provided",
    );
  });

  it("should throw error if file path does not exist", async () => {
    await expect(
      diffTool.execute({ file1: "/non/existent/path/1.txt", text2: "abc" }),
    ).rejects.toThrow("Failed to read file1");
  });
});
