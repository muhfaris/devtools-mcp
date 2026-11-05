import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import {
  getGitHubClient,
  pageIsFull,
  resolvePrId,
} from "../../providers/github.js";
import type {
  GitHubComment,
  GitHubCommit,
  GitHubPull,
  GitHubPullFile,
} from "../../providers/github-types.js";
import { parseDiffLines } from "../../providers/diff.js";
import { assertGitHubReadable } from "./guard.js";

/** Files and commits whose full list is fetched in one page. */
const PAGE = 100;

/**
 * GitHub omits `patch` for a file it will not inline: binary content, or a diff past its
 * response budget. The counts are still real, so only the text is marked missing — a file
 * whose patch is absent must not read as an empty change.
 */
const patchOmitted = (file: GitHubPullFile): "unavailable" | null =>
  typeof file.patch === "string" ? null : "unavailable";

export const githubGetPrTool: Tool = {
  name: "github_get_pr",
  description:
    "Get detailed pull request metadata, commits, and file changes/diffs from GitHub. Each changed file is numbered line by line for the old and new side. A file whose patch GitHub withheld (binary or too large) is marked diffOmitted — its patch text is empty but its additions/deletions are still real. Commit subjects are always returned; pass include_messages: true for the full message. For deep code reviews with file-by-file suggestions, use github_review_pr.",
  params: {
    pr_url: {
      type: "string",
      optional: true,
      description:
        "Full GitHub pull request URL (e.g. https://github.com/owner/repo/pull/123)",
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
    include_commits: {
      type: "boolean",
      optional: true,
      description: "Include the list of commits (default: true)",
      default: true,
    },
    include_diff: {
      type: "boolean",
      optional: true,
      description: "Include the file change list (default: true)",
      default: true,
    },
    full_diff: {
      type: "boolean",
      optional: true,
      description:
        "Include full un-truncated patches rather than the first 800 characters of each (default: false)",
      default: false,
    },
    diff_lines: {
      type: "boolean",
      optional: true,
      description:
        "Number every line of each changed file with its old_line, new_line, and type (default: true). Pass false to trim the response.",
      default: true,
    },
    include_discussions: {
      type: "boolean",
      optional: true,
      description:
        "Include issue comments and review comments (default: false). Both lists are one page of 100",
      default: false,
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
    const prId = resolvePrId(params);
    const client = getGitHubClient();

    let commitsTruncated = false;
    let commentsTruncated = false;

    try {
      const pr = await client.request<GitHubPull>({
        path: `/repos/${repo}/pulls/${prId}`,
      });

      let commits: Array<Record<string, unknown>> = [];
      if (params.include_commits !== false) {
        const list = await client.request<GitHubCommit[]>({
          path: `/repos/${repo}/pulls/${prId}/commits`,
          query: { per_page: PAGE },
        });
        commitsTruncated = pageIsFull(list.length, PAGE);
        commits = list.map((commit) => ({
          id: commit.sha,
          shortId: commit.sha.slice(0, 7),
          title: commit.commit.message.split("\n")[0],
          ...(params.include_messages === true
            ? { message: commit.commit.message }
            : {}),
          authorName: commit.commit.author?.name ?? null,
          authorEmail: commit.commit.author?.email ?? null,
          authoredDate: commit.commit.author?.date ?? null,
          webUrl: commit.html_url,
        }));
      }

      let diff: Array<Record<string, unknown>> = [];
      let diffOmittedCount = 0;
      let filesTruncated = false;
      if (params.include_diff !== false) {
        const files = await client.request<GitHubPullFile[]>({
          path: `/repos/${repo}/pulls/${prId}/files`,
          query: { per_page: PAGE },
        });
        filesTruncated = pageIsFull(files.length, PAGE);
        const full = params.full_diff === true;
        const withLines = params.diff_lines !== false;
        diff = files.map((file) => {
          const omitted = patchOmitted(file);
          const patch = file.patch ?? "";
          return {
            file: file.filename,
            previousFile: file.previous_filename ?? null,
            added: file.status === "added",
            removed: file.status === "removed",
            renamed: file.status === "renamed",
            diffOmitted: omitted,
            additions: file.additions,
            deletions: file.deletions,
            diff: full
              ? patch
              : patch.substring(0, 800) +
                (patch.length > 800
                  ? "\n... (truncated, pass full_diff: true for complete diff)"
                  : ""),
            // Numbered from the complete patch, so the numbers stay right even when the
            // text above is truncated.
            ...(withLines ? { lines: parseDiffLines(patch) } : {}),
          };
        });
        diffOmittedCount = diff.filter(
          (entry) => entry.diffOmitted !== null,
        ).length;
      }

      let discussions: Array<Record<string, unknown>> = [];
      if (params.include_discussions) {
        const [issueComments, reviewComments] = await Promise.all([
          client.request<GitHubComment[]>({
            path: `/repos/${repo}/issues/${prId}/comments`,
            query: { per_page: PAGE },
          }),
          client.request<GitHubComment[]>({
            path: `/repos/${repo}/pulls/${prId}/comments`,
            query: { per_page: PAGE },
          }),
        ]);
        commentsTruncated =
          pageIsFull(issueComments.length, PAGE) ||
          pageIsFull(reviewComments.length, PAGE);
        discussions = [
          ...issueComments.map((comment) => ({
            id: comment.id,
            kind: "issue_comment",
            author: comment.user?.login ?? null,
            body: comment.body,
            createdAt: comment.created_at,
            path: null,
            line: null,
          })),
          ...reviewComments.map((comment) => ({
            id: comment.id,
            kind: "review_comment",
            author: comment.user?.login ?? null,
            body: comment.body,
            createdAt: comment.created_at,
            path: comment.path ?? null,
            line: comment.line ?? comment.original_line ?? null,
          })),
        ];
      }

      const labels = (pr.labels ?? []).map((label) => label.name);

      const result = {
        id: pr.number,
        title: pr.title,
        description: pr.body ?? "",
        state: pr.state,
        draft: pr.draft === true,
        merged: pr.merged === true,
        author: pr.user?.login ?? null,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        assignees: (pr.assignees ?? []).map((user) => user.login),
        reviewers: (pr.requested_reviewers ?? []).map((user) => user.login),
        labels,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        closedAt: pr.closed_at,
        mergedAt: pr.merged_at,
        webUrl: pr.html_url,
        mergeable: pr.mergeable ?? null,
        mergeableState: pr.mergeable_state ?? null,
        headSha: pr.head.sha,
        commitsCount: commits.length,
        commits,
        diff,
        ...(params.include_diff !== false
          ? {
              diffOmittedCount,
              statsComplete: diffOmittedCount === 0,
            }
          : {}),
        discussions,
        // Every list here is capped at one page of 100; `true` means the answer stops at
        // the cap rather than at the end of the list.
        truncated: {
          commits: commitsTruncated,
          files: filesTruncated,
          discussions: commentsTruncated,
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitHubError("get the pull request", error);
    }
  },
};
