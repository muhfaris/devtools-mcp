import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabGetMrTool } from "../../../../src/tools/gitlab/get-mr.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_get_mr", () => {
  it("fetches MR using only mr_url without explicit project_id or mr_id", async () => {
    const mockShow = vi.fn().mockResolvedValue({
      iid: 1227,
      title: "Add helpdesk ticket feature",
      state: "opened",
      author: { username: "faris" },
      web_url: "https://gitlab.example.com/group/project/-/merge_requests/1227",
    });
    const mockShowChanges = vi.fn().mockResolvedValue({ changes: [] });

    (global as any).__devtools_config = {
      providers: {
        gitlab: {
          url: "https://gitlab.example.com",
          token: "token",
        },
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: mockShow,
      showChanges: mockShowChanges,
    };

    const res = await parseToolJson(gitlabGetMrTool, {
      mr_url: "https://gitlab.example.com/group/project/-/merge_requests/1227",
    });

    expect(mockShow).toHaveBeenCalledWith("group/project", 1227);
    expect(res.id).toBe(1227);
    expect(res.title).toBe("Add helpdesk ticket feature");
  });

  it("numbers every line of a changed file for both sides", async () => {
    const mockShow = vi.fn().mockResolvedValue({
      iid: 7,
      title: "Ticket",
      state: "opened",
    });
    const mockShowChanges = vi.fn().mockResolvedValue({
      changes: [
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          additions: 1,
          deletions: 1,
          diff: "@@ -8,2 +8,2 @@\n context\n-old\n+new",
        },
      ],
    });

    (global as any).__devtools_config = {
      providers: {
        gitlab: { url: "https://gitlab.com", token: "token", projectId: 1 },
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: mockShow,
      showChanges: mockShowChanges,
    };

    const res = await parseToolJson(gitlabGetMrTool, { mr_id: 7 });

    expect(res.diff[0].lines).toEqual([
      { old_line: 8, new_line: 8, type: "unchanged", text: "context" },
      { old_line: 9, new_line: null, type: "removed", text: "old" },
      { old_line: null, new_line: 9, type: "added", text: "new" },
    ]);
  });

  it("omits line numbering when diff_lines is false", async () => {
    const mockShow = vi.fn().mockResolvedValue({
      iid: 7,
      title: "Ticket",
      state: "opened",
    });
    const mockShowChanges = vi.fn().mockResolvedValue({
      changes: [
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -8,2 +8,2 @@\n context\n-old\n+new",
        },
      ],
    });

    (global as any).__devtools_config = {
      providers: {
        gitlab: { url: "https://gitlab.com", token: "token", projectId: 1 },
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: mockShow,
      showChanges: mockShowChanges,
    };

    const res = await parseToolJson(gitlabGetMrTool, {
      mr_id: 7,
      diff_lines: false,
    });

    expect(res.diff[0].lines).toBeUndefined();
    expect(res.diff[0].diff).toContain("context");
  });
});
