import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabGetCommitsTool } from "../../../../src/tools/gitlab/get-commits.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_get_commits", () => {
  it("fetches commits for a branch/ref", async () => {
    const mockCommits = [
      {
        id: "sha1234567890",
        short_id: "sha1234",
        title: "feat: new feature",
        message: "feat: new feature\n\nDetailed message",
        author_name: "Alice",
        author_email: "alice@example.com",
        authored_date: "2026-09-09T00:00:00Z",
        created_at: "2026-09-09T00:00:00Z",
        web_url: "https://gitlab.com/project/-/commit/sha1234",
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
    (client as any).Commits = {
      all: vi.fn().mockResolvedValue(mockCommits),
    };

    const res = await parseToolJson(gitlabGetCommitsTool, {
      ref: "feat/my-branch",
      limit: 5,
    });

    expect(res.total).toBe(1);
    expect(res.commits[0].shortId).toBe("sha1234");
    expect(res.commits[0].authorName).toBe("Alice");
  });
});
