import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import {
  getGitHubClient,
  pageIsFull,
  pageSize,
} from "../../providers/github.js";
import type { GitHubCommit } from "../../providers/github-types.js";
import { assertGitHubReadable } from "./guard.js";

export const githubGetCommitsTool: Tool = {
  name: "github_get_commits",
  description:
    "Get commit history (equivalent to remote 'git log') from a GitHub repository, branch, tag, or path without cloning locally. Returns each commit's subject as `title`; pass include_messages: true for the full message (subject plus body). One page of `limit`.",
  params: {
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    ref: {
      type: "string",
      optional: true,
      description:
        "Branch name, tag, or commit SHA to inspect (default: the repository's default branch)",
    },
    path: {
      type: "string",
      optional: true,
      description: "Filter commits by file or directory path",
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
      description:
        "Maximum number of commits to return (default: 10, max: 100). One page is fetched; `truncated: true` means more history exists",
      default: 10,
    },
    include_messages: {
      type: "boolean",
      optional: true,
      description:
        "Include each commit's full message (default: false). `title` is always returned; the message repeats it and adds the body",
      default: false,
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);
    const client = getGitHubClient();
    const limit = pageSize(params.limit ?? 10);

    try {
      const commits = await client.request<GitHubCommit[]>({
        path: `/repos/${repo}/commits`,
        query: {
          sha: typeof params.ref === "string" ? params.ref : undefined,
          path: typeof params.path === "string" ? params.path : undefined,
          per_page: limit,
          page: Math.max(Number(params.page) || 1, 1),
        },
      });

      const result = {
        repo,
        ref: params.ref || "default",
        limit,
        total: commits.length,
        // A full page means GitHub had more to give. Saying so beats a silent cap.
        truncated: pageIsFull(commits.length, limit),
        commits: commits.map((commit) => ({
          id: commit.sha,
          shortId: commit.sha.slice(0, 7),
          title: commit.commit.message.split("\n")[0],
          ...(params.include_messages === true
            ? { message: commit.commit.message }
            : {}),
          authorName: commit.commit.author?.name ?? null,
          authorEmail: commit.commit.author?.email ?? null,
          authoredDate: commit.commit.author?.date ?? null,
          authorLogin: commit.author?.login ?? null,
          webUrl: commit.html_url,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitHubError("get commits", error);
    }
  },
};
