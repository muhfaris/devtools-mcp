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
      providers: {
        gitlab: {
          url: "https://gitlab.example.com",
          token: "token",
          projectId: "group/project",
        },
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    const commitsAll = vi.fn().mockResolvedValue(mockCommits);
    (client as any).Commits = { all: commitsAll };

    const res = await parseToolJson(gitlabGetCommitsTool, {
      ref: "feat/my-branch",
      limit: 5,
    });

    // The finding this replaces: `perPage: 5` was passed and `maxPages` was not, and
    // @gitbeaker's page bound is `maxPages && perPage ? ... : true` — so it walked the
    // repository's entire history and answered a five-commit question with 33k lines.
    expect(commitsAll.mock.calls[0][1]).toEqual({
      perPage: 5,
      maxPages: 1,
      refName: "feat/my-branch",
    });
    expect(res.limit).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.total).toBe(1);
    expect(res.commits[0].shortId).toBe("sha1234");
    expect(res.commits[0].authorName).toBe("Alice");
    // The fixture's message has a body; it is not part of the default answer.
    expect(res.commits[0].message).toBeUndefined();
  });

  it("leaves out each commit's body unless it is asked for", async () => {
    (global as any).__devtools_config = {
      providers: {
        gitlab: {
          url: "https://gitlab.example.com",
          token: "token",
          projectId: "group/project",
        },
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).Commits = {
      all: vi.fn().mockResolvedValue([
        {
          id: "sha1234567890",
          short_id: "sha1234",
          title: "feat: new feature",
          message: "feat: new feature\n\nWhy: because the old one broke",
          author_name: "Alice",
          authored_date: "2026-09-09T00:00:00Z",
        },
      ]),
    };

    const withMessages = await parseToolJson(gitlabGetCommitsTool, {
      limit: 1,
      include_messages: true,
    });

    expect(withMessages.commits[0].title).toBe("feat: new feature");
    expect(withMessages.commits[0].message).toContain(
      "Why: because the old one broke",
    );
  });

  it("says so when the page came back full", async () => {
    (global as any).__devtools_config = {
      providers: {
        gitlab: {
          url: "https://gitlab.example.com",
          token: "token",
          projectId: "group/project",
        },
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).Commits = {
      all: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: 5 }, (_, index) => ({ id: `sha${index}` })),
        ),
    };

    const res = await parseToolJson(gitlabGetCommitsTool, { limit: 5 });

    // A full page is what GitLab returns when more exist, so five of five is not "five
    // commits in this branch" — and saying nothing is what made the count misleading.
    expect(res.truncated).toBe(true);
  });
});
