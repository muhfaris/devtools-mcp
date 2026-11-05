import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, getGitLabWebUrl } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import { assertNoteWriteAllowed } from "./note-guard.js";

type MrEdit = { targetBranch?: string; title?: string; description?: string };

/**
 * Which fields the caller wants changed. A field is changed only when it is passed, so a
 * retarget does not blank the description. An empty `description` is a real request (clear
 * it); an empty `title` or `target_branch` is never valid.
 */
const resolveEdit = (params: Record<string, unknown>): MrEdit => {
  const edit: MrEdit = {};

  for (const [param, key] of [
    ["target_branch", "targetBranch"],
    ["title", "title"],
  ] as const) {
    const raw = params[param];
    if (raw === undefined || raw === null) continue;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `${param} must not be empty.`,
        `Provide a non-empty ${param}, or omit it to leave it unchanged, then retry this tool.`,
        true,
        { parameter: param },
      );
    }
    edit[key] = value;
  }

  if (params.description !== undefined && params.description !== null) {
    edit.description = String(params.description);
  }

  if (Object.keys(edit).length === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Nothing to update.",
      "Pass at least one of target_branch, title, or description, then retry this tool.",
      true,
      { parameter: "target_branch" },
    );
  }

  return edit;
};

export const gitlabUpdateMrTool: Tool = {
  name: "gitlab_update_mr",
  description:
    "Change an open merge request's target branch, title, or description. Only the fields you pass change. It does not merge, close, or approve. Requires providers.gitlab.security.allow_write.",
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
    target_branch: {
      type: "string",
      optional: true,
      description: "New target branch. Omit to keep the current one.",
    },
    title: {
      type: "string",
      optional: true,
      description: "New title. Omit to keep the current one.",
    },
    description: {
      type: "string",
      optional: true,
      description:
        "New description (markdown), replacing the whole text. Pass an empty string to clear it. Omit to keep the current one.",
    },
  },
  execute: async (params) => {
    const { projectId, mrId, config } = assertNoteWriteAllowed(params);
    const edit = resolveEdit(params);

    const client = getGitLabClient();

    try {
      // Read before writing: the response can then show what was replaced, and an unknown
      // merge request is reported as such rather than as GitLab's bare 404.
      const before = await client.MergeRequests.show(projectId, mrId);

      const after = await client.MergeRequests.edit(projectId, mrId, edit);

      const result = {
        iid: after.iid,
        state: after.state,
        mergeStatus: after.merge_status,
        title: after.title,
        targetBranch: after.target_branch,
        sourceBranch: after.source_branch,
        webUrl:
          after.web_url ??
          `${getGitLabWebUrl(config, projectId)}/-/merge_requests/${mrId}`,
        changed: {
          ...(edit.targetBranch !== undefined && {
            targetBranch: { from: before.target_branch, to: after.target_branch },
          }),
          ...(edit.title !== undefined && {
            title: { from: before.title, to: after.title },
          }),
          ...(edit.description !== undefined && {
            description: {
              from: before.description ?? "",
              to: after.description ?? "",
            },
          }),
        },
        success: true,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitLabError("update the merge request", error);
    }
  },
};
