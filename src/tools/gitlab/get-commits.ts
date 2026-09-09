import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabGetCommitsTool: Tool = {
  name: "gitlab_get_commits",
  description:
    "Get commit history (equivalent to remote 'git log') from a GitLab repository branch, tag, or path without cloning locally.",
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
    ref: {
      type: "string",
      optional: true,
      description:
        "Branch name, tag, or commit SHA to inspect (e.g., 'main' or 'feat/my-branch')",
    },
    path: {
      type: "string",
      optional: true,
      description: "Filter commits by file or directory path",
    },
    limit: {
      type: "number",
      optional: true,
      description:
        "Maximum number of commits to return (default: 10, max: 100)",
      default: 10,
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
    const limit = Math.min(Number(params.limit) || 10, 100);

    try {
      const commits = await client.Commits.all(projectId, {
        ...(params.ref && { refName: String(params.ref).trim() }),
        ...(params.path && { path: String(params.path).trim() }),
        perPage: limit,
      });

      const result = {
        project: projectId,
        ref: params.ref || "default",
        total: commits.length,
        commits: commits.map((c: any) => ({
          id: c.id,
          shortId: c.short_id,
          title: c.title,
          message: c.message,
          authorName: c.author_name,
          authorEmail: c.author_email,
          authoredDate: c.authored_date,
          createdAt: c.created_at,
          webUrl: c.web_url,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError("get commits", error);
    }
  },
};
