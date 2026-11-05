import { ToolError } from "../../core/errors.js";
import { getGitHubClient } from "../../providers/github.js";
import type { GitHubComment } from "../../providers/github-types.js";

export type CommentKind = "review_comment" | "issue_comment";

export type FoundComment = { kind: CommentKind; comment: GitHubComment };

/**
 * Locate a comment and say which endpoint owns it.
 *
 * GitHub splits comments in two: a review comment has its own id space under
 * `/pulls/comments/{id}`, and a conversation comment lives under `/issues/comments/{id}`.
 * An id alone does not say which, so the pull request's comment lists decide. Both are
 * read at GitHub's page ceiling, and a miss says so instead of reading as "not yours".
 */
export const findComment = async (
  repo: string,
  prId: number,
  commentId: number,
): Promise<FoundComment> => {
  const client = getGitHubClient();

  const reviewComments = await client.request<GitHubComment[]>({
    path: `/repos/${repo}/pulls/${prId}/comments`,
    query: { per_page: 100 },
  });
  const review = reviewComments.find((comment) => comment.id === commentId);
  if (review) return { kind: "review_comment", comment: review };

  const issueComments = await client.request<GitHubComment[]>({
    path: `/repos/${repo}/issues/${prId}/comments`,
    query: { per_page: 100 },
  });
  const issue = issueComments.find((comment) => comment.id === commentId);
  if (issue) return { kind: "issue_comment", comment: issue };

  throw new ToolError(
    "GITHUB_COMMENT_NOT_FOUND",
    `Comment ${commentId} is not on pull request ${prId}.`,
    "Use an id returned by github_get_pr_discussions or github_create_comment. Only the first 100 comments of each list are searched.",
    false,
    { parameter: "comment_id" },
  );
};

/** A comment id has to be a real positive integer before it is worth a round trip. */
export const resolveCommentId = (params: Record<string, unknown>): number => {
  const commentId = Number(params.comment_id);

  if (!Number.isInteger(commentId) || commentId <= 0) {
    throw new ToolError(
      "GITHUB_COMMENT_ID_INVALID",
      "comment_id must be a positive integer.",
      "Use the numeric id of the comment, as returned by github_create_comment or github_get_pr_discussions.",
      false,
      { parameter: "comment_id" },
    );
  }

  return commentId;
};

/** The endpoint that owns a comment kind. */
export const commentPath = (
  kind: CommentKind,
  repo: string,
  commentId: number,
): string =>
  kind === "review_comment"
    ? `/repos/${repo}/pulls/comments/${commentId}`
    : `/repos/${repo}/issues/comments/${commentId}`;
