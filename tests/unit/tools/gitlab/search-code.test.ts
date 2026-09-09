import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabSearchCodeTool } from "../../../../src/tools/gitlab/search-code.js";
import { gitlabGetFileTool } from "../../../../src/tools/gitlab/get-file.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_search_code and pattern grep", () => {
  it("searches code blobs across repository using gitlab Search API", async () => {
    const mockSearchResults = [
      {
        basename: "example_file",
        filename: "internal/core/service/example/example_file.go",
        path: "internal/core/service/example/example_file.go",
        ref: "main",
        startline: 42,
        data: "func (s *Service) persistComplaintDeadline()",
      },
    ];

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
    (client as any).Search = {
      all: vi.fn().mockResolvedValue(mockSearchResults),
    };

    const res = await parseToolJson(gitlabSearchCodeTool, {
      search: "persistComplaintDeadline",
      ref: "main",
    });

    expect(res.totalFound).toBe(1);
    expect(res.results[0].filename).toContain("example_file.go");
  });

  it("greps pattern regex directly inside file with gitlab_get_file", async () => {
    const rawContent = `package service

func (s *Service) GetDeadline() {}
func helper() {}
func (s *Service) UpdateDeadline() {}
`;
    const base64Content = Buffer.from(rawContent).toString("base64");

    const mockShow = vi.fn().mockResolvedValue({
      file_name: "example_file.go",
      file_path: "internal/service/example_file.go",
      size: rawContent.length,
      encoding: "base64",
      ref: "main",
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
      file_path: "internal/service/example_file.go",
      pattern: "^func \\(s \\*Service\\)",
      ref: "main",
    });

    expect(res.totalMatches).toBe(2);
    expect(res.matches[0]).toEqual({
      line: 3,
      text: "func (s *Service) GetDeadline() {}",
    });
    expect(res.matches[1]).toEqual({
      line: 5,
      text: "func (s *Service) UpdateDeadline() {}",
    });
  });
});
