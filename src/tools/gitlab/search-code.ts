import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabSearchCodeTool: Tool = {
  name: "gitlab_search_code",
  description:
    "Search for code, function definitions, symbols, or text across a remote GitLab repository (equivalent to remote 'git grep' or 'ripgrep').",
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
    search: {
      type: "string",
      description:
        "Search term, function name, or symbol to find across repository files",
    },
    ref: {
      type: "string",
      optional: true,
      description:
        "Branch name, tag, or commit ref to search within (e.g. 'main' or 'feat/my-branch')",
    },
    page: {
      type: "number",
      optional: true,
      description: "Page number for pagination (default: 1)",
      default: 1,
    },
    per_page: {
      type: "number",
      optional: true,
      description: "Maximum search results to return (default: 20, max: 100)",
      default: 20,
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

    const searchTerm = (params.search || "").trim();
    if (!searchTerm) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A search term is required.",
        "Provide a query string in 'search', then retry.",
        true,
        { parameter: "search" },
      );
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const perPage = Math.min(Number(params.per_page) || 20, 100);
    const page = Math.max(Number(params.page) || 1, 1);

    try {
      const results = await client.Search.all("blobs", searchTerm, {
        projectId,
        ...(params.ref && { ref: String(params.ref).trim() }),
        page,
        perPage,
      });

      const items = (results || []).map((r: any) => ({
        basename: r.basename,
        filename: r.filename,
        path: r.path || r.filename,
        ref: r.ref,
        startline: r.startline,
        data: r.data,
      }));

      const output = {
        project: projectId,
        search: searchTerm,
        ref: params.ref || "default",
        page,
        totalFound: items.length,
        results: items,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError(`search code for '${searchTerm}'`, error);
    }
  },
};
