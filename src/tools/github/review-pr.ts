import type { Tool } from "../../core/types.js";
import { formatGitHubError } from "../../providers/github-error.js";
import { getGitHubClient, resolvePrId } from "../../providers/github.js";
import type { GitHubPull, GitHubPullFile } from "../../providers/github-types.js";
import {
  detectLanguage,
  estimateComplexity,
  generateSuggestions,
} from "../../providers/review-analysis.js";
import { assertGitHubReadable } from "./guard.js";

/** Files the PR files endpoint returns per page, and the most this tool inlines. */
const PAGE = 100;
const MAX_FILES_CEILING = 50;

type ReviewedFile = {
  file: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  language: string;
  complexity: "low" | "medium" | "high" | null;
  reviewed: boolean;
  diffOmitted: "unavailable" | null;
  diff: string;
  suggestions: string[];
};

export const githubReviewPrTool: Tool = {
  name: "github_review_pr",
  description:
    "Get full GitHub pull request diffs, file analysis, and review suggestions for AI code review without a local clone. A file whose patch GitHub withheld (binary or too large) is marked with diffOmitted, listed in filesNotReviewed, and never counted as reviewed or reported as clean.",
  params: {
    pr_url: {
      type: "string",
      optional: true,
      description: "Full GitHub pull request URL",
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
    max_files: {
      type: "number",
      optional: true,
      description: "Maximum number of files to include (default: 10, max: 50)",
      default: 10,
    },
    include_summary: {
      type: "boolean",
      optional: true,
      description: "Include an AI-friendly summary (default: true)",
      default: true,
    },
  },
  execute: async (params) => {
    const { repo } = assertGitHubReadable(params);
    const prId = resolvePrId(params);
    const maxFiles = Math.min(
      Number(params.max_files) || 10,
      MAX_FILES_CEILING,
    );
    const client = getGitHubClient();

    try {
      const [pr, files] = await Promise.all([
        client.request<GitHubPull>({ path: `/repos/${repo}/pulls/${prId}` }),
        client.request<GitHubPullFile[]>({
          path: `/repos/${repo}/pulls/${prId}/files`,
          query: { per_page: PAGE },
        }),
      ]);

      const analyzed: ReviewedFile[] = files.slice(0, maxFiles).map((file) => {
        // A patch GitHub withheld cannot be reviewed: there is nothing to read. Marked
        // rather than analyzed as an empty diff, which would present it as clean.
        const diffOmitted =
          typeof file.patch === "string" ? null : ("unavailable" as const);
        const reviewed = diffOmitted === null;
        const language = detectLanguage(file.filename);
        const patch = file.patch ?? "";

        return {
          file: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          language,
          complexity: reviewed ? estimateComplexity(patch) : null,
          reviewed,
          diffOmitted,
          diff: patch,
          suggestions: reviewed ? generateSuggestions(patch, language) : [],
        };
      });

      // Every file in the PR whose patch GitHub withheld, so the agent can fetch each
      // with github_get_file instead of assuming it has nothing to say.
      const filesNotReviewed = files
        .filter((file) => typeof file.patch !== "string")
        .map((file) => ({
          file: file.filename,
          diffOmitted: "unavailable" as const,
        }));

      const filesReviewed = analyzed.filter((file) => file.reviewed).length;
      const truncated = files.length >= PAGE;

      const summary =
        params.include_summary === false
          ? ""
          : buildSummary(pr, repo, analyzed, filesNotReviewed, files.length);

      const result = {
        pr: {
          id: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft === true,
          author: pr.user?.login ?? null,
          webUrl: pr.html_url,
        },
        totalFiles: files.length,
        filesShown: analyzed.length,
        filesReviewed,
        filesNotReviewed,
        files: analyzed,
        summary,
        truncated,
        suggestion: truncated
          ? `Only the first ${PAGE} files were read; open a narrower PR or fetch individual files with github_get_file.`
          : `To review all ${files.length} files, set max_files to a higher value.`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitHubError("review the pull request", error);
    }
  },
};

const buildSummary = (
  pr: GitHubPull,
  repo: string,
  files: ReviewedFile[],
  filesNotReviewed: { file: string; diffOmitted: "unavailable" }[],
  totalFiles: number,
): string => {
  // Only files whose patch actually came back were reviewed. A withheld file is never
  // counted here — not in the file count, not in the change totals.
  const reviewed = files.filter((file) => file.reviewed);
  const additions = reviewed.reduce(
    (sum, file) => sum + (file.additions ?? 0),
    0,
  );
  const deletions = reviewed.reduce(
    (sum, file) => sum + (file.deletions ?? 0),
    0,
  );
  const high = reviewed.filter((file) => file.complexity === "high");
  const medium = reviewed.filter((file) => file.complexity === "medium");
  const suggestions = reviewed.flatMap((file) =>
    file.suggestions.map((suggestion) => `\`${file.file}\`: ${suggestion}`),
  );

  let summary = `## PR Review: #${pr.number} - ${pr.title}\n\n`;
  summary += `### Overview\n`;
  summary += `- **Repository:** ${repo}\n`;
  summary += `- **Author:** @${pr.user?.login ?? "unknown"}\n`;
  summary += `- **State:** ${pr.state}${pr.draft ? " (draft)" : ""}\n`;
  summary += `- **URL:** ${pr.html_url}\n\n`;

  summary += `### Changes\n`;
  summary += `- **Files reviewed:** ${reviewed.length} of ${totalFiles}\n`;
  summary += `- **Additions:** +${additions}\n`;
  summary += `- **Deletions:** -${deletions}\n\n`;

  if (filesNotReviewed.length > 0) {
    summary += `### ⚠️ Not Reviewed\n`;
    summary += `${filesNotReviewed.length} of ${totalFiles} files were not reviewed: GitHub omitted the patch (binary or too large).\n`;
    summary += `They are not covered by this review and must not be reported as clean. Read each with \`github_get_file\` and review it separately.\n\n`;
    for (const entry of filesNotReviewed) {
      summary += `- \`${entry.file}\` (${entry.diffOmitted})\n`;
    }
    summary += `\n`;
  }

  if (high.length > 0) {
    summary += `### ⚠️ High Complexity Files\n`;
    for (const file of high) summary += `- \`${file.file}\` (${file.language})\n`;
    summary += `\n`;
  }

  if (medium.length > 0) {
    summary += `### 📊 Medium Complexity Files\n`;
    for (const file of medium)
      summary += `- \`${file.file}\` (${file.language})\n`;
    summary += `\n`;
  }

  if (suggestions.length > 0) {
    summary += `### 💡 Suggestions & Warnings\n`;
    for (const suggestion of suggestions.slice(0, 10)) {
      summary += `- ${suggestion}\n`;
    }
    summary += `\n`;
  }

  return summary;
};
