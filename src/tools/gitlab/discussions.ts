import { Tool } from "../../core/types.js";
import { getGitLabClient, resolveProjectId } from "../../providers/gitlab.js";

export const gitlabGetDiscussionsTool: Tool = {
  name: "gitlab_get_mr_discussions",
  description: "Get all discussion threads and comments on a merge request",
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
    only_unresolved: {
      type: "boolean",
      optional: true,
      description: "Only show unresolved discussions (default: false)",
      default: false,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    if (!config?.gitlab) {
      throw new Error("GitLab not configured in .devtools/config.yaml");
    }

    const client = getGitLabClient();
    const projectId = resolveProjectId(params, config);
    const mrId = Number(params.mr_id);

    if (!mrId || isNaN(mrId)) {
      throw new Error("Valid MR ID is required");
    }

    try {
      // Get discussions
      const discussions = await client.Discussions.all(projectId, mrId);

      const filtered = params.only_unresolved
        ? discussions.filter((d: any) => d.resolvable && !d.resolved)
        : discussions;

      const result = {
        mrId: mrId,
        totalDiscussions: discussions.length,
        totalNotes: discussions.reduce((sum, d) => sum + d.notes.length, 0),
        unresolvedCount: discussions.filter(
          (d: any) => d.resolvable && !d.resolved,
        ).length,
        discussions: filtered.map((d: any) => ({
          id: d.id,
          resolvable: d.resolvable || false,
          resolved: d.resolved || false,
          notes: d.notes.map((n: any) => ({
            id: n.id,
            author: n.author.username,
            body: n.body,
            createdAt: n.created_at,
            isSystem: n.system || false,
            type: n.type || "note",
          })),
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Failed to get discussions: ${error.message}`);
    }
  },
};
