import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient } from "../../providers/github.js";
import type { GitHubComment } from "../../providers/github-types.js";
import { commentPath, findComment, resolveCommentId } from "./comments.js";
import { assertPullWriteAllowed, requireText } from "./guard.js";

export const githubUpdateCommentTool: Tool = {
  name: "github_update_comment",
  description:
    "Edit the body of an existing pull request comment, for when a review comment was wrong. Accepts either a review comment or a conversation comment id. Requires providers.github.security.allow_write.",
  params: {
    pr_url: {
      type: "string",
      optional: true,
      description:
        "Full GitHub pull request URL. If pr_id is also provided, both must identify the same pull request.",
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
    comment_id: {
      type: "number",
      description:
        "Positive id of the comment to edit, as returned by github_create_comment or github_get_pr_discussions.",
    },
    body: {
      type: "string",
      description:
        "Replacement comment text. Replaces the comment body entirely.",
    },
  },
  execute: async (params) => {
    const { repo, prId } = assertPullWriteAllowed(params);
    const commentId = resolveCommentId(params);
    const body = requireText(params, "body");
    const client = getGitHubClient();

    try {
      // Read before writing: an unknown id should name the comment that is missing, and
      // the read also decides which endpoint owns it.
      const { kind, comment } = await findComment(repo, prId, commentId);

      const updated = await client.request<GitHubComment>({
        method: "PATCH",
        path: commentPath(kind, repo, commentId),
        body: { body },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: updated.id,
                prId,
                kind,
                body: updated.body,
                author: updated.user?.login ?? null,
                updatedAt: updated.updated_at,
                url: updated.html_url,
                previousBody: comment.body,
                success: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError("update the comment", error);
    }
  },
};
