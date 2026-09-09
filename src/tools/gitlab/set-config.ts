import { ToolError } from "../../core/errors.js";
import { Tool } from "../../core/types.js";
import { initGitLab } from "../../providers/gitlab.js";

export const gitlabSetConfigTool: Tool = {
  name: "gitlab_set_config",
  description:
    "Add or update GitLab configuration for the current session; an existing token is reused when token is omitted",
  params: {
    token: {
      type: "string",
      optional: true,
      description:
        "GitLab personal access token (api scope); omit to reuse the configured session token",
    },
    url: {
      type: "string",
      optional: true,
      description: 'GitLab instance URL (default: "https://gitlab.com")',
    },
    projectId: {
      type: "number",
      optional: true,
      description:
        "Persistent GitLab numeric project ID; operation calls use project_id",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config || {};
    if (!config.gitlab) config.gitlab = {};

    const updatedFields: string[] = [];
    for (const field of ["token", "url", "projectId"] as const) {
      if (params[field] !== undefined) {
        config.gitlab[field] = params[field];
        updatedFields.push(field);
      }
    }
    (global as any).__devtools_config = config;

    try {
      initGitLab(config);
    } catch (error: unknown) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "CONFIG_INVALID",
        "GitLab configuration could not be initialized.",
        "Correct the GitLab configuration and retry gitlab_set_config.",
        true,
        { cause: error },
      );
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            data: {
              updated: true,
              updated_fields: updatedFields.filter(
                (field) => field !== "token",
              ),
              token_updated: updatedFields.includes("token"),
              initialized: true,
            },
          }),
        },
      ],
    };
  },
};
