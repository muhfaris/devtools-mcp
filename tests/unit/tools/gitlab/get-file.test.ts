import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabGetFileTool } from "../../../../src/tools/gitlab/get-file.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_get_file", () => {
  it("fetches and decodes base64 file content from gitlab repository", async () => {
    const rawContent = "package main\n\nfunc main() {}\n";
    const base64Content = Buffer.from(rawContent).toString("base64");

    const mockShow = vi.fn().mockResolvedValue({
      file_name: "main.go",
      file_path: "cmd/main.go",
      size: rawContent.length,
      encoding: "base64",
      content_sha256: "hash123",
      ref: "feat/my-branch",
      blob_id: "blob123",
      commit_id: "commit123",
      last_commit_id: "last123",
      content: base64Content,
    });

    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.example.com",
        token: "token",
        projectId: "group/project",
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).RepositoryFiles = {
      show: mockShow,
    };

    const res = await parseToolJson(gitlabGetFileTool, {
      file_path: "cmd/main.go",
      ref: "feat/my-branch",
    });

    expect(mockShow).toHaveBeenCalledWith(
      "group/project",
      "cmd/main.go",
      "feat/my-branch",
    );
    expect(res.fileName).toBe("main.go");
    expect(res.content).toBe(rawContent);
  });
});
