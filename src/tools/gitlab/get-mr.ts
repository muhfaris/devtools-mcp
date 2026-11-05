import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import {
  boundedPage,
  getGitLabClient,
  pageIsFull,
  resolveMrId,
  resolveProjectId,
} from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import { diffOmissionReason } from "../../providers/gitlab-diff.js";
import {
  countChangedLines,
  parseDiffLines,
} from "../../providers/diff.js";

export const gitlabGetMrTool: Tool = {
  name: "gitlab_get_mr",
  description:
    "Get detailed merge request metadata, commits, discussions, and file changes/diffs from GitLab. Each changed file is numbered line by line for the old and new side, so an inline comment can be anchored without counting hunk headers. A file whose patch GitLab withheld is marked with diffOmitted (its additions/deletions/patch are empty, and its counts are null, not 0). Commit subjects are always returned; pass include_messages: true for each commit's full message. For deep code reviews with file-by-file suggestions, use gitlab_review_mr.",
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
    diff_lines: {
      type: "boolean",
      optional: true,
      description:
        "Number every line of each changed file with its old_line, new_line, and type (added, removed, or unchanged), so a comment can be anchored without counting hunk headers (default: true). Pass false to trim the response.",
      default: true,
    },
    include_discussions: {
      type: "boolean",
      optional: true,
      description: "Include discussions/comments (default: false)",
      default: false,
    },
    include_messages: {
      type: "boolean",
      optional: true,
      description:
        "Include each commit's full message (default: false). `title` is always returned; the message repeats it and adds the body",
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
    if (!isProviderConfigured(config, "gitlab")) {
      throw new ToolError(
        "CONFIG_REQUIRED",
        "GitLab configuration is required.",
        "Configure GitLab with gitlab_set_config, then retry this tool.",
        true,
        { configKey: "providers.gitlab", setupTool: "gitlab_set_config" },
      );
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const mrId = resolveMrId(params);
    /** Both list calls below are paged, and both say so when a page came back full. */
    const pageSize = 100;
    let commitsTruncated = false;
    let notesTruncated = false;

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
            boundedPage(pageSize),
          );
          commitsTruncated = pageIsFull(mrCommits.length, pageSize);
          commits = mrCommits.map((c: any) => ({
            id: c.id,
            shortId: c.short_id,
            title: c.title,
            // Same rule as `gitlab_get_commits`: the subject is the log, the body is on
            // request.
            ...(params.include_messages === true ? { message: c.message } : {}),
            authorName: c.author_name,
            createdAt: c.created_at,
          }));
        } catch {
          commits = [];
        }
      }

      // Get changes/diff
      let diff: any[] = [];
      let diffOmittedCount = 0;
      if (params.include_diff !== false) {
        const changes = await client.MergeRequests.showChanges(projectId, mrId);
        const full = params.full_diff === true;
        const withLines = params.diff_lines !== false;
        diff = changes.changes.map((c: any) => {
          // A patch GitLab withheld cannot be numbered or counted. Without this the file
          // would read as an empty, unchanged one: the counts are null, not 0, and the
          // reason travels with the entry.
          const diffOmitted = diffOmissionReason(c);
          const reviewed = diffOmitted === null;
          return {
            file: c.new_path || c.old_path,
            added: c.new_file || false,
            removed: c.deleted_file || false,
            renamed: c.renamed_file || false,
            diffOmitted,
            additions: reviewed
              ? typeof c.additions === "number"
                ? c.additions
                : countChangedLines(c.diff, "+")
              : null,
            deletions: reviewed
              ? typeof c.deletions === "number"
                ? c.deletions
                : countChangedLines(c.diff, "-")
              : null,
            diff: full
              ? c.diff || ""
              : c.diff?.substring(0, 800) +
                (c.diff && c.diff.length > 800
                  ? "\n... (truncated, pass full_diff: true for complete diff)"
                  : ""),
            // Numbered from the complete patch, so the numbers stay right even when the
            // text above is truncated. A null line number is a side the line does not
            // exist on, and therefore a side a comment cannot be anchored to.
            ...(withLines ? { lines: parseDiffLines(c.diff || "") } : {}),
          };
        });
        diffOmittedCount = diff.filter(
          (d: any) => d.diffOmitted !== null,
        ).length;
      }

      // Get discussions
      let discussions: any[] = [];
      if (params.include_discussions) {
        const notes = await client.MergeRequestNotes.all(
          projectId,
          mrId,
          boundedPage(pageSize),
        );
        notesTruncated = pageIsFull(notes.length, pageSize);
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
        // Only when diffs were asked for: with include_diff: false there is no change
        // list, and a vacuous `true` would read as a claim that this one is complete.
        ...(params.include_diff !== false
          ? {
              diffOmittedCount,
              statsComplete: diffOmittedCount === 0,
            }
          : {}),
        discussions: discussions,
        // Both lists are capped at one page of 100. `true` here means the answer stops
        // at the cap rather than at the end of the list, which the counts alone would
        // not say.
        truncated: { commits: commitsTruncated, discussions: notesTruncated },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError("get the merge request", error);
    }
  },
};
