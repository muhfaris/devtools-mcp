import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient, getGitHubWebUrl } from "../../providers/github.js";
import type { GitHubPull } from "../../providers/github-types.js";
import { assertGitHubWriteAllowed, requireText } from "./guard.js";

export const githubCreatePrTool: Tool = {
  name: "github_create_pr",
  description:
    "Open a pull request from an existing head branch. It does not merge, approve, or assign anyone. Requires providers.github.security.allow_write.",
  params: {
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    head: {
      type: "string",
      description:
        "Branch that carries the changes. It must already exist on GitHub. Use 'owner:branch' for a branch in a fork.",
    },
    base: {
      type: "string",
      description: "Branch the pull request merges into (e.g. 'main').",
    },
    title: {
      type: "string",
      description: "Pull request title.",
    },
    body: {
      type: "string",
      optional: true,
      description: "Pull request description (markdown).",
    },
    draft: {
      type: "boolean",
      optional: true,
      description: "Open the pull request as a draft (default: false).",
      default: false,
    },
  },
  execute: async (params) => {
    const { repo, config } = assertGitHubWriteAllowed(params);

    const head = requireText(params, "head");
    const base = requireText(params, "base");
    const title = requireText(params, "title");

    if (head === base) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "head and base must differ.",
        "Choose a base branch that is not the head branch, then retry this tool.",
        true,
        { parameter: "base" },
      );
    }

    const client = getGitHubClient();

    try {
      const pull = await client.request<GitHubPull>({
        method: "POST",
        path: `/repos/${repo}/pulls`,
        body: {
          head,
          base,
          title,
          ...(params.body !== undefined ? { body: String(params.body) } : {}),
          draft: params.draft === true,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: pull.number,
                title: pull.title,
                state: pull.state,
                draft: pull.draft === true,
                sourceBranch: pull.head.ref,
                targetBranch: pull.base.ref,
                author: pull.user?.login ?? null,
                webUrl:
                  pull.html_url || `${getGitHubWebUrl(config, repo)}/pull`,
                success: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError("create the pull request", error);
    }
  },
};
