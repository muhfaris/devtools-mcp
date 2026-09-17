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
});
