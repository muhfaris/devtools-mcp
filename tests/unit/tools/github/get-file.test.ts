import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGitHub } from "../../../../src/providers/github.js";
import { githubGetFileTool } from "../../../../src/tools/github/get-file.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import {
  headerOf,
  mockFetch,
  useGitHubConfig,
} from "../../../helpers/github-test-helper.js";

const originalConfig = (global as any).__devtools_config;

beforeEach(() => {
  clearGitHub();
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
  clearGitHub();
});

const CONTENT = "line one\nneedle here\nline three";

describe("github_get_file", () => {
  it("reads raw content at a ref rather than the JSON envelope", async () => {
    const net = mockFetch();
    net.enqueue({ text: CONTENT });
    useGitHubConfig();

    const res = await parseToolJson(githubGetFileTool, {
      file_path: "src/app.ts",
      ref: "feat/widget",
    });

    const { url, init } = net.calls[0];
    expect(url.pathname).toBe("/repos/acme/widget/contents/src/app.ts");
    expect(url.searchParams.get("ref")).toBe("feat/widget");
    expect(headerOf(init, "accept")).toBe("application/vnd.github.raw");
    expect(res.totalLines).toBe(3);
    expect(res.content).toContain("needle here");
    expect(res.isSliced).toBe(false);
    net.restore();
  });

  it("greps with line numbers", async () => {
    const net = mockFetch();
    net.enqueue({ text: CONTENT });
    useGitHubConfig();

    const res = await parseToolJson(githubGetFileTool, {
      file_path: "src/app.ts",
      pattern: "needle",
    });

    expect(res.totalMatches).toBe(1);
    expect(res.matches).toEqual([{ line: 2, text: "needle here" }]);
    net.restore();
  });

  it("slices a line range and clamps it to the file", async () => {
    const net = mockFetch();
    net.enqueue({ text: CONTENT });
    useGitHubConfig();

    const res = await parseToolJson(githubGetFileTool, {
      file_path: "src/app.ts",
      start_line: 2,
      end_line: 99,
    });

    expect(res.isSliced).toBe(true);
    expect(res.startLine).toBe(2);
    expect(res.endLine).toBe(3);
    expect(res.content).toBe("needle here\nline three");
    net.restore();
  });

  it("refuses an empty file path before calling GitHub", async () => {
    useGitHubConfig();
    await expect(
      githubGetFileTool.execute({ file_path: "  " }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      parameter: "file_path",
    });
  });
});
