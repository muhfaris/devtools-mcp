import { Tool } from "../../core/types.js";
import { MissingConfigError } from "../../core/errors.js";
import {
  getGitLabClient,
  resolveProjectId,
  getGitLabConfig,
} from "../../providers/gitlab.js";

export const gitlabListMrsTool: Tool = {
  name: "gitlab_list_mrs",
  description: "List merge requests from GitLab project with filters",
  params: {
    project_id: {
      type: "number",
      optional: true,
      description: "GitLab project ID. Overrides config default.",
    },
    state: {
      type: "string",
      optional: true,
      description:
        "MR state: opened, closed, merged, locked, all (default: opened)",
      default: "opened",
    },
    author: {
      type: "string",
      optional: true,
      description: "Filter by author username",
    },
    assignee: {
      type: "string",
      optional: true,
      description: "Filter by assignee username",
    },
    reviewer: {
      type: "string",
      optional: true,
      description: "Filter by reviewer username",
    },
    labels: {
      type: "string",
      optional: true,
      description: "Filter by labels (comma-separated)",
    },
    limit: {
      type: "number",
      optional: true,
      description: "Maximum number of MRs to return (default: 20)",
      default: 20,
    },
    search: {
      type: "string",
      optional: true,
      description: "Search in title and description",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    if (!config) {
      throw new MissingConfigError(
        "gitlab",
        "GitLab is not configured. Please set your GitLab token.",
        "gitlab_set_config",
        { url: "https://gitlab.com", projectId: "" },
      );
    }

    // Check if GitLab is configured
    if (!config.gitlab) {
      throw new MissingConfigError(
        "gitlab.token",
        "GitLab token is missing. Please provide your personal access token.",
        "gitlab_set_config",
        { token: "" },
      );
    }
    // Priority: params.project_id > config.gitlab.projectId > error
    const projectId = resolveProjectId(params, config);

    const client = getGitLabClient();

    const state = params.state || "opened";
    const limit = Math.min(Number(params.limit) || 20, 100);

    try {
      const mrList = await client.MergeRequests.all({
        projectId: projectId,
        state: state as any,
        ...(params.author && { authorUsername: params.author }),
        ...(params.assignee && { assigneeUsername: params.assignee }),
        ...(params.reviewer && { reviewerUsername: params.reviewer }),
        ...(params.labels && {
          labels: params.labels.split(",").map((l) => l.trim()),
        }),
        ...(params.search && { search: params.search }),
        perPage: limit,
        sort: "desc",
        orderBy: "updated_at",
      });

      const result = mrList.map((mr: any) => ({
        id: mr.iid,
        title: mr.title,
        state: mr.state,
        author: mr.author.username,
        createdAt: mr.created_at,
        updatedAt: mr.updated_at,
        webUrl: mr.web_url,
        description:
          mr.description?.substring(0, 200) +
          (mr.description?.length > 200 ? "..." : ""),
        approvals: mr.approvals?.approved || false,
        mergeStatus: mr.merge_status,
        hasConflicts: mr.has_conflicts || false,
        wip: mr.wip || false,
        draft: mr.draft || false,
      }));

      const summary = {
        total: result.length,
        state: state,
        mergeRequests: result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Failed to list merge requests: ${error.message}`);
    }
  },
};
