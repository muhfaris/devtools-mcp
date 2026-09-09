import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabGetFileTool: Tool = {
  name: "gitlab_get_file",
  description:
    "Get raw file content or line ranges from a remote GitLab repository without local cloning. Supports branch/commit refs and line slicing.",
  params: {
    mr_url: {
      type: "string",
      optional: true,
      description:
        "Full GitLab merge request URL (used to infer project_id if not supplied)",
    },
    project_id: {
      type: "string",
      optional: true,
      description:
        "GitLab project ID or path with namespace (e.g. 'group/project' or 774). Overrides config default.",
    },
    file_path: {
      type: "string",
      description:
        "Relative file path inside the repository (e.g. 'src/index.ts')",
    },
    ref: {
      type: "string",
      optional: true,
      description:
        "Branch name, tag, or commit SHA. Default: 'main' or project default branch.",
      default: "main",
    },
    start_line: {
      type: "number",
      optional: true,
      description: "1-based starting line number to read",
    },
    end_line: {
      type: "number",
      optional: true,
      description: "1-based ending line number to read",
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

    const filePath = (params.file_path || "").trim();
    if (!filePath) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A valid file_path is required.",
        "Provide a relative file path inside the repository, then retry.",
        true,
        { parameter: "file_path" },
      );
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const ref = (params.ref || "main").trim();

    try {
      const file = await client.RepositoryFiles.show(projectId, filePath, ref);

      let content = "";
      if (file.content) {
        if (file.encoding === "base64") {
          content = Buffer.from(file.content, "base64").toString("utf-8");
        } else {
          content = file.content;
        }
      }

      const allLines = content.split("\n");
      const totalLines = allLines.length;

      let slicedContent = content;
      let startLine = 1;
      let endLine = totalLines;
      let isSliced = false;

      if (params.start_line !== undefined || params.end_line !== undefined) {
        isSliced = true;
        startLine = Math.max(1, Number(params.start_line) || 1);
        endLine = Math.min(totalLines, Number(params.end_line) || totalLines);

        if (startLine <= endLine) {
          slicedContent = allLines.slice(startLine - 1, endLine).join("\n");
        } else {
          slicedContent = "";
        }
      }

      const result = {
        fileName: file.file_name,
        filePath: file.file_path,
        size: file.size,
        ref: file.ref,
        commitId: file.commit_id,
        totalLines,
        isSliced,
        startLine: isSliced ? startLine : 1,
        endLine: isSliced ? endLine : totalLines,
        content: slicedContent,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError(`get file '${filePath}' at ref '${ref}'`, error);
    }
  },
};
