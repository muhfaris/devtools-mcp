import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitHubError } from "../../providers/github-error.js";
import {
  getGitHubClient,
  getGitHubWebUrl,
} from "../../providers/github.js";
import type { GitHubPull } from "../../providers/github-types.js";
import { assertPullWriteAllowed } from "./guard.js";

type PullEdit = { base?: string; title?: string; body?: string };

/**
 * Which fields the caller wants changed. A field is changed only when it is passed, so a
 * retarget does not blank the description. An empty `body` is a real request (clear it);
 * an empty `title` or `base` is never valid.
 */
const resolveEdit = (params: Record<string, unknown>): PullEdit => {
  const edit: PullEdit = {};

  for (const [param, key] of [
    ["base", "base"],
    ["title", "title"],
  ] as const) {
    const raw = params[param];
    if (raw === undefined || raw === null) continue;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `${param} must not be empty.`,
        `Provide a non-empty ${param}, or omit it to leave it unchanged, then retry this tool.`,
        true,
        { parameter: param },
      );
    }
    edit[key] = value;
  }

  if (params.body !== undefined && params.body !== null) {
    edit.body = String(params.body);
  }

  if (Object.keys(edit).length === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Nothing to update.",
      "Pass at least one of base, title, or body, then retry this tool.",
      true,
      { parameter: "base" },
    );
  }

  return edit;
};

export const githubUpdatePrTool: Tool = {
  name: "github_update_pr",
  description:
    "Change an open pull request's base branch, title, or description. Only the fields you pass change. It does not merge, close, or approve. Requires providers.github.security.allow_write.",
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
        "Positive pull request number. Must match the number in pr_url when both are provided.",
    },
    base: {
      type: "string",
      optional: true,
      description: "New base branch. Omit to keep the current one.",
    },
    title: {
      type: "string",
      optional: true,
      description: "New title. Omit to keep the current one.",
    },
    body: {
      type: "string",
      optional: true,
      description:
        "New description (markdown), replacing the whole text. Pass an empty string to clear it. Omit to keep the current one.",
    },
  },
  execute: async (params) => {
    const { repo, prId, config } = assertPullWriteAllowed(params);
    const edit = resolveEdit(params);
    const client = getGitHubClient();

    try {
      // Read before writing: the response can then show what was replaced, and an unknown
      // pull request is reported as such rather than as GitHub's bare 404.
      const before = await client.request<GitHubPull>({
        path: `/repos/${repo}/pulls/${prId}`,
      });

      const after = await client.request<GitHubPull>({
        method: "PATCH",
        path: `/repos/${repo}/pulls/${prId}`,
        body: edit,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: after.number,
                state: after.state,
                title: after.title,
                baseBranch: after.base.ref,
                headBranch: after.head.ref,
                webUrl:
                  after.html_url ?? `${getGitHubWebUrl(config, repo)}/pull/${prId}`,
                changed: {
                  ...(edit.base !== undefined && {
                    base: { from: before.base.ref, to: after.base.ref },
                  }),
                  ...(edit.title !== undefined && {
                    title: { from: before.title, to: after.title },
                  }),
                  ...(edit.body !== undefined && {
                    body: { from: before.body ?? "", to: after.body ?? "" },
                  }),
                },
                success: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError("update the pull request", error);
    }
  },
};
