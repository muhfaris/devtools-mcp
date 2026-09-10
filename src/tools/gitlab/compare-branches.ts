import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";

export const gitlabCompareBranchesTool: Tool = {
  name: "gitlab_compare_branches",
  description:
    "Compare branches, tags, or commits in a GitLab repository. Returns commits list, full diffs, and merge conflict status between base (from) and target (to) refs.",
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
        message: c.message,
        authorName: c.author_name,
        authoredDate: c.authored_date,
      }));

      const diffs = (comparison.diffs || []).map((d: any) => ({
        file: d.new_path || d.old_path,
        oldPath: d.old_path,
        newPath: d.new_path,
        newFile: d.new_file || false,
        deletedFile: d.deleted_file || false,
        renamedFile: d.renamed_file || false,
        diff: d.diff || "",
      }));

      const result = {
        project: projectId,
        from: fromRef,
        to: toRef,
        commitsCount: commits.length,
        filesCount: diffs.length,
        commits,
        diffs,
        compareTimeout: comparison.compare_timeout || false,
        compareSameRef: comparison.compare_same_ref || false,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError(`compare '${fromRef}' with '${toRef}'`, error);
    }
  },
};
