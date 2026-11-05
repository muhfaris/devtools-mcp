import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient } from "../../providers/github.js";
import { commentPath, findComment, resolveCommentId } from "./comments.js";
import { assertPullWriteAllowed } from "./guard.js";

export const githubDeleteCommentTool: Tool = {
  name: "github_delete_comment",
  description:
    "Delete an existing pull request comment (requires providers.github.security.allow_write and explicit confirmation). Without confirm: true the tool reports the comment it would remove and stops.",
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
      description: "Positive id of the comment to delete.",
    },
    confirm: {
      type: "boolean",
      optional: true,
      description:
        "Must be true to actually delete (safety guard). Without it the tool reports the comment it would remove and stops.",
      default: false,
    },
  },
  execute: async (params) => {
    const { repo, prId } = assertPullWriteAllowed(params);
    const commentId = resolveCommentId(params);
    const client = getGitHubClient();

    try {
      const { kind, comment } = await findComment(repo, prId, commentId);

      const summary = {
        id: comment.id,
        kind,
        author: comment.user?.login ?? null,
        body: comment.body,
        createdAt: comment.created_at,
        url: comment.html_url,
      };

      // Deleting is irreversible and GitHub offers no dry run, so the comment is
      // described and the call stops until the caller confirms.
      if (params.confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  prId,
                  commentId,
                  deleted: false,
                  wouldDelete: summary,
                  confirmationRequired: true,
                  message: `Pass \`confirm: true\` to delete comment ${commentId}.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      await client.request({
        method: "DELETE",
        path: commentPath(kind, repo, commentId),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                prId,
                commentId,
                deleted: true,
                deletedComment: summary,
                success: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError("delete the comment", error);
    }
  },
};
