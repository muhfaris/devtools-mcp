import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import {
  countChangedLines,
  diffOmissionReason,
} from "../../providers/gitlab-diff.js";

/** Characters of one file's patch that are inlined before it is cut short. */
const PATCH_CHARS = 800;
/** Files whose patch is inlined when diffs are asked for. */
const DEFAULT_MAX_FILES = 25;

/**
 * Merge status values GitLab reports for an MR whose branches conflict. `unchecked` /
 * `checking` mean the status has not settled yet, which is still "unknown" here.
 */
const CONFLICTED_STATUSES = new Set([
  "cannot_be_merged",
  "cannot_be_merged_recheck",
]);

/** One file's patch, cut to `PATCH_CHARS` unless the caller asked for all of it. */
const inlinePatch = (patch: string, full: boolean): string => {
  if (full || patch.length <= PATCH_CHARS) return patch;
  return `${patch.slice(0, PATCH_CHARS)}\n... (truncated, pass full_diff: true for complete diff)`;
};

export const gitlabCompareBranchesTool: Tool = {
  name: "gitlab_compare_branches",
  description:
    "Compare branches, tags, or commits in a GitLab repository. Returns the commits between them, a per-file change list (path, status, additions, deletions), and merge-conflict status. GitLab withholds some patches past its size limits; those files report additions/deletions/patchChars as null with a diffOmitted reason instead of a misleading 0, and diffOmittedCount says how many (so any total is known to be short). Patches are opt-in: pass include_diff: true for each file's patch, and full_diff: true for complete ones. Commit messages are opt-in too: pass include_messages: true for each commit's body, which `title` does not carry.",
  params: {
    mr_url: {
      type: "string",
      optional: true,
      description:
        "Full GitLab merge request URL (used to infer project_id if not supplied)",
    },
    project_id: {
      type: "string",
      optional: true,
      description:
        "GitLab project ID or path with namespace (e.g. 'group/project' or 774). Overrides config default.",
    },
    from: {
      type: "string",
      description:
        "Base branch name, tag, or commit SHA (e.g. 'main' or 'master')",
    },
    to: {
      type: "string",
      description:
        "Target/feature branch name, tag, or commit SHA (e.g. 'feat/my-feature')",
    },
    straight: {
      type: "boolean",
      optional: true,
      description:
        "Direct comparison between from and to (from..to) instead of three-dot merge base (from...to). Default: false",
      default: false,
    },
    include_diff: {
      type: "boolean",
      optional: true,
      description:
        "Inline each file's patch (default: false). The per-file change list is always returned; this adds the patch text",
      default: false,
    },
    full_diff: {
      type: "boolean",
      optional: true,
      description:
        "Inline complete patches rather than the first 800 characters of each (default: false). Only meaningful with include_diff: true",
      default: false,
    },
    max_files: {
      type: "number",
      optional: true,
      description:
        "How many files get their patch inlined (default: 25). The per-file change list is never capped",
      default: DEFAULT_MAX_FILES,
    },
    include_messages: {
      type: "boolean",
      optional: true,
      description:
        "Include each commit's full message (default: false). `title` is always returned; the message repeats it and adds the body, which is what makes a long comparison long",
      default: false,
    },
    detect_conflicts: {
      type: "boolean",
      optional: true,
      description:
        "Look up an existing merge request for this from/to pair and report whether its branches conflict (default: true). GitLab's compare endpoint carries no conflict info, so this is read from the matching MR's merge_status; without a matching MR the status is `unknown`",
      default: true,
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

    const fromRef = (params.from || "").trim();
    const toRef = (params.to || "").trim();

    if (!fromRef || !toRef) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "Both 'from' and 'to' branch/commit references are required.",
        "Provide base branch in 'from' and target branch in 'to', then retry.",
        true,
        { parameter: !fromRef ? "from" : "to" },
      );
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);

    try {
      const comparison = await client.Repositories.compare(
        projectId,
        fromRef,
        toRef,
        { straight: Boolean(params.straight) },
      );

      const commits = (comparison.commits || []).map((c: any) => ({
        id: c.id,
        shortId: c.short_id,
        title: c.title,
        // The message is the subject line the title already carries, plus a body that is
        // often a release note, a changelog, or an explaining paragraph. It is the largest
        // per-commit field by far, so it is asked for rather than assumed — a `git log`
        // for triage does not read bodies.
        ...(params.include_messages === true ? { message: c.message } : {}),
        authorName: c.author_name,
        authoredDate: c.authored_date,
      }));

      const includeDiff = params.include_diff === true;
      const full = params.full_diff === true;
      const maxFiles = Math.max(
        1,
        Math.min(Number(params.max_files) || DEFAULT_MAX_FILES, 500),
      );

      const rawDiffs: any[] = comparison.diffs || [];
      // Always returned. The full patches used to be the response, which made a 200-file
      // comparison a 214k-character answer to a question that was "what changed?" — and
      // a file list answers that without the text of every hunk.
      const files = rawDiffs.map((d: any) => {
        const diffOmitted = diffOmissionReason(d);
        // A withheld patch has no counts. Reporting 0 would make a +492 new file look
        // like an empty change, so the counts are null and the reason rides alongside;
        // `diffOmitted` is always present, null when the counts are real.
        const counted = diffOmitted === null;
        return {
          file: d.new_path || d.old_path,
          oldPath: d.old_path,
          newPath: d.new_path,
          newFile: Boolean(d.new_file),
          deletedFile: Boolean(d.deleted_file),
          renamedFile: Boolean(d.renamed_file),
          additions: counted ? countChangedLines(d.diff, "+") : null,
          deletions: counted ? countChangedLines(d.diff, "-") : null,
          patchChars: counted ? (d.diff || "").length : null,
          diffOmitted,
        };
      });

      // Any total summed from `files` is short by however many patches GitLab withheld,
      // so the count and the completeness flag travel with the list instead of letting a
      // partial sum pass for the size of the comparison.
      const diffOmittedCount = files.filter(
        (file) => file.diffOmitted !== null,
      ).length;

      const detectConflicts = params.detect_conflicts !== false;

      // The compare endpoint carries no conflict information at all, so a conflicted
      // pair and a clean one used to look identical in the output. GitLab does compute
      // a merge_status on any merge request for the pair, so if one exists it answers
      // the conflict question with a single list call — without ever creating an MR.
      const mergeStatus = detectConflicts
        ? await (async (): Promise<{
            mergeStatus: string;
            mergeStatusSource: string;
            mr?: { iid: number | string; title?: string; url?: string };
          }> => {
            try {
              const matching = (
                client.MergeRequests?.all
                  ? await client.MergeRequests.all({
                      projectId,
                      sourceBranch: toRef,
                      targetBranch: fromRef,
                    })
                  : []
              ) as any[];
              const mr = matching[0];
              if (!mr) {
                return {
                  mergeStatus: "unknown",
                  mergeStatusSource: "not_available",
                };
              }
              return {
                mergeStatus: CONFLICTED_STATUSES.has(mr.merge_status)
                  ? "conflicts"
                  : mr.merge_status === "can_be_merged"
                    ? "no_conflicts"
                    : "unknown",
                mergeStatusSource: "existing_merge_request",
                mr: {
                  iid: mr.iid,
                  title: mr.title,
                  url: mr.web_url,
                },
              };
            } catch {
              // An unreadable MR status must not fail the whole comparison.
              return {
                mergeStatus: "unknown",
                mergeStatusSource: "not_available",
              };
            }
          })()
        : undefined;

      const result = {
        project: projectId,
        from: fromRef,
        to: toRef,
        commitsCount: commits.length,
        filesCount: files.length,
        commits,
        files,
        diffOmittedCount,
        statsComplete: diffOmittedCount === 0,
        diffIncluded: includeDiff,
        ...(includeDiff
          ? {
              diffs: rawDiffs
                .slice(0, maxFiles)
                .map((d: any, index: number) => ({
                  file: files[index].file,
                  diff: inlinePatch(d.diff || "", full),
                  truncated: !full && (d.diff || "").length > PATCH_CHARS,
                  diffOmitted: files[index].diffOmitted,
                })),
              diffsOmitted: Math.max(rawDiffs.length - maxFiles, 0),
            }
          : {}),
        compareTimeout: comparison.compare_timeout || false,
        compareSameRef: comparison.compare_same_ref || false,
        ...mergeStatus,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError(`compare '${fromRef}' with '${toRef}'`, error);
    }
  },
};
