import { ToolError } from "../../core/errors.js";
import type { Tool } from "../../core/types.js";
import { initGitHub } from "../../providers/github.js";

export const githubSetConfigTool: Tool = {
  name: "github_set_config",
  description:
    "Add or update GitHub configuration for the current session; an existing token is reused when token is omitted",
  params: {
    token: {
      type: "string",
      optional: true,
      description:
        "GitHub personal access token (repository read access; write needs contents/pull-requests write); omit to reuse the configured session token",
    },
    url: {
      type: "string",
      optional: true,
      description:
        'GitHub web host (default: "https://github.com"; a GitHub Enterprise Server host serves its API from /api/v3)',
    },
    repo: {
      type: "string",
      optional: true,
      description:
        "Persistent repository as 'owner/name'; operation calls use repo",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config || {};
    if (!config.providers) config.providers = {};
    if (!config.providers.github) config.providers.github = {};

    const updatedFields: string[] = [];
    for (const field of ["token", "url", "repo"] as const) {
      if (params[field] !== undefined) {
        config.providers.github[field] = params[field];
        updatedFields.push(field);
      }
    }
    (global as any).__devtools_config = config;

    try {
      initGitHub(config);
    } catch (error: unknown) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "CONFIG_INVALID",
        "GitHub configuration could not be initialized.",
        "Correct the GitHub configuration and retry github_set_config.",
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
