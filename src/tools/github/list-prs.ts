import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient, pageIsFull, pageSize } from "../../providers/github.js";
import type { GitHubPull } from "../../providers/github-types.js";
import { assertGitHubReadable } from "./guard.js";

export const githubListPrsTool: Tool = {
  name: "github_list_prs",
  description:
    "List pull requests from a GitHub repository with filters. One page of `limit`; `truncated: true` means more remain.",
  params: {
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    pr_url: {
      type: "string",
      optional: true,
      description:
        "Full pull request URL, used only to infer the repository when repo is omitted.",
    },
    state: {
      type: "string",
      optional: true,
      description: "PR state: open, closed, all (default: open)",
      default: "open",
    },
    base: {
      type: "string",
      optional: true,
      description: "Filter by the branch the pull request merges into",
    },
    head: {
      type: "string",
      optional: true,
      description:
        "Filter by source branch, as 'owner:branch' or just 'branch' for this repository",
    },
    sort: {
      type: "string",
      optional: true,
      description: "Sort by: created, updated, popularity, long-running (default: updated)",
      default: "updated",
    },
    direction: {
      type: "string",
      optional: true,
      description: "Sort direction: asc or desc (default: desc)",
      default: "desc",
    },
    page: {
      type: "number",
      optional: true,
      description: "Page number (default: 1)",
      default: 1,
    },
    limit: {
      type: "number",
      optional: true,
      description: "Maximum number of PRs to return (default: 20, max: 100)",
      default: 20,
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);
    const client = getGitHubClient();
    const limit = pageSize(params.limit ?? 20);
    const state = typeof params.state === "string" ? params.state : "open";

    try {
      const pulls = await client.request<GitHubPull[]>({
        path: `/repos/${repo}/pulls`,
        query: {
          state,
          base: typeof params.base === "string" ? params.base : undefined,
          head: typeof params.head === "string" ? params.head : undefined,
          sort: typeof params.sort === "string" ? params.sort : undefined,
          direction:
            typeof params.direction === "string" ? params.direction : undefined,
          per_page: limit,
          page: Math.max(Number(params.page) || 1, 1),
        },
      });

      const result = pulls.map((pr) => ({
        id: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft === true,
        author: pr.user?.login ?? null,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at,
        webUrl: pr.html_url,
        labels: (pr.labels ?? []).map((label) => label.name),
        description:
          (pr.body ?? "").substring(0, 200) +
          ((pr.body ?? "").length > 200 ? "..." : ""),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                repo,
                total: result.length,
                limit,
                truncated: pageIsFull(result.length, limit),
                state,
                pullRequests: result,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      throw formatGitHubError("list pull requests", error);
    }
  },
};
