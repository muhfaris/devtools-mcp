import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGitHub } from "../../../../src/providers/github.js";
import { githubGetPrTool } from "../../../../src/tools/github/get-pr.js";
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

const pull = {
  number: 7,
  title: "Add widget",
  body: "Body",
  state: "open",
  draft: false,
  merged: false,
  user: { login: "dev" },
  head: { ref: "feat/widget", sha: "sha-head" },
  base: { ref: "main" },
  labels: [{ name: "feature" }],
  assignees: [{ login: "reviewer" }],
  requested_reviewers: [{ login: "other" }],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  closed_at: null,
  merged_at: null,
  html_url: "https://github.com/acme/widget/pull/7",
  mergeable: true,
  mergeable_state: "clean",
};

describe("github_get_pr", () => {
  it("numbers both sides of a changed file and reports one page", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: pull },
      {
        body: [
          {
            sha: "abcdef1234567",
            commit: {
              message: "fix: the thing\n\nThe queue drained twice.",
              author: {
                name: "Dev",
                email: "dev@example.com",
                date: "2026-10-01T00:00:00Z",
              },
            },
            author: { login: "dev" },
            html_url: "https://github.com/acme/widget/commit/abcdef1",
          },
        ],
      },
      {
        body: [
          {
            filename: "src/app.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            changes: 2,
            sha: "filesha",
            patch: "@@ -8,2 +8,2 @@\n context\n-old\n+new",
          },
        ],
      },
    );
    useGitHubConfig();

    const res = await parseToolJson(githubGetPrTool, { pr_id: 7 });

    expect(res.id).toBe(7);
    expect(res.sourceBranch).toBe("feat/widget");
    expect(res.diff[0].lines).toEqual([
      { old_line: 8, new_line: 8, type: "unchanged", text: "context" },
      { old_line: 9, new_line: null, type: "removed", text: "old" },
      { old_line: null, new_line: 9, type: "added", text: "new" },
    ]);
    // Commit subjects are the default; the body is opt-in.
    expect(res.commits[0].title).toBe("fix: the thing");
    expect(res.commits[0].message).toBeUndefined();
    expect(res.truncated).toEqual({
      commits: false,
      files: false,
      discussions: false,
    });
    expect(net.calls[2].url.pathname).toBe(
      "/repos/acme/widget/pulls/7/files",
    );
    net.restore();
  });

  it("marks a file whose patch GitHub withheld without faking its counts", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: pull },
      { body: [] },
      {
        body: [
          {
            filename: "assets/logo.png",
            status: "added",
            additions: 0,
            deletions: 0,
            changes: 0,
            sha: "bin",
          },
          {
            filename: "src/app.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            changes: 2,
            sha: "filesha",
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
    );
    useGitHubConfig();

    const res = await parseToolJson(githubGetPrTool, { pr_id: 7 });

    expect(res.diff[0]).toMatchObject({
      file: "assets/logo.png",
      diffOmitted: "unavailable",
      additions: 0,
      deletions: 0,
      lines: [],
    });
    expect(res.diff[1]).toMatchObject({
      file: "src/app.ts",
      diffOmitted: null,
      additions: 1,
      deletions: 1,
    });
    expect(res.diffOmittedCount).toBe(1);
    expect(res.statsComplete).toBe(false);
    net.restore();
  });

  it("omits line numbering and commit bodies when asked to trim", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: pull },
      {
        body: [
          {
            sha: "abcdef1234567",
            commit: {
              message: "fix: the thing\n\nBody",
              author: { name: "Dev", email: "d@e", date: "2026-10-01" },
            },
            author: null,
            html_url: "u",
          },
        ],
      },
      {
        body: [
          {
            filename: "src/app.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            changes: 1,
            sha: "f",
            patch: "@@ -1 +1,2 @@\n context\n+added",
          },
        ],
      },
    );
    useGitHubConfig();

    const res = await parseToolJson(githubGetPrTool, {
      pr_id: 7,
      diff_lines: false,
      include_messages: true,
    });

    expect(res.diff[0].lines).toBeUndefined();
    expect(res.diff[0].diff).toContain("context");
    expect(res.commits[0].message).toContain("Body");
    net.restore();
  });

  it("reads the number from the pull request URL", async () => {
    const net = mockFetch();
    net.enqueue({ body: pull }, { body: [] }, { body: [] });
    useGitHubConfig({ repo: undefined });

    const res = await parseToolJson(githubGetPrTool, {
      pr_url: "https://github.com/acme/widget/pull/7",
    });

    expect(res.id).toBe(7);
    expect(net.calls[0].url.pathname).toBe("/repos/acme/widget/pulls/7");
    net.restore();
  });
});
