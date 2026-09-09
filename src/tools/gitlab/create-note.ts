import { Tool } from "../../core/types.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";

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
      throw new Error("GitLab not configured in .devtools/config.yaml");
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const mrId = Number(params.mr_id);
    const body = params.body || "";

    if (!mrId || isNaN(mrId)) {
      throw new Error("Valid MR ID is required");
    }

    if (!body || body.trim() === "") {
      throw new Error("Comment body is required");
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
        url: `https://gitlab.com/${config.gitlab.projectId}/merge_requests/${mrId}#note_${response.id}`,
        success: true,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Failed to create note: ${error.message}`);
    }
  },
};
