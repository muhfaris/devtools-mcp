import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCompareBranchesTool } from "../../../../src/tools/gitlab/compare-branches.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_compare_branches", () => {
  it("compares two branches and returns diffs and commits", async () => {
    const mockComparison = {
      commits: [
        {
          id: "c1",
          short_id: "c1s",
          title: "feat: change A",
          message: "feat: change A",
          author_name: "Dev",
          authored_date: "2026-09-09T00:00:00Z",
        },
      ],
      diffs: [
        {
          new_path: "src/service.go",
          old_path: "src/service.go",
          new_file: false,
          deleted_file: false,
          renamed_file: false,
          diff: "+ new line\n- old line",
        },
      ],
    };

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
    (client as any).Repositories = {
      compare: vi.fn().mockResolvedValue(mockComparison),
    };

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
    });

    expect((client as any).Repositories.compare).toHaveBeenCalledWith(
      "group/project",
      "main",
      "feat/my-branch",
      { straight: false },
    );
    expect(res.commitsCount).toBe(1);
    expect(res.filesCount).toBe(1);
    expect(res.diffs[0].file).toBe("src/service.go");
  });
});
