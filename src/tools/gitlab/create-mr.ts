import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, getGitLabWebUrl } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import { assertGitLabWriteAllowed } from "./note-guard.js";

/** A required text argument has to carry something besides whitespace. */
const requireText = (params: Record<string, unknown>, name: string): string => {
  const raw = params[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `${name} is required.`,
      `Provide a non-empty ${name}, then retry this tool.`,
      true,
      { parameter: name },
    );
  }
  return value;
};

export const gitlabCreateMrTool: Tool = {
  name: "gitlab_create_mr",
  description:
    "Open a merge request from an existing source branch. It does not merge, approve, or assign anyone. Requires providers.gitlab.security.allow_write.",
  params: {
    project_id: {
      type: "string",
      optional: true,
      description:
        "GitLab project ID or path with namespace (e.g. 'group/project' or 774). Overrides config default.",
    },
    source_branch: {
      type: "string",
      description: "Branch that carries the changes. It must already exist on GitLab.",
    },
    target_branch: {
      type: "string",
      description: "Branch the merge request merges into (e.g. 'main').",
    },
    title: {
      type: "string",
      description: "Merge request title.",
    },
    description: {
      type: "string",
      optional: true,
      description: "Merge request description (markdown).",
    },
    remove_source_branch: {
      type: "boolean",
      optional: true,
      description:
        "Delete the source branch when the merge request is merged (default: false).",
      default: false,
    },
  },
  execute: async (params) => {
    const { projectId, config } = assertGitLabWriteAllowed(params);

    const sourceBranch = requireText(params, "source_branch");
    const targetBranch = requireText(params, "target_branch");
    const title = requireText(params, "title");
    if (sourceBranch === targetBranch) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "source_branch and target_branch must differ.",
        "Choose a target_branch that is not the source_branch, then retry this tool.",
        true,
        { parameter: "target_branch" },
      );
    }

    const client = getGitLabClient();

    try {
      const mr = await client.MergeRequests.create(
        projectId,
        sourceBranch,
        targetBranch,
        title,
        {
          ...(params.description ? { description: params.description } : {}),
          removeSourceBranch: params.remove_source_branch === true,
        },
      );

      const result = {
        iid: mr.iid,
        title: mr.title,
        state: mr.state,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        mergeStatus: mr.merge_status,
        draft: mr.draft,
        author: mr.author?.username,
        webUrl:
          mr.web_url ??
          `${getGitLabWebUrl(config, projectId)}/-/merge_requests/${mr.iid}`,
        success: true,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      throw formatGitLabError("create the merge request", error);
    }
  },
};
