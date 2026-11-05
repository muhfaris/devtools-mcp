import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGitHub } from "../../../../src/providers/github.js";
import { githubCreateCommentTool } from "../../../../src/tools/github/create-comment.js";
import { githubUpdateCommentTool } from "../../../../src/tools/github/update-comment.js";
import { githubDeleteCommentTool } from "../../../../src/tools/github/delete-comment.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import {
  mockFetch,
  useGitHubConfig,
} from "../../../helpers/github-test-helper.js";

const originalConfig = (global as any).__devtools_config;

const granted = { security: { allow_write: true } };

const reviewComment = {
  id: 901,
  body: "Old body",
  user: { login: "tester" },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  html_url: "https://github.com/acme/widget/pull/12#discussion_r901",
  path: "src/app.ts",
  line: 9,
  side: "RIGHT",
  in_reply_to_id: undefined,
};

beforeEach(() => {
  clearGitHub();
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
  clearGitHub();
});

describe("github_create_comment", () => {
  it("posts a conversation comment when no path is given", async () => {
    const net = mockFetch();
    net.enqueue({ status: 201, body: reviewComment });
    useGitHubConfig(granted);

    const res = await parseToolJson(githubCreateCommentTool, {
      pr_id: 12,
      body: "Looks good",
    });

    const [{ url, init }] = net.calls;
    expect(url.pathname).toBe("/repos/acme/widget/issues/12/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ body: "Looks good" });
    expect(res).toMatchObject({ kind: "issue_comment", success: true });
    net.restore();
  });

  it("attaches an inline comment to the pull request head commit", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: { head: { sha: "head-sha" } } },
      { status: 201, body: reviewComment },
    );
    useGitHubConfig(granted);

    const res = await parseToolJson(githubCreateCommentTool, {
      pr_id: 12,
      body: "Nit",
      path: "src/app.ts",
      line: 9,
    });

    expect(net.calls[0].url.pathname).toBe("/repos/acme/widget/pulls/12");
    const [{ url, init }] = net.calls.slice(1);
    expect(url.pathname).toBe("/repos/acme/widget/pulls/12/comments");
    expect(JSON.parse(String(init.body))).toEqual({
      body: "Nit",
      commit_id: "head-sha",
      path: "src/app.ts",
      side: "RIGHT",
      line: 9,
    });
    expect(res).toMatchObject({
      kind: "review_comment",
      line: 9,
      success: true,
    });
  });

  it("needs a line or a range for an inline comment", async () => {
    useGitHubConfig(granted);
    await expect(
      githubCreateCommentTool.execute({
        pr_id: 12,
        body: "Nit",
        path: "src/app.ts",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "line" });
  });

  it("denies writes when nothing grants them", async () => {
    useGitHubConfig();

    await expect(
      githubCreateCommentTool.execute({ pr_id: 12, body: "Hi" }),
    ).rejects.toMatchObject({
      code: "GITHUB_WRITE_DISABLED",
      configKey: "providers.github.security.allow_write",
    });
  });

  it("blocks a repository matching a blocked_env entry", async () => {
    useGitHubConfig({
      repo: "acme/production-widget",
      security: { allow_write: true, blocked_env: ["production"] },
    });

    await expect(
      githubCreateCommentTool.execute({ pr_id: 12, body: "Hi" }),
    ).rejects.toMatchObject({ code: "GITHUB_ENVIRONMENT_BLOCKED" });
  });
});

describe("github_update_comment", () => {
  it("finds a review comment's endpoint and reports what it replaced", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: [reviewComment] },
      { body: { ...reviewComment, body: "Corrected", updated_at: "later" } },
    );
    useGitHubConfig(granted);

    const res = await parseToolJson(githubUpdateCommentTool, {
      pr_id: 12,
      comment_id: 901,
      body: "Corrected",
    });

    expect(net.calls[1].url.pathname).toBe(
      "/repos/acme/widget/pulls/comments/901",
    );
    expect(net.calls[1].init.method).toBe("PATCH");
    expect(res).toMatchObject({
      kind: "review_comment",
      body: "Corrected",
      previousBody: "Old body",
      success: true,
    });
    net.restore();
  });

  it("falls back to the issue-comment endpoint for a conversation comment", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: [] },
      { body: [{ ...reviewComment, id: 555, path: undefined, line: null }] },
      { body: { ...reviewComment, id: 555, body: "Corrected" } },
    );
    useGitHubConfig(granted);

    const res = await parseToolJson(githubUpdateCommentTool, {
      pr_id: 12,
      comment_id: 555,
      body: "Corrected",
    });

    expect(net.calls[2].url.pathname).toBe(
      "/repos/acme/widget/issues/comments/555",
    );
    expect(res.kind).toBe("issue_comment");
    net.restore();
  });

  it("rejects a comment id that is not a positive integer", async () => {
    useGitHubConfig(granted);
    await expect(
      githubUpdateCommentTool.execute({
        pr_id: 12,
        comment_id: 0,
        body: "Corrected",
      }),
    ).rejects.toMatchObject({
      code: "GITHUB_COMMENT_ID_INVALID",
      parameter: "comment_id",
    });
  });
});

describe("github_delete_comment", () => {
  it("describes the comment and stops without confirmation", async () => {
    const net = mockFetch();
    net.enqueue({ body: [reviewComment] });
    useGitHubConfig(granted);

    const res = await parseToolJson(githubDeleteCommentTool, {
      pr_id: 12,
      comment_id: 901,
    });

    expect(res).toMatchObject({
      deleted: false,
      confirmationRequired: true,
    });
    expect(res.wouldDelete).toMatchObject({ id: 901, body: "Old body" });
    expect(net.calls).toHaveLength(1);
    net.restore();
  });

  it("deletes the comment once confirmed", async () => {
    const net = mockFetch();
    net.enqueue({ body: [reviewComment] }, { status: 204, text: "" });
    useGitHubConfig(granted);

    const res = await parseToolJson(githubDeleteCommentTool, {
      pr_id: 12,
      comment_id: 901,
      confirm: true,
    });

    expect(net.calls[1].init.method).toBe("DELETE");
    expect(net.calls[1].url.pathname).toBe(
      "/repos/acme/widget/pulls/comments/901",
    );
    expect(res).toMatchObject({ deleted: true, success: true });
    net.restore();
  });

  it("names a comment that is not on the pull request", async () => {
    const net = mockFetch();
    net.enqueue({ body: [] }, { body: [] });
    useGitHubConfig(granted);

    await expect(
      githubDeleteCommentTool.execute({
        pr_id: 12,
        comment_id: 404,
        confirm: true,
      }),
    ).rejects.toMatchObject({
      code: "GITHUB_COMMENT_NOT_FOUND",
      parameter: "comment_id",
    });
    net.restore();
  });
});
