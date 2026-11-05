import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import {
  getGitHubClient,
  pageIsFull,
  resolvePrId,
} from "../../providers/github.js";
import type {
  GitHubComment,
  GitHubReview,
} from "../../providers/github-types.js";
import { assertGitHubReadable } from "./guard.js";

const PAGE = 100;

export const githubGetPrDiscussionsTool: Tool = {
  name: "github_get_pr_discussions",
  description:
    "Get all comments on a GitHub pull request: issue comments (conversation), review comments (inline, with path and line), and review summaries. Each list is one page of 100; `truncated` says a list stopped at the cap. GitHub has no discussion threads or resolved flag in REST, so replies are flat and carry inReplyTo.",
  params: {
    pr_url: {
      type: "string",
      optional: true,
      description: "Full GitHub pull request URL",
    },
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    pr_id: {
      type: "number",
      optional: true,
      description:
        "Pull request number. Must match the number in pr_url when both are provided.",
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);
    const prId = resolvePrId(params);
    const client = getGitHubClient();

    try {
      const [issueComments, reviewComments, reviews] = await Promise.all([
        client.request<GitHubComment[]>({
          path: `/repos/${repo}/issues/${prId}/comments`,
          query: { per_page: PAGE },
        }),
        client.request<GitHubComment[]>({
          path: `/repos/${repo}/pulls/${prId}/comments`,
          query: { per_page: PAGE },
        }),
        client.request<GitHubReview[]>({
          path: `/repos/${repo}/pulls/${prId}/reviews`,
          query: { per_page: PAGE },
        }),
      ]);

      const comments = [
        ...issueComments.map((comment) => ({
          id: comment.id,
          kind: "issue_comment" as const,
          author: comment.user?.login ?? null,
          body: comment.body,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          url: comment.html_url,
          path: null,
          line: null,
          side: null,
          inReplyTo: null,
        })),
        ...reviewComments.map((comment) => ({
          id: comment.id,
          kind: "review_comment" as const,
          author: comment.user?.login ?? null,
          body: comment.body,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          url: comment.html_url,
          path: comment.path ?? null,
          line: comment.line ?? comment.original_line ?? null,
          side: comment.side ?? null,
          inReplyTo: comment.in_reply_to_id ?? null,
        })),
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const result = {
        repo,
        prId,
        totalComments: comments.length,
        totalReviews: reviews.length,
        truncated:
          pageIsFull(issueComments.length, PAGE) ||
          pageIsFull(reviewComments.length, PAGE) ||
          pageIsFull(reviews.length, PAGE),
        pageSize: PAGE,
        comments,
        reviews: reviews.map((review) => ({
          id: review.id,
          author: review.user?.login ?? null,
          state: review.state,
          body: review.body ?? "",
          submittedAt: review.submitted_at ?? null,
          url: review.html_url,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitHubError("get pull request discussions", error);
    }
  },
};
