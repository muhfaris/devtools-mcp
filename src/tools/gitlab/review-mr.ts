import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import {
  getGitLabClient,
  resolveMrId,
  resolveProjectId,
} from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import { diffOmissionReason } from "../../providers/gitlab-diff.js";
import { countChangedLines } from "../../providers/diff.js";
import {
  detectLanguage,
  estimateComplexity,
  generateSuggestions,
} from "../../providers/review-analysis.js";

export const gitlabReviewMrTool: Tool = {
  name: "gitlab_review_mr",
  description:
    "Get full GitLab MR diffs, file analysis, and review suggestions for AI code review without needing a local git clone. Files whose patch GitLab withheld past its size limits (too_large/collapsed/limit) are marked with diffOmitted and listed in filesNotReviewed; they are never counted as reviewed or reported as clean.",
  params: {
    mr_url: {
      type: "string",
      optional: true,
      description: "Full GitLab merge request URL",
    },
    project_id: {
      type: "string",
      optional: true,
      description:
        "GitLab project ID or path with namespace. Overrides config default.",
    },
    mr_id: {
      type: "number",
      optional: true,
      description: "Merge request IID (internal ID)",
    },
    max_files: {
      type: "number",
      optional: true,
      description: "Maximum number of files to include (default: 10)",
      default: 10,
    },
    include_summary: {
      type: "boolean",
      optional: true,
      description: "Include AI-friendly summary (default: true)",
      default: true,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    if (config?.providers?.gitlab?.enabled === false) {
      throw new ToolError(
        "CONFIG_REQUIRED",
        "GitLab is disabled in configuration.",
        "Enable providers.gitlab.enabled in .devtools/config.yaml, then retry this tool.",
        true,
        { configKey: "providers.gitlab.enabled" },
      );
    }
    if (!isProviderConfigured(config, "gitlab")) {
      throw new ToolError(
        "CONFIG_REQUIRED",
        "GitLab configuration is required.",
        "Configure GitLab with gitlab_set_config, then retry this tool.",
        true,
        { configKey: "providers.gitlab", setupTool: "gitlab_set_config" },
      );
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const mrId = resolveMrId(params);
    const maxFiles = Math.min(Number(params.max_files) || 10, 50);

    try {
      // Get MR details
      const mr = await client.MergeRequests.show(projectId, mrId);

      // Get changes
      const changes = await client.MergeRequests.showChanges(projectId, mrId);
      const allFiles = changes.changes;
      const files = allFiles.slice(0, maxFiles);

      // Analyze each file
      const analyzedFiles = files.map((file: any) => {
        // A file whose patch GitLab withheld cannot be reviewed: there is nothing to read.
        // Marked rather than analyzed as an empty diff, which would present it as a
        // low-complexity, issue-free file.
        const diffOmitted = diffOmissionReason(file);
        const reviewed = diffOmitted === null;
        // The changes endpoint carries the patch, not per-file counts, so the counts come
        // from the patch. A withheld patch leaves them unknown (`null`), never 0.
        const additions = reviewed ? countChangedLines(file.diff, "+") : null;
        const deletions = reviewed ? countChangedLines(file.diff, "-") : null;
        const language = detectLanguage(file.new_path || file.old_path);

        return {
          file: file.new_path || file.old_path,
          status: file.new_file
            ? "added"
            : file.deleted_file
              ? "deleted"
              : file.renamed_file
                ? "renamed"
                : "modified",
          additions,
          deletions,
          language,
          complexity: reviewed
            ? estimateComplexity(file.diff || "")
            : null,
          reviewed,
          diffOmitted,
          diff: file.diff || "",
          suggestions: reviewed
            ? generateSuggestions(file.diff || "", language)
            : [],
        };
      });

      // Every file in the MR whose patch GitLab withheld, listed once so the agent can
      // fetch each with gitlab_get_file instead of assuming it has nothing to say.
      const filesNotReviewed = allFiles
        .map((file: any) => ({
          file: file.new_path || file.old_path,
          diffOmitted: diffOmissionReason(file),
        }))
        .filter((entry) => entry.diffOmitted !== null);

      const filesReviewed = analyzedFiles.filter((f) => f.reviewed).length;

      // Generate summary
      let summary = "";
      if (params.include_summary !== false) {
        summary = generateReviewSummary(
          analyzedFiles,
          mr,
          filesNotReviewed,
          allFiles.length,
        );
      }

      const result = {
        mr: {
          id: mr.iid,
          title: mr.title,
          state: mr.state,
          author: mr.author.username,
          webUrl: mr.web_url,
        },
        totalFiles: allFiles.length,
        filesShown: analyzedFiles.length,
        filesReviewed,
        filesNotReviewed,
        files: analyzedFiles,
        summary: summary,
        suggestion: `To review all ${allFiles.length} files, set max_files to a higher value.`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError("review the merge request", error);
    }
  },
};

function generateReviewSummary(
  files: any[],
  mr: any,
  filesNotReviewed: { file: string; diffOmitted: string }[],
  totalFiles: number,
): string {
  // Only files whose patch actually came back were reviewed. A file GitLab withheld is
  // never counted here — not in the file count, not in the change totals, not in the
  // complexity lists — because the review never saw its code.
  const reviewedFiles = files.filter((f) => f.reviewed);

  const totalAdditions = reviewedFiles.reduce(
    (sum, f) => sum + (f.additions || 0),
    0,
  );
  const totalDeletions = reviewedFiles.reduce(
    (sum, f) => sum + (f.deletions || 0),
    0,
  );

  const highComplexity = reviewedFiles.filter((f) => f.complexity === "high");
  const mediumComplexity = reviewedFiles.filter(
    (f) => f.complexity === "medium",
  );

  const allSuggestions = reviewedFiles.flatMap((f) =>
    f.suggestions.map((s: string) => `\`${f.file}\`: ${s}`),
  );

  let summary = `## MR Review: !${mr.iid} - ${mr.title}\n\n`;
  summary += `### Overview\n`;
  summary += `- **Author:** @${mr.author.username}\n`;
  summary += `- **State:** ${mr.state}\n`;
  summary += `- **URL:** ${mr.web_url}\n\n`;

  summary += `### Changes\n`;
  summary += `- **Files reviewed:** ${reviewedFiles.length} of ${totalFiles}\n`;
  summary += `- **Additions:** +${totalAdditions}\n`;
  summary += `- **Deletions:** -${totalDeletions}\n\n`;

  // The files the review never read. Named one by one so the agent can fetch them with
  // gitlab_get_file, and never counted as clean: "no issues found" must not cover code
  // that was never seen.
  if (filesNotReviewed.length > 0) {
    const reasons = [
      ...new Set(filesNotReviewed.map((f) => f.diffOmitted)),
    ].join("/");
    summary += `### ⚠️ Not Reviewed\n`;
    summary += `${filesNotReviewed.length} of ${totalFiles} files were not reviewed: diff omitted by GitLab (${reasons}).\n`;
    summary += `They are not covered by this review and must not be reported as clean. Read each with \`gitlab_get_file\` and review it separately.\n\n`;
    for (const entry of filesNotReviewed) {
      summary += `- \`${entry.file}\` (${entry.diffOmitted})\n`;
    }
    summary += `\n`;
  }

  if (highComplexity.length > 0) {
    summary += `### ⚠️ High Complexity Files\n`;
    for (const file of highComplexity) {
      summary += `- \`${file.file}\` (${file.language})\n`;
    }
    summary += `\n`;
  }

  if (mediumComplexity.length > 0) {
    summary += `### 📊 Medium Complexity Files\n`;
    for (const file of mediumComplexity) {
      summary += `- \`${file.file}\` (${file.language})\n`;
    }
    summary += `\n`;
  }

  if (allSuggestions.length > 0) {
    summary += `### 💡 Suggestions & Warnings\n`;
    for (const s of allSuggestions.slice(0, 10)) {
      summary += `- ${s}\n`;
    }
    summary += `\n`;
  }

  return summary;
}
