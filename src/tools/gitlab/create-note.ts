import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import {
  getGitLabClient,
  getGitLabWebUrl,
  resolveMrId,
  resolveProjectId,
} from "../../providers/gitlab.js";

export const gitlabCreateNoteTool: Tool = {
  name: "gitlab_create_note",
  description: "Add a comment/note to a merge request",
  params: {
    mr_url: {
      type: "string",
      optional: true,
      description: "Full GitLab merge request URL",
    },
    project_id: {
      type: "string",
      optional: true,
      description:
        "GitLab project ID or path with namespace. Overrides config default.",
    },
    mr_id: {
      type: "number",
      optional: true,
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
    start_line: {
      type: "number",
      optional: true,
      description:
        "Start line for a multi-line code comment (requires end_line and path)",
    },
    end_line: {
      type: "number",
      optional: true,
      description:
        "End line for a multi-line code comment (requires start_line and path)",
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
    if (config?.providers?.gitlab?.enabled === false) {
      throw new ToolError(
        "CONFIG_REQUIRED",
        "GitLab is disabled in configuration.",
        "Enable providers.gitlab.enabled in .devtools/config.yaml, then retry this tool.",
        true,
        { configKey: "providers.gitlab.enabled" },
      );
    }
    if (!config?.providers?.gitlab && !config?.gitlab) {
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
    const mrId = resolveMrId(params);
    const body = params.body || "";

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

      // Check if it's a code comment (path + line, or path + start/end line)
      const isMultiLine =
        params.start_line && params.end_line && params.path;
      const isSingleLine = params.line && params.path;

      if (isMultiLine || isSingleLine) {
        // Get the latest commit SHA for this MR
        const mr = await client.MergeRequests.show(projectId, mrId);
        const sha = mr.sha || mr.diff_refs?.head_sha;

        if (!sha) {
          throw new Error("Could not determine commit SHA for code comment");
        }

        const baseSha = mr.diff_refs?.base_sha || sha;
        const headSha = mr.diff_refs?.head_sha || sha;
        const startSha = mr.diff_refs?.start_sha || sha;
        const newLine = params.side === "right" ? Number(params.line) : undefined;
        const oldLine = params.side === "left" ? Number(params.line) : undefined;

        const position: any = {
          base_sha: baseSha,
          head_sha: headSha,
          start_sha: startSha,
          new_line: newLine,
          old_line: oldLine,
          position_type: "text",
          new_path: params.path,
          old_path: params.path,
        };

        if (isMultiLine) {
          const start = Number(params.start_line);
          const end = Number(params.end_line);
          const lineCode = (n: number) =>
            `${headSha}_${params.path}_${n}`;
          position.line_range = {
            start: {
              line_code: lineCode(start),
              new_line: params.side === "right" ? start : undefined,
              old_line: params.side === "left" ? start : undefined,
              type: params.side === "left" ? "old" : "new",
            },
            end: {
              line_code: lineCode(end),
              new_line: params.side === "right" ? end : undefined,
              old_line: params.side === "left" ? end : undefined,
              type: params.side === "left" ? "old" : "new",
            },
          };
        }

        response = await (client.MergeRequestNotes.create as any)(
          projectId,
          mrId,
          body,
          { position },
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
      throw formatGitLabError("create the merge request note", error);
    }
  },
};
