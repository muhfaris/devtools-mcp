import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitHubError } from "../../providers/github-error.js";
import {
  getGitHubClient,
  getGitHubWebUrl,
  type GitHubClient,
} from "../../providers/github.js";
import type { GitHubComment } from "../../providers/github-types.js";
import { assertPullWriteAllowed, requireText } from "./guard.js";

/**
 * The head commit an inline review comment attaches to.
 *
 * GitHub requires `commit_id` for a file comment and rejects a line that is not in that
 * commit's diff, so the commit is read from the pull request rather than accepted as a
 * parameter that could name the wrong one.
 */
const headSha = async (client: GitHubClient, repo: string, prId: number) => {
  const pr = await client.request<{ head: { sha: string } }>({
    path: `/repos/${repo}/pulls/${prId}`,
  });
  return pr.head.sha;
};

export const githubCreateCommentTool: Tool = {
  name: "github_create_comment",
  description:
    "Add a comment to a GitHub pull request. With path and line, it is an inline review comment anchored to the diff; without them it is a conversation comment. GitHub rejects a line that is not part of the diff, so the error names the anchor rather than posting in the wrong place. Requires providers.github.security.allow_write.",
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
    body: {
      type: "string",
      description: "Comment text (markdown).",
    },
    path: {
      type: "string",
      optional: true,
      description:
        "Changed file path to anchor an inline comment to. Omit for a conversation comment.",
    },
    line: {
      type: "number",
      optional: true,
      description:
        "Line number on the chosen side. Required for an inline comment unless start_line and end_line are given.",
    },
    side: {
      type: "string",
      optional: true,
      description:
        "Diff side the line numbers refer to: RIGHT (new file, default) or LEFT (old file).",
      default: "RIGHT",
    },
    start_line: {
      type: "number",
      optional: true,
      description: "First line of a multi-line inline comment.",
    },
    end_line: {
      type: "number",
      optional: true,
      description: "Last line of a multi-line inline comment.",
    },
  },
  execute: async (params) => {
    const { repo, prId, config } = assertPullWriteAllowed(params);
    const body = requireText(params, "body");
    const client = getGitHubClient();

    const path = typeof params.path === "string" ? params.path.trim() : "";
    const side = String(params.side ?? "RIGHT").toUpperCase();

    if (side !== "RIGHT" && side !== "LEFT") {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `Unsupported diff side: ${side}.`,
        "Use side: RIGHT for lines in the new file or side: LEFT for lines in the old file.",
        false,
        { parameter: "side" },
      );
    }

    try {
      if (!path) {
        const comment = await client.request<GitHubComment>({
          method: "POST",
          path: `/repos/${repo}/issues/${prId}/comments`,
          body: { body },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: comment.id,
                  prId,
                  kind: "issue_comment",
                  body: comment.body,
                  author: comment.user?.login ?? null,
                  url: comment.html_url,
                  success: true,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const line = Number(params.line) || undefined;
      const startLine = Number(params.start_line) || undefined;
      const endLine = Number(params.end_line) || undefined;

      if (line === undefined && (startLine === undefined || endLine === undefined)) {
        throw new ToolError(
          "INVALID_ARGUMENT",
          "An inline comment needs a line, or a start_line and end_line pair.",
          "Pass line for one line, or start_line and end_line for a range. Omit path for a conversation comment.",
          true,
          { parameter: "line" },
        );
      }

      const commitId = await headSha(client, repo, prId);

      // GitHub's payload uses `line` as the end of a range and `start_line` as its
      // beginning; a single-line comment is just `line`.
      const position =
        line !== undefined
          ? { line }
          : { start_line: startLine, line: endLine, start_side: side };

      const comment = await client.request<GitHubComment>({
        method: "POST",
        path: `/repos/${repo}/pulls/${prId}/comments`,
        body: {
          body,
          commit_id: commitId,
          path,
          side,
          ...position,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: comment.id,
                prId,
                kind: "review_comment",
                body: comment.body,
                author: comment.user?.login ?? null,
                path: comment.path,
                line: comment.line ?? comment.original_line ?? null,
                side: comment.side ?? side,
                url: comment.html_url,
                webUrl: `${getGitHubWebUrl(
                  config,
                  repo,
                )}/pull/${prId}#discussion_r${comment.id}`,
                success: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError("create the comment", error);
    }
  },
};
