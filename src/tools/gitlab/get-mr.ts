import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";

export const gitlabGetMrTool: Tool = {
  name: "gitlab_get_mr",
  description:
    "Get detailed merge request information including diff, changes, and discussions",
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
    include_diff: {
      type: "boolean",
      optional: true,
      description: "Include diff/changes (default: true)",
      default: true,
    },
    include_discussions: {
      type: "boolean",
      optional: true,
      description: "Include discussions/comments (default: false)",
      default: false,
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

    if (!mrId || isNaN(mrId)) {
      throw new ToolError(
        "GITLAB_MR_ID_REQUIRED",
        "A valid GitLab merge request ID is required.",
        "Ask the user for the numeric merge request IID, then retry this tool with mr_id.",
        true,
        { parameter: "mr_id" },
      );
    }

    try {
      // Get MR details
      const mr = await client.MergeRequests.show(projectId, mrId);

      // Get changes/diff
      let diff: any[] = [];
      if (params.include_diff !== false) {
        const changes = await client.MergeRequests.changes(projectId, mrId);
        diff = changes.changes.map((c: any) => ({
          file: c.new_path || c.old_path,
          added: c.new_file || false,
          removed: c.deleted_file || false,
          renamed: c.renamed_file || false,
          additions: c.additions,
          deletions: c.deletions,
          diff: c.diff?.substring(0, 500) + (c.diff?.length > 500 ? "..." : ""),
        }));
      }

      // Get discussions
      let discussions: any[] = [];
      if (params.include_discussions) {
        const notes = await client.MergeRequestNotes.all(projectId, mrId);
        discussions = notes.map((n: any) => ({
          id: n.id,
          author: n.author.username,
          body: n.body,
          createdAt: n.created_at,
          isSystem: n.system || false,
        }));
      }

      const result = {
        id: mr.iid,
        title: mr.title,
        description: mr.description,
        state: mr.state,
        author: mr.author.username,
        assignees: mr.assignees?.map((a: any) => a.username) || [],
        reviewers: mr.reviewers?.map((r: any) => r.username) || [],
        labels: mr.labels || [],
        milestone: mr.milestone?.title || null,
        createdAt: mr.created_at,
        updatedAt: mr.updated_at,
        closedAt: mr.closed_at || null,
        mergedAt: mr.merged_at || null,
        webUrl: mr.web_url,
        mergeStatus: mr.merge_status,
        hasConflicts: mr.has_conflicts || false,
        wip: mr.wip || false,
        draft: mr.draft || false,
        approvals: {
          approved: mr.approvals?.approved || false,
          approvedBy:
            mr.approvals?.approved_by?.map((a: any) => a.user.username) || [],
          approvalsLeft: mr.approvals?.approvals_left || 0,
        },
        pipeline: mr.head_pipeline?.status || null,
        diff: diff,
        discussions: discussions,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "GITLAB_REQUEST_FAILED",
        "GitLab could not get the merge request.",
        "Report the GitLab failure to the user; do not switch to local Git or retry automatically.",
        false,
        { cause: error },
      );
    }
  },
};
