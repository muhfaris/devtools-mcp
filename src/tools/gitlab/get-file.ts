import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabGetFileTool: Tool = {
  name: "gitlab_get_file",
  description:
    "Get full raw file content or metadata from a remote GitLab repository without local cloning. Useful for inspecting entire files referenced in MR diffs.",
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
      // @gitbeaker/rest RepositoryFiles.show returns base64 content
      const file = await client.RepositoryFiles.show(projectId, filePath, ref);

      let content = "";
      if (file.content) {
        if (file.encoding === "base64") {
          content = Buffer.from(file.content, "base64").toString("utf-8");
        } else {
          content = file.content;
        }
      }

      const result = {
        fileName: file.file_name,
        filePath: file.file_path,
        size: file.size,
        encoding: file.encoding,
        contentSha256: file.content_sha256,
        ref: file.ref,
        blobId: file.blob_id,
        commitId: file.commit_id,
        lastCommitId: file.last_commit_id,
        content,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError(`get file '${filePath}' at ref '${ref}'`, error);
    }
  },
};
