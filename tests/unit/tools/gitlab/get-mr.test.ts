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
      web_url:
        "https://gitlab.example.com/group/project/-/merge_requests/1227",
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
      mr_url:
        "https://gitlab.example.com/group/project/-/merge_requests/1227",
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

  it("leaves out each commit's body unless it is asked for", async () => {
    const mockShow = vi
      .fn()
      .mockResolvedValue({ iid: 7, title: "Ticket", state: "opened" });
    const mockShowChanges = vi.fn().mockResolvedValue({ changes: [] });
    const allCommits = vi.fn().mockResolvedValue([
      {
        id: "c1",
        short_id: "c1s",
        title: "fix: the thing",
        message: "fix: the thing\n\nThe queue drained twice on restart.",
        author_name: "Dev",
        created_at: "2026-09-09T00:00:00Z",
      },
    ]);

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
      allCommits,
    };

    const trimmed = await parseToolJson(gitlabGetMrTool, { mr_id: 7 });
    const withMessages = await parseToolJson(gitlabGetMrTool, {
      mr_id: 7,
      include_messages: true,
    });

    expect(trimmed.commits[0].title).toBe("fix: the thing");
    expect(trimmed.commits[0].message).toBeUndefined();
    expect(withMessages.commits[0].message).toContain("drained twice");
    // One page of 100, as the other lists are: without `maxPages` the client walks every
    // page of the MR's history.
    expect(allCommits.mock.calls[0][2]).toEqual({ perPage: 100, maxPages: 1 });
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

  it("marks a file whose patch GitLab withheld instead of reporting an empty change", async () => {
    const mockShow = vi.fn().mockResolvedValue({
      iid: 7,
      title: "Ticket",
      state: "opened",
    });
    const mockShowChanges = vi.fn().mockResolvedValue({
      changes: [
        {
          // A new file whose patch GitLab dropped: `a_mode` is 000000, and the empty
          // patch must not be read as an unchanged file.
          old_path: "service/tag_status_mapping/service.go",
          new_path: "service/tag_status_mapping/service.go",
          new_file: true,
          a_mode: "000000",
          b_mode: "100644",
          diff: "",
        },
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -1 +1 @@\n-old\n+new",
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

    expect(res.diff[0]).toMatchObject({
      file: "service/tag_status_mapping/service.go",
      diffOmitted: "limit",
      additions: null,
      deletions: null,
      lines: [],
    });
    // A patch that came back is numbered and counted as before.
    expect(res.diff[1]).toMatchObject({
      file: "src/app.ts",
      diffOmitted: null,
      additions: 1,
      deletions: 1,
    });
    expect(res.diffOmittedCount).toBe(1);
    expect(res.statsComplete).toBe(false);
  });
});
