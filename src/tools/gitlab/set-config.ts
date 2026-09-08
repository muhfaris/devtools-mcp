import { Tool } from "../../core/types.js";
import { initGitLab } from "../../providers/gitlab.js";

export const gitlabSetConfigTool: Tool = {
  name: "gitlab_set_config",
  description:
    "Set GitLab configuration (token, URL, project ID) for the current session",
  params: {
    token: {
      type: "string",
      description: "GitLab personal access token (with api scope)",
    },
    url: {
      type: "string",
      optional: true,
      description: 'GitLab instance URL (default: "https://gitlab.com")',
    },
    projectId: {
      type: "number",
      optional: true,
      description: "GitLab project ID (numeric ID)",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config || {};
    if (!config.gitlab) config.gitlab = {};

    if (params.token) config.gitlab.token = params.token;
    if (params.url) config.gitlab.url = params.url;
    if (params.projectId) config.gitlab.projectId = params.projectId;

    // Re-initialize GitLab client
    try {
      initGitLab(config);
      return {
        content: [
          {
            type: "text",
            text: "✅ GitLab configuration updated and initialized successfully.",
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to initialize GitLab: ${error.message}`);
    }
  },
};
