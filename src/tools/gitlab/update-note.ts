import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, getGitLabWebUrl } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import {
  assertNoteWriteAllowed,
  assertUserNote,
  resolveNoteId,
} from "./note-guard.js";

export const gitlabUpdateNoteTool: Tool = {
  name: "gitlab_update_note",
  description:
    "Edit the body of an existing merge request comment, for when a review comment was wrong. Requires providers.gitlab.security.allow_write.",
  params: {
    mr_url: {
      type: "string",
      optional: true,
      description:
        "Full GitLab merge request URL. If mr_id is also provided, both must identify the same merge request.",
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
      description:
        "Positive merge request IID. Must match the IID in mr_url when both are provided.",
    },
    note_id: {
      type: "number",
      description:
        "Positive id of the comment to edit. Returned by gitlab_create_note and gitlab_get_mr.",
    },
    body: {
      type: "string",
      description: "Replacement comment text. Replaces the note body entirely.",
    },
  },
  execute: async (params) => {
    const { projectId, mrId, config } = assertNoteWriteAllowed(params);
    const noteId = resolveNoteId(params);

    const body = params.body || "";
    if (!body || body.trim() === "") {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A comment body is required.",
        "Provide non-empty replacement text in body, then retry this tool.",
        true,
        { parameter: "body" },
      );
    }

    const client = getGitLabClient();

    try {
      // Read before writing: an unknown note_id should name the note that is missing, and
      // on a write GitLab's own 404 is harder to tell apart from a permissions problem.
      const existing = await client.MergeRequestNotes.show(projectId, mrId, noteId);
      assertUserNote(existing, noteId);

      const updated = await client.MergeRequestNotes.edit(
        projectId,
        mrId,
        noteId,
        { body },
      );

      const result = {
        id: updated.id,
        mrId,
        body: updated.body,
        author: updated.author?.username,
        updatedAt: updated.updated_at,
        url: `${getGitLabWebUrl(config, projectId)}/-/merge_requests/${mrId}#note_${updated.id}`,
        previousBody: (existing as any)?.body,
        success: true,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError("update the merge request note", error);
    }
  },
};
