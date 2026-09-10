import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCreateNoteTool } from "../../../../src/tools/gitlab/create-note.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import { ToolError } from "../../../../src/core/errors.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_create_note", () => {
  it("uses custom host and per-call project_id for note URLs", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 555,
      body: "LGTM",
      author: { username: "tester" },
      created_at: "2026-09-09T00:00:00Z",
    });

    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.example.org",
        token: "token",
        projectId: 100,
      },
    };

    // Mock client
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequestNotes = {
      create: mockCreate,
    };

    const res = await parseToolJson(gitlabCreateNoteTool, {
      project_id: 200,
      mr_id: 12,
      body: "LGTM",
    });

    expect(mockCreate).toHaveBeenCalledWith(200, 12, "LGTM");
    expect(res.url).toBe("https://gitlab.example.org/200/-/merge_requests/12#note_555");
  });

  it("throws INVALID_ARGUMENT when body is empty", async () => {
    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "token",
        projectId: 100,
      },
    };

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "   " }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      parameter: "body",
    });
  });

  it("posts a multi-line code comment with line_range", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 777,
      body: "Multi-line review",
      author: { username: "tester" },
      created_at: "2026-09-09T00:00:00Z",
    });

    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "token",
        projectId: 100,
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "abc123",
        diff_refs: {
          base_sha: "base",
          head_sha: "head",
          start_sha: "start",
        },
      }),
    };
    (client as any).MergeRequestNotes = {
      create: mockCreate,
    };

    const res = await parseToolJson(gitlabCreateNoteTool, {
      project_id: 200,
      mr_id: 12,
      body: "Multi-line review",
      path: "src/app.ts",
      start_line: 10,
      end_line: 15,
      side: "right",
    });

    const [, , , options] = mockCreate.mock.calls[0];
    expect(options.position.line_range).toMatchObject({
      start: { new_line: 10, old_line: undefined, type: "new" },
      end: { new_line: 15, old_line: undefined, type: "new" },
    });
    expect(options.position.new_path).toBe("src/app.ts");
    expect(res.url).toContain("#note_777");
  });
});
