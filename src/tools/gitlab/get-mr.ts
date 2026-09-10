import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import {
  getGitLabClient,
  resolveMrId,
  resolveProjectId,
} from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabGetMrTool: Tool = {
  name: "gitlab_get_mr",
  description:
    "Get detailed merge request metadata, commits, discussions, and file changes/diffs from GitLab. For deep code reviews with file-by-file suggestions, use gitlab_review_mr.",
  params: {
    mr_url: {
      type: "string",
      optional: true,
      description:
        "Full GitLab merge request URL (e.g. https://gitlab.com/group/project/-/merge_requests/123)",
    },
    project_id: {
      type: "string",
      optional: true,
      description:
        "GitLab project ID or path with namespace (e.g., 'group/project' or 774). Overrides config default.",
    },
    mr_id: {
      type: "number",
      optional: true,
      description: "Merge request IID (internal ID)",
    },
    include_commits: {
      type: "boolean",
      optional: true,
      description: "Include list of commits in this MR (default: true)",
      default: true,
    },
    include_diff: {
      type: "boolean",
      optional: true,
      description: "Include diff/changes (default: true)",
      default: true,
    },
    full_diff: {
      type: "boolean",
      optional: true,
      description:
        "Include full un-truncated diffs for code reviews (default: false)",
      default: false,
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

    try {
      // Get MR details
      const mr = await client.MergeRequests.show(projectId, mrId);

      // Get commits
      let commits: any[] = [];
      if (params.include_commits !== false) {
        try {
          const mrCommits = await client.MergeRequests.allCommits(
            projectId,
            mrId,
          );
          commits = mrCommits.map((c: any) => ({
            id: c.id,
            shortId: c.short_id,
            title: c.title,
            message: c.message,
            authorName: c.author_name,
            createdAt: c.created_at,
          }));
        } catch {
          commits = [];
        }
      }

      // Get changes/diff
      let diff: any[] = [];
      if (params.include_diff !== false) {
        const changes = await client.MergeRequests.showChanges(projectId, mrId);
        const full = params.full_diff === true;
        diff = changes.changes.map((c: any) => ({
          file: c.new_path || c.old_path,
          added: c.new_file || false,
          removed: c.deleted_file || false,
          renamed: c.renamed_file || false,
          additions: c.additions,
          deletions: c.deletions,
          diff: full
            ? c.diff || ""
            : c.diff?.substring(0, 800) +
              (c.diff && c.diff.length > 800
                ? "\n... (truncated, pass full_diff: true for complete diff)"
                : ""),
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
        author: mr.author?.username,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
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
          approved: (mr as any).approvals?.approved || false,
          approvedBy:
            (mr as any).approvals?.approved_by?.map(
              (a: any) => a.user.username,
            ) || [],
          approvalsLeft: (mr as any).approvals?.approvals_left || 0,
        },
        pipeline: mr.head_pipeline?.status || null,
        commitsCount: commits.length,
        commits,
        diff: diff,
        discussions: discussions,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError("get the merge request", error);
    }
  },
};
