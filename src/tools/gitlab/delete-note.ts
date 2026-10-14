import { Tool } from "../../core/types.js";
import { getGitLabClient } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import {
  assertNoteWriteAllowed,
  assertUserNote,
  resolveNoteId,
} from "./note-guard.js";

export const gitlabDeleteNoteTool: Tool = {
  name: "gitlab_delete_note",
  description:
    "Delete an existing merge request comment (requires providers.gitlab.security.allow_write and explicit confirmation)",
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
      description: "Positive id of the comment to delete.",
    },
    confirm: {
      type: "boolean",
      optional: true,
      description:
        "Must be true to actually delete (safety guard). Without it the tool reports the note it would remove and stops.",
      default: false,
    },
  },
  execute: async (params) => {
    const { projectId, mrId } = assertNoteWriteAllowed(params);
    const noteId = resolveNoteId(params);
    const client = getGitLabClient();

    try {
      const note = await client.MergeRequestNotes.show(projectId, mrId, noteId);
      assertUserNote(note, noteId);

      const summary = {
        id: note.id,
        author: note.author?.username,
        body: note.body,
        createdAt: note.created_at,
      };

      // Deleting is irreversible and GitLab offers no dry run, so the note is described
      // and the call stops until the caller confirms.
      if (params.confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mrId,
                  noteId,
                  deleted: false,
                  wouldDelete: summary,
                  confirmationRequired: true,
                  message: `Pass \`confirm: true\` to delete comment ${noteId}.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      await client.MergeRequestNotes.remove(projectId, mrId, noteId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mrId,
                noteId,
                deleted: true,
                deletedNote: summary,
                success: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      throw formatGitLabError("delete the merge request note", error);
    }
  },
};
