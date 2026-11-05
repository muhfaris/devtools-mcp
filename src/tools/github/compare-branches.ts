import type { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient, type GitHubClient } from "../../providers/github.js";
import type {
  GitHubCompare,
  GitHubPull,
  GitHubPullFile,
} from "../../providers/github-types.js";
import { assertGitHubReadable } from "./guard.js";

/** Characters of one file's patch that are inlined before it is cut short. */
const PATCH_CHARS = 800;
/** Files whose patch is inlined when diffs are asked for. */
const DEFAULT_MAX_FILES = 25;
/**
 * GitHub caps the file list of one comparison at 300 entries. A list of exactly that
 * length is a truncation, and the response says so rather than implying the end.
 */
const COMPARE_FILE_CAP = 300;

const inlinePatch = (patch: string, full: boolean): string => {
  if (full || patch.length <= PATCH_CHARS) return patch;
  return `${patch.slice(0, PATCH_CHARS)}\n... (truncated, pass full_diff: true for complete diff)`;
};

export const githubCompareBranchesTool: Tool = {
  name: "github_compare_branches",
  description:
    "Compare branches, tags, or commits in a GitHub repository using the merge base (three-dot, like a pull request). Returns the commits between them, a per-file change list (path, status, additions, deletions), ahead/behind counts, and merge-conflict status read from the matching pull request. Files whose patch GitHub withheld report diffOmitted with additions/deletions still real. Patches are opt-in: pass include_diff: true for each file's patch, and full_diff: true for complete ones.",
  params: {
    repo: {
      type: "string",
      optional: true,
      description:
        "Repository as 'owner/name'. Overrides providers.github.repo.",
    },
    from: {
      type: "string",
      description:
        "Base branch name, tag, or commit SHA (e.g. 'main' or 'master')",
    },
    to: {
      type: "string",
      description:
        "Target/feature branch name, tag, or commit SHA (e.g. 'feat/my-feature')",
    },
    include_diff: {
      type: "boolean",
      optional: true,
      description:
        "Inline each file's patch (default: false). The per-file change list is always returned; this adds the patch text",
      default: false,
    },
    full_diff: {
      type: "boolean",
      optional: true,
      description:
        "Inline complete patches rather than the first 800 characters of each (default: false). Only meaningful with include_diff: true",
      default: false,
    },
    max_files: {
      type: "number",
      optional: true,
      description:
        "How many files get their patch inlined (default: 25). The per-file change list is never capped",
      default: DEFAULT_MAX_FILES,
    },
    include_messages: {
      type: "boolean",
      optional: true,
      description:
        "Include each commit's full message (default: false). `title` is always returned; the message repeats it and adds the body",
      default: false,
    },
    detect_conflicts: {
      type: "boolean",
      optional: true,
      description:
        "Look up an existing pull request for this from/to pair and report whether its branches conflict (default: true). Without a matching pull request the status is `unknown`",
      default: true,
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);
    const fromRef = String(params.from || "").trim();
    const toRef = String(params.to || "").trim();

    if (!fromRef || !toRef) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "Both 'from' and 'to' branch/commit references are required.",
        "Provide the base branch in 'from' and the target branch in 'to', then retry.",
        true,
        { parameter: !fromRef ? "from" : "to" },
      );
    }

    const client = getGitHubClient();

    try {
      const comparison = await client.request<GitHubCompare>({
        path: `/repos/${repo}/compare/${encodeURIComponent(
          fromRef,
        )}...${encodeURIComponent(toRef)}`,
      });

      const commits = (comparison.commits ?? []).map((commit) => ({
        id: commit.sha,
        shortId: commit.sha.slice(0, 7),
        title: commit.commit.message.split("\n")[0],
        ...(params.include_messages === true
          ? { message: commit.commit.message }
          : {}),
        authorName: commit.commit.author?.name ?? null,
        authoredDate: commit.commit.author?.date ?? null,
      }));

      const includeDiff = params.include_diff === true;
      const full = params.full_diff === true;
      const maxFiles = Math.max(
        1,
        Math.min(Number(params.max_files) || DEFAULT_MAX_FILES, 500),
      );

      const rawFiles: GitHubPullFile[] = comparison.files ?? [];
      const files = rawFiles.map((file) => {
        const diffOmitted =
          typeof file.patch === "string" ? null : ("unavailable" as const);
        return {
          file: file.filename,
          previousFile: file.previous_filename ?? null,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patchChars: (file.patch ?? "").length,
          diffOmitted,
        };
      });

      const mergeStatus =
        params.detect_conflicts === false
          ? undefined
          : await conflictStatus(client, repo, fromRef, toRef);

      const result = {
        repo,
        from: fromRef,
        to: toRef,
        status: comparison.status,
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
        commitsCount: commits.length,
        filesCount: files.length,
        filesTruncated: rawFiles.length >= COMPARE_FILE_CAP,
        commits,
        files,
        diffOmittedCount: files.filter((file) => file.diffOmitted !== null)
          .length,
        diffIncluded: includeDiff,
        ...(includeDiff
          ? {
              diffs: rawFiles.slice(0, maxFiles).map((file, index) => ({
                file: files[index].file,
                diff: inlinePatch(file.patch ?? "", full),
                truncated: !full && (file.patch ?? "").length > PATCH_CHARS,
                diffOmitted: files[index].diffOmitted,
              })),
              diffsOmitted: Math.max(rawFiles.length - maxFiles, 0),
            }
          : {}),
        ...mergeStatus,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitHubError(`compare '${fromRef}' with '${toRef}'`, error);
    }
  },
};

/**
 * Whether an existing pull request for this pair reports a conflict.
 *
 * The compare endpoint carries no conflict information at all, so a conflicted pair and a
 * clean one used to look identical. GitHub computes `mergeable` on a pull request, so if
 * one exists it answers the question with a single list call — without creating one.
 */
const conflictStatus = async (
  client: GitHubClient,
  repo: string,
  fromRef: string,
  toRef: string,
) => {
  const [owner] = repo.split("/");
  try {
    const pulls = await client.request<GitHubPull[]>({
      path: `/repos/${repo}/pulls`,
      query: {
        state: "all",
        base: fromRef,
        head: `${owner}:${toRef}`,
        per_page: 1,
      },
    });
    const pull = pulls[0];
    if (!pull) {
      return { mergeStatus: "unknown", mergeStatusSource: "not_available" };
    }
    return {
      // `null` is GitHub's "still computing"; it is not a clean answer.
      mergeStatus:
        pull.mergeable === false
          ? "conflicts"
          : pull.mergeable === true
            ? "no_conflicts"
            : "unknown",
      mergeStatusSource: "existing_pull_request",
      pullRequest: {
        id: pull.number,
        title: pull.title,
        url: pull.html_url,
      },
    };
  } catch {
    // An unreadable pull request status must not fail the whole comparison.
    return { mergeStatus: "unknown", mergeStatusSource: "not_available" };
  }
};
