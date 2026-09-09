import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";

export const gitlabReviewMrTool: Tool = {
  name: "gitlab_review_mr",
  description: "Get full MR diff with review suggestions and analysis",
  params: {
    project_id: {
      type: "number",
      optional: true,
      description: "GitLab project ID. Overrides config default.",
    },
    mr_id: {
      type: "number",
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
    if (!config?.gitlab) {
      throw new ToolError(
        "CONFIG_REQUIRED",
        "GitLab configuration is required.",
        "Configure GitLab with gitlab_set_config, then retry this tool.",
        true,
        { configKey: "gitlab", setupTool: "gitlab_set_config" },
      );
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const mrId = Number(params.mr_id);
    const maxFiles = Math.min(Number(params.max_files) || 10, 50);

    if (!mrId || isNaN(mrId)) {
      throw new ToolError(
        "GITLAB_MR_ID_REQUIRED",
        "A valid GitLab merge request ID is required.",
        "Ask the user for the numeric merge request IID, then retry this tool with mr_id.",
        true,
        { parameter: "mr_id" },
      );
    }

    try {
      // Get MR details
      const mr = await client.MergeRequests.show(projectId, mrId);

      // Get changes
      const changes = await client.MergeRequests.changes(projectId, mrId);
      const allFiles = changes.changes;
      const files = allFiles.slice(0, maxFiles);

      // Analyze each file
      const analyzedFiles = files.map((file: any) => {
        const additions = file.additions || 0;
        const deletions = file.deletions || 0;
        const language = detectLanguage(file.new_path || file.old_path);
        const complexity = estimateComplexity(file.diff || "", language);
        const suggestions = generateSuggestions(file.diff || "", language);

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
          complexity,
          diff:
            file.diff?.substring(0, 800) +
            (file.diff?.length > 800 ? "\n... (truncated)" : ""),
          suggestions,
        };
      });

      // Generate summary
      let summary = "";
      if (params.include_summary !== false) {
        summary = generateReviewSummary(analyzedFiles, mr);
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
        files: analyzedFiles,
        summary: summary,
        suggestion: `To review all ${allFiles.length} files, set max_files to a higher value.`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "GITLAB_REQUEST_FAILED",
        "GitLab could not review the merge request.",
        "Report the GitLab failure to the user; do not switch to local Git or retry automatically.",
        false,
        { cause: error },
      );
    }
  },
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript (React)",
    js: "JavaScript",
    jsx: "JavaScript (React)",
    py: "Python",
    go: "Go",
    rs: "Rust",
    java: "Java",
    c: "C",
    cpp: "C++",
    h: "C/C++ Header",
    rb: "Ruby",
    php: "PHP",
    css: "CSS",
    scss: "SCSS",
    less: "LESS",
    html: "HTML",
    vue: "Vue",
    svelte: "Svelte",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    md: "Markdown",
    sh: "Shell",
    bash: "Bash",
    zsh: "Zsh",
    sql: "SQL",
    rs: "Rust",
  };
  return map[ext] || ext || "Unknown";
}

function estimateComplexity(
  diff: string,
  language: string,
): "low" | "medium" | "high" {
  const lines = diff.split("\n");
  const addedLines = lines.filter(
    (l) => l.startsWith("+") && !l.startsWith("+++"),
  ).length;
  const deletedLines = lines.filter(
    (l) => l.startsWith("-") && !l.startsWith("---"),
  ).length;
  const total = addedLines + deletedLines;

  // Count functions/classes added
  const functionKeywords = [
    "function",
    "class",
    "interface",
    "type",
    "const",
    "let",
    "var",
    "export",
    "import",
  ];
  const functionCount = lines.filter(
    (l) => l.startsWith("+") && functionKeywords.some((kw) => l.includes(kw)),
  ).length;

  if (total > 200 || functionCount > 5) return "high";
  if (total > 50 || functionCount > 2) return "medium";
  return "low";
}

function generateSuggestions(diff: string, language: string): string[] {
  const suggestions: string[] = [];
  const lines = diff.split("\n");

  // Look for potential issues
  for (const line of lines) {
    if (line.startsWith("+")) {
      const clean = line.substring(1).trim();

      // Check for console.log
      if (clean.includes("console.log") || clean.includes("console.debug")) {
        suggestions.push(
          "⚠️ Remove console.log/debug statements before merging",
        );
      }

      // Check for TODO
      if (clean.includes("TODO") || clean.includes("FIXME")) {
        suggestions.push("📌 TODO/FIXME found - address before merging");
      }

      // Check for hardcoded values
      if (clean.includes("localhost") || clean.includes("127.0.0.1")) {
        suggestions.push(
          "⚠️ Hardcoded localhost URL detected - consider using environment variables",
        );
      }

      // Check for SQL injection risk
      if (language === "JavaScript" || language === "TypeScript") {
        if (
          clean.includes("query") &&
          !clean.includes("prepared") &&
          !clean.includes("placeholder")
        ) {
          suggestions.push(
            "🛡️ SQL query detected - ensure you're using parameterized queries",
          );
        }
      }
    }
  }

  if (suggestions.length === 0) {
    suggestions.push("✅ No obvious issues detected in the diff");
  }

  return suggestions.slice(0, 5);
}

function generateReviewSummary(files: any[], mr: any): string {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const highComplexity = files.filter((f) => f.complexity === "high");
  const mediumComplexity = files.filter((f) => f.complexity === "medium");

  let summary = `## MR Review Summary\n\n`;
  summary += `- **MR:** #${mr.iid} - "${mr.title}"\n`;
  summary += `- **Author:** ${mr.author}\n`;
  summary += `- **State:** ${mr.state}\n\n`;
  summary += `### Changes\n`;
  summary += `- **Files:** ${files.length}\n`;
  summary += `- **Additions:** +${totalAdditions}\n`;
  summary += `- **Deletions:** -${totalDeletions}\n\n`;

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

  return summary;
}
