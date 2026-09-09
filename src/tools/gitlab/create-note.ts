import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import {
  getGitLabClient,
  getGitLabWebUrl,
  resolveProjectId,
} from "../../providers/gitlab.js";

export const gitlabCreateNoteTool: Tool = {
  name: "gitlab_create_note",
  description: "Add a comment/note to a merge request",
  params: {
    project_id: {
      type: "number",
      optional: true,
      description: "GitLab project ID. Overrides config default.",
    },
    mr_id: {
      type: "number",
      description: "Merge request IID (internal ID)",
    },
    body: {
      type: "string",
      description: "Comment text",
    },
    type: {
      type: "string",
      optional: true,
      description: "Note type: note (default), discussion (thread start)",
      default: "note",
    },
    line: {
      type: "number",
      optional: true,
      description: "Line number for code comment (requires position)",
    },
    path: {
      type: "string",
      optional: true,
      description: "File path for code comment (requires line)",
    },
    side: {
      type: "string",
      optional: true,
      description: "Side of the diff: left, right (default: right)",
      default: "right",
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
    const mrId = Number(params.mr_id);
    const body = params.body || "";

    if (!mrId || isNaN(mrId)) {
      throw new ToolError(
        "GITLAB_MR_ID_REQUIRED",
        "A valid GitLab merge request ID is required.",
        "Ask the user for the numeric merge request IID, then retry this tool with mr_id.",
        true,
        { parameter: "mr_id" },
      );
    }

    if (!body || body.trim() === "") {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A comment body is required.",
        "Provide non-empty comment text in body, then retry this tool.",
        true,
        { parameter: "body" },
      );
    }

    try {
      let response;

      // Check if it's a code comment (line + path provided)
      if (params.line && params.path) {
        // Get the latest commit SHA for this MR
        const mr = await client.MergeRequests.show(projectId, mrId);
        const sha = mr.sha || mr.diff_refs?.head_sha;

        if (!sha) {
          throw new Error("Could not determine commit SHA for code comment");
        }

        response = await client.MergeRequestNotes.create(
          projectId,
          mrId,
          body,
          {
            line: Number(params.line),
            path: params.path,
            position: {
              base_sha: mr.diff_refs?.base_sha || sha,
              head_sha: mr.diff_refs?.head_sha || sha,
              start_sha: mr.diff_refs?.start_sha || sha,
              new_line:
                params.side === "right" ? Number(params.line) : undefined,
              old_line:
                params.side === "left" ? Number(params.line) : undefined,
              position_type: "text",
              new_path: params.path,
              old_path: params.path,
            },
          },
        );
      } else {
        // Regular comment
        response = await client.MergeRequestNotes.create(projectId, mrId, body);
      }

      const result = {
        id: response.id,
        mrId: mrId,
        body: response.body,
        author: response.author.username,
        createdAt: response.created_at,
        url: `${getGitLabWebUrl(config, projectId)}/-/merge_requests/${mrId}#note_${response.id}`,
        success: true,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "GITLAB_REQUEST_FAILED",
        "GitLab could not create the merge request note.",
        "Report the GitLab failure to the user; do not switch to local Git or retry automatically.",
        false,
        { cause: error },
      );
    }
  },
};
