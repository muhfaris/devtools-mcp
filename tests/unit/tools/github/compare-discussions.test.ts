import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGitHub } from "../../../../src/providers/github.js";
import { githubCompareBranchesTool } from "../../../../src/tools/github/compare-branches.js";
import { githubGetPrDiscussionsTool } from "../../../../src/tools/github/discussions.js";
import { githubReviewPrTool } from "../../../../src/tools/github/review-pr.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import {
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

const comparison = {
  status: "ahead",
  ahead_by: 2,
  behind_by: 0,
  total_commits: 1,
  commits: [
    {
      sha: "c0ffee1234567",
      commit: {
        message: "fix: compare\n\nBody",
        author: { name: "Dev", email: "d@e", date: "2026-10-01T00:00:00Z" },
      },
      author: { login: "dev" },
      html_url: "u",
    },
  ],
  files: [
    {
      filename: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      sha: "f1",
      patch: "@@ -1 +1,2 @@\n context\n+added\n+more",
    },
    {
      filename: "assets/logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
      changes: 0,
      sha: "f2",
    },
  ],
};

describe("github_compare_branches", () => {
  it("returns commits and files, and reads conflict status from a pull request", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: comparison },
      {
        body: [
          {
            number: 9,
            title: "Widget",
            html_url: "https://github.com/acme/widget/pull/9",
            mergeable: false,
          },
        ],
      },
    );
    useGitHubConfig();

    const res = await parseToolJson(githubCompareBranchesTool, {
      from: "main",
      to: "feat",
    });

    expect(net.calls[0].url.pathname).toBe(
      "/repos/acme/widget/compare/main...feat",
    );
    expect(res.mergeStatus).toBe("conflicts");
    expect(res.mergeStatusSource).toBe("existing_pull_request");
    expect(res.pullRequest.id).toBe(9);
    expect(res.commits[0].title).toBe("fix: compare");
    expect(res.commits[0].message).toBeUndefined();
    expect(res.files[0]).toMatchObject({
      file: "src/app.ts",
      additions: 2,
      deletions: 1,
      diffOmitted: null,
    });
    // A withheld patch is marked; its counts come from the API and stay real.
    expect(res.files[1]).toMatchObject({
      file: "assets/logo.png",
      diffOmitted: "unavailable",
    });
    expect(res.diffOmittedCount).toBe(1);
    expect(net.calls[1].url.searchParams.get("head")).toBe("acme:feat");
    net.restore();
  });

  it("says unknown when no pull request exists for the pair", async () => {
    const net = mockFetch();
    net.enqueue({ body: comparison }, { body: [] });
    useGitHubConfig();

    const res = await parseToolJson(githubCompareBranchesTool, {
      from: "main",
      to: "feat",
    });

    expect(res.mergeStatus).toBe("unknown");
    expect(res.mergeStatusSource).toBe("not_available");
    net.restore();
  });

  it("requires both refs", async () => {
    useGitHubConfig();
    await expect(
      githubCompareBranchesTool.execute({ from: "main" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "to" });
  });
});

describe("github_get_pr_discussions", () => {
  it("merges conversation comments and review comments in time order", async () => {
    const net = mockFetch();
    net.enqueue(
      {
        body: [
          {
            id: 1,
            body: "conversation",
            user: { login: "a" },
            created_at: "2026-10-01T00:00:00Z",
            updated_at: "2026-10-01T00:00:00Z",
            html_url: "u1",
          },
        ],
      },
      {
        body: [
          {
            id: 2,
            body: "inline",
            user: { login: "b" },
            created_at: "2026-10-02T00:00:00Z",
            updated_at: "2026-10-02T00:00:00Z",
            html_url: "u2",
            path: "src/app.ts",
            line: 4,
            side: "RIGHT",
            in_reply_to_id: 1,
          },
        ],
      },
      {
        body: [
          {
            id: 3,
            user: { login: "c" },
            state: "APPROVED",
            body: "LGTM",
            submitted_at: "2026-10-03T00:00:00Z",
            html_url: "u3",
          },
        ],
      },
    );
    useGitHubConfig();

    const res = await parseToolJson(githubGetPrDiscussionsTool, { pr_id: 12 });

    expect(res.totalComments).toBe(2);
    expect(res.comments[0]).toMatchObject({ id: 1, kind: "issue_comment" });
    expect(res.comments[1]).toMatchObject({
      id: 2,
      kind: "review_comment",
      path: "src/app.ts",
      line: 4,
      inReplyTo: 1,
    });
    expect(res.reviews[0]).toMatchObject({ state: "APPROVED", body: "LGTM" });
    net.restore();
  });
});

describe("github_review_pr", () => {
  it("reviews files with a patch and never counts a withheld one as clean", async () => {
    const net = mockFetch();
    net.enqueue(
      {
        body: {
          number: 7,
          title: "Add widget",
          state: "open",
          draft: false,
          user: { login: "dev" },
          html_url: "https://github.com/acme/widget/pull/7",
        },
      },
      {
        body: [
          {
            filename: "src/app.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            changes: 1,
            sha: "f1",
            patch: "@@ -1 +1,2 @@\n context\n+console.log('x')",
          },
          {
            filename: "assets/logo.png",
            status: "added",
            additions: 0,
            deletions: 0,
            changes: 0,
            sha: "f2",
          },
        ],
      },
    );
    useGitHubConfig();

    const res = await parseToolJson(githubReviewPrTool, { pr_id: 7 });

    expect(res.filesReviewed).toBe(1);
    expect(res.files[0].suggestions).toContain(
      "Found console.log - consider removing before merge",
    );
    expect(res.files[1]).toMatchObject({
      reviewed: false,
      diffOmitted: "unavailable",
      suggestions: [],
    });
    expect(res.filesNotReviewed).toEqual([
      { file: "assets/logo.png", diffOmitted: "unavailable" },
    ]);
    expect(res.summary).toContain("Not Reviewed");
    net.restore();
  });
});
