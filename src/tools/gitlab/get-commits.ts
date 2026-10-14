import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import {
  boundedPage,
  getGitLabClient,
  pageIsFull,
  resolveProjectId,
} from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabGetCommitsTool: Tool = {
  name: "gitlab_get_commits",
  description:
    "Get commit history (equivalent to remote 'git log') from a GitLab repository branch, tag, or path without cloning locally. Returns each commit's subject as `title`; pass include_messages: true for the full message (subject plus body).",
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
        "Maximum number of commits to return (default: 10, max: 100). One page is fetched; the response says `truncated: true` when more history exists",
      default: 10,
    },
    include_messages: {
      type: "boolean",
      optional: true,
      description:
        "Include each commit's full message (default: false). `title` is always returned; the message repeats it and adds the body, which is what makes a long log long",
      default: false,
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
    const limit = Math.min(Number(params.limit) || 10, 100);

    try {
      const commits = await client.Commits.all(projectId, {
        ...boundedPage(limit),
        ...(params.ref && { refName: String(params.ref).trim() }),
        ...(params.path && { path: String(params.path).trim() }),
      });

      const result = {
        project: projectId,
        ref: params.ref || "default",
        limit,
        total: commits.length,
        // A full page means GitLab had more to give. Saying so beats a silent cap: the
        // caller cannot otherwise tell five commits from the first five of nine hundred.
        truncated: pageIsFull(commits.length, limit),
        commits: commits.map((c: any) => ({
          id: c.id,
          shortId: c.short_id,
          title: c.title,
          // The body of a commit message is often a release note or a paragraph of
          // explanation: the largest field per commit, and not what a log is read for.
          ...(params.include_messages === true ? { message: c.message } : {}),
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
