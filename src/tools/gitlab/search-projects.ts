import type { Config, Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import {
  boundedPage,
  getGitLabClient,
  pageIsFull,
} from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

// The fields of a GitLab project this tool reads (GitLab REST API names).
interface GitLabProject {
  id: number;
  path_with_namespace: string;
  name: string;
  description?: string | null;
  default_branch?: string | null;
  web_url: string;
  last_activity_at: string;
}

export const gitlabSearchProjectsTool: Tool = {
  name: "gitlab_search_projects",
  description:
    "Find GitLab projects by name or path, to get the project_id (group/project) that the other gitlab_* tools need. Searches every project the token can see, or only the projects of one group. One page.",
  params: {
    search: {
      type: "string",
      description:
        "Text to match against the project name or path (e.g. 'bag', 'tracking', 'employee')",
    },
    group: {
      type: "string",
      optional: true,
      description:
        "Group ID or path (e.g. 'operation') to search inside, including its subgroups. Omit to search all projects the token can see.",
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
      description: "Maximum projects to return (default: 20, max: 100)",
      default: 20,
    },
  },
  execute: async (params) => {
    // Same runtime-config global every tool reads; typed here instead of `any`.
    const config = (global as unknown as { __devtools_config?: Config })
      .__devtools_config;
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

    const searchTerm = (params.search || "").trim();
    if (!searchTerm) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A search term is required.",
        "Provide the project name or path in 'search', then retry.",
        true,
        { parameter: "search" },
      );
    }

    const group = params.group ? String(params.group).trim() : "";
    const client = getGitLabClient();
    const perPage = Math.min(Number(params.per_page) || 20, 100);
    const page = Math.max(Number(params.page) || 1, 1);

    const options = {
      search: searchTerm,
      simple: true as const,
      orderBy: "last_activity_at" as const,
      page,
      // One page is what was asked for; `perPage` alone would walk every page.
      ...boundedPage(perPage),
    };

    try {
      const projects = group
        ? await client.Groups.allProjects(group, {
            ...options,
            includeSubgroups: true,
          })
        : await client.Projects.all({ ...options, pagination: "offset" as const });

      const items = ((projects || []) as GitLabProject[]).map((p) => ({
        id: p.id,
        path: p.path_with_namespace,
        name: p.name,
        description: p.description || null,
        defaultBranch: p.default_branch || null,
        webUrl: p.web_url,
        lastActivityAt: p.last_activity_at,
      }));

      const output = {
        search: searchTerm,
        group: group || "all",
        page,
        perPage,
        totalFound: items.length,
        // A full page means more matches may exist: raise `per_page` or ask for the next `page`.
        truncated: pageIsFull(items.length, perPage),
        results: items,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitLabError(`search projects for '${searchTerm}'`, error);
    }
  },
};
