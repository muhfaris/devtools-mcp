import { createHash } from "node:crypto";
import { Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import {
  findBlockedEnvironment,
  resolveAllowWrite,
} from "../../core/security.js";
import { formatGitLabError } from "../../providers/gitlab-error.js";
import {
  getGitLabClient,
  getGitLabWebUrl,
  resolveMrId,
  resolveProjectId,
} from "../../providers/gitlab.js";

type InlinePosition = {
  isSingleLine: boolean;
  isMultiLine: boolean;
};

type MergeRequestDiff = {
  old_path: string;
  new_path: string;
  diff: string;
};

const collectCommentableLines = (diff: string) => {
  const oldLines = new Map<number, number | undefined>();
  const newLines = new Map<number, number | undefined>();
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const row of diff.split("\n")) {
    const header = row.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || row.startsWith("\\")) continue;
    if (row.startsWith("+")) {
      newLines.set(newLine++, undefined);
    } else if (row.startsWith("-")) {
      oldLines.set(oldLine++, undefined);
    } else if (row.startsWith(" ")) {
      oldLines.set(oldLine, newLine);
      newLines.set(newLine, oldLine);
      oldLine++;
      newLine++;
    }
  }

  return { oldLines, newLines };
};

const validateDiffPosition = (
  params: Record<string, any>,
  diffs: MergeRequestDiff[],
): MergeRequestDiff => {
  const side = params.side === "left" ? "left" : "right";
  const pathKey = side === "left" ? "old_path" : "new_path";
  const changedFile = diffs.find((diff) => diff[pathKey] === params.path);
  const invalid = (message: string, action: string, parameter: string) => {
    throw new ToolError(
      "GITLAB_INLINE_POSITION_NOT_FOUND",
      message,
      action,
      false,
      { parameter },
    );
  };

  if (!changedFile) {
    invalid(
      `Path ${params.path} is not present on the ${side} side of this merge request diff.`,
      `Use a changed file path from the merge request's ${side} side, or use the other side for a renamed or deleted file.`,
      "path",
    );
  }

  const lines = collectCommentableLines(changedFile!.diff);
  const commentable = side === "left" ? lines.oldLines : lines.newLines;
  const requested = Number(params.line) > 0
    ? [Number(params.line)]
    : Array.from(
        { length: Number(params.end_line) - Number(params.start_line) + 1 },
        (_, index) => Number(params.start_line) + index,
      );
  const invalidLine = requested.find((line) => !commentable.has(line));

  if (invalidLine !== undefined) {
    const parameter = Number(params.line) > 0
      ? "line"
      : invalidLine === Number(params.start_line)
        ? "start_line"
        : "end_line";
    invalid(
      `Line ${invalidLine} is not commentable on the ${side} side of ${params.path}.`,
      `Choose a line shown in the merge request diff on the ${side} side, or change side to ${side === "left" ? "right" : "left"}.`,
      parameter,
    );
  }

  return changedFile!;
};

const getDiffLines = (diff: MergeRequestDiff) =>
  collectCommentableLines(diff.diff);

const validateInlineResponse = (
  discussion: Record<string, any>,
  params: Record<string, any>,
  isMultiLine: boolean,
) => {
  const note = discussion.notes?.[0];
  const position = note?.position;
  const side = params.side === "left" ? "left" : "right";
  const pathKey = side === "left" ? "old_path" : "new_path";
  const lineKey = side === "left" ? "old_line" : "new_line";
  const matchesLine = isMultiLine
    ? (Number(position?.line_range?.start?.[lineKey]) === Number(params.start_line) ||
        Number(position?.line_range?.end?.[lineKey]) === Number(params.end_line) ||
        Number(position?.[lineKey]) === Number(params.end_line))
    : Number(position?.[lineKey]) === Number(params.line);

  if (!note || note.resolvable !== true || position?.[pathKey] !== params.path || !matchesLine) {
    throw new ToolError(
      "GITLAB_INLINE_POSITION_MISSING",
      "GitLab created a discussion without the requested diff position.",
      "Verify the merge request, changed path, side, and line numbers; do not report the inline comment as successful.",
      false,
      { parameter: "path" },
    );
  }

  return { note, position };
};

const createLineCode = (
  path: string,
  side: "left" | "right",
  line: number,
  lines: ReturnType<typeof collectCommentableLines>,
) => {
  const pathHash = createHash("sha1").update(path).digest("hex");
  const oldLine = side === "left" ? line : lines.newLines.get(line);
  const newLine = side === "right" ? line : lines.oldLines.get(line);
  return `${pathHash}_${oldLine ?? ""}_${newLine ?? ""}`;
};

const validateInlinePosition = (
  params: Record<string, any>,
): InlinePosition => {
  const invalid = (message: string, action: string, parameter: string) => {
    throw new ToolError(
      "GITLAB_INLINE_POSITION_INVALID",
      message,
      action,
      false,
      { parameter },
    );
  };
  const isPositiveInteger = (value: unknown) =>
    Number.isInteger(Number(value)) && Number(value) > 0;

  if (params.side !== undefined && !["left", "right"].includes(params.side)) {
    invalid(
      `Unsupported diff side: ${String(params.side)}.`,
      "Use side: right for lines in the new file or side: left for lines in the old file.",
      "side",
    );
  }

  const rawLine = params.line !== undefined && params.line !== null ? Number(params.line) : undefined;
  const rawStart = params.start_line !== undefined && params.start_line !== null ? Number(params.start_line) : undefined;
  const rawEnd = params.end_line !== undefined && params.end_line !== null ? Number(params.end_line) : undefined;

  const validLine = rawLine !== undefined && isPositiveInteger(rawLine) ? rawLine : undefined;
  const validStart = rawStart !== undefined && isPositiveInteger(rawStart) ? rawStart : undefined;
  const validEnd = rawEnd !== undefined && isPositiveInteger(rawEnd) ? rawEnd : undefined;

  let finalLine: number | undefined = validLine;
  let finalStart: number | undefined = validStart;
  let finalEnd: number | undefined = validEnd;

  if (finalLine !== undefined && finalStart !== undefined && finalEnd !== undefined) {
    if (finalStart === finalEnd) {
      if (finalLine === finalStart) {
        finalStart = undefined;
        finalEnd = undefined;
      } else {
        invalid(
          "line cannot be combined with start_line or end_line.",
          "For one line, provide path and line. For a range, provide path, start_line, and end_line.",
          "line",
        );
      }
    } else {
      invalid(
        "line cannot be combined with start_line or end_line.",
        "For one line, provide path and line. For a range, provide path, start_line, and end_line.",
        "line",
      );
    }
  } else if (finalLine !== undefined && (finalStart !== undefined || finalEnd !== undefined)) {
    const other = finalStart !== undefined ? finalStart : finalEnd;
    if (finalLine === other) {
      finalStart = undefined;
      finalEnd = undefined;
    } else {
      invalid(
        "line cannot be combined with start_line or end_line.",
        "For one line, provide path and line. For a range, provide path, start_line, and end_line.",
        "line",
      );
    }
  } else if (finalStart !== undefined && finalEnd !== undefined && finalStart === finalEnd && finalLine === undefined) {
    finalLine = finalStart;
    finalStart = undefined;
    finalEnd = undefined;
  }

  if (finalLine !== undefined) params.line = finalLine;
  if (finalStart !== undefined) params.start_line = finalStart;
  else if (params.start_line !== undefined && finalLine !== undefined) delete params.start_line;
  if (finalEnd !== undefined) params.end_line = finalEnd;
  else if (params.end_line !== undefined && finalLine !== undefined) delete params.end_line;

  const isSingle = finalLine !== undefined;
  const isMulti = finalStart !== undefined && finalEnd !== undefined;

  if (!isSingle && !isMulti) {
    if (rawLine !== undefined && rawLine <= 0 && rawStart === undefined && rawEnd === undefined && params.path) {
      invalid("line must be a positive integer.", "Provide a line number greater than zero.", "line");
    }
    if (rawStart !== undefined && rawStart > 0 && (rawEnd === undefined || rawEnd <= 0)) {
      invalid(
        "start_line and end_line must be provided together.",
        "Provide both start_line and end_line for a range, or use line for a single-line comment.",
        "end_line",
      );
    }
    if (rawEnd !== undefined && rawEnd > 0 && (rawStart === undefined || rawStart <= 0)) {
      invalid(
        "start_line and end_line must be provided together.",
        "Provide both start_line and end_line for a range, or use line for a single-line comment.",
        "start_line",
      );
    }
  }

  const hasPath = params.path !== undefined && params.path !== null && typeof params.path === "string" && params.path.trim().length > 0;
  const hasRawPath = params.path !== undefined && params.path !== null;

  if ((isSingle || isMulti) && !hasPath) {
    invalid(
      "A non-empty path is required for an inline comment.",
      "Provide the changed file path together with line, or with start_line and end_line.",
      "path",
    );
  }
  if (hasRawPath && !isSingle && !isMulti) {
    invalid(
      "A path alone does not identify an inline comment position.",
      "Provide line for a single-line comment, or start_line and end_line for a range.",
      "line",
    );
  }
  if (isMulti && Number(finalStart) > Number(finalEnd)) {
    invalid(
      "start_line cannot be greater than end_line.",
      "Provide an ascending range where start_line is less than or equal to end_line.",
      "start_line",
    );
  }

  return { isSingleLine: isSingle && hasPath, isMultiLine: isMulti && hasPath };
};

export const gitlabCreateNoteTool: Tool = {
  name: "gitlab_create_note",
  description: "Add a comment/note to a merge request",
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
    body: {
      type: "string",
      description: "Comment text",
    },
    type: {
      type: "string",
      optional: true,
      description: "Note type: note (default), discussion (thread start)",
      default: "note",
    },
    line: {
      type: "number",
      optional: true,
      description:
        "Positive line number for a single-line comment. Requires path; cannot be combined with start_line or end_line.",
    },
    start_line: {
      type: "number",
      optional: true,
      description:
        "Positive first line of an inclusive range. Requires path and end_line; cannot be combined with line.",
    },
    end_line: {
      type: "number",
      optional: true,
      description:
        "Positive last line of an inclusive range. Requires path and start_line; must be greater than or equal to start_line.",
    },
    path: {
      type: "string",
      optional: true,
      description:
        "Changed file path in the merge request diff. Requires line, or both start_line and end_line.",
    },
    side: {
      type: "string",
      optional: true,
      description:
        "Diff side: right for new-file line numbers, left for old-file line numbers. Defaults to right.",
      default: "right",
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

    if (!resolveAllowWrite(config, "gitlab")) {
      throw new ToolError(
        "GITLAB_WRITE_DISABLED",
        "GitLab write operations are disabled.",
        "Ask the user to remove `providers.gitlab.security.allow_write: false` (or set it to true) in .devtools/config.yaml, then retry this tool.",
        true,
        { configKey: "providers.gitlab.security.allow_write" },
      );
    }

    const projectId = resolveProjectId(params, config);

    // GitLab has no environment concept, so blocked_env is matched against the
    // resolved project path or numeric ID instead.
    const blockedEnv = findBlockedEnvironment(config, "gitlab", String(projectId));
    if (blockedEnv) {
      throw new ToolError(
        "GITLAB_ENVIRONMENT_BLOCKED",
        `GitLab writes are blocked for project "${projectId}" — it matches the blocked_env entry "${blockedEnv}".`,
        "Choose a project that is not listed in providers.gitlab.security.blocked_env; do not retry against this project.",
        false,
        { configKey: "providers.gitlab.security.blocked_env" },
      );
    }

    const mrId = resolveMrId(params);
    const body = params.body || "";

    if (!body || body.trim() === "") {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A comment body is required.",
        "Provide non-empty comment text in body, then retry this tool.",
        true,
        { parameter: "body" },
      );
    }

    const { isMultiLine, isSingleLine } = validateInlinePosition(params);
    const client = getGitLabClient();

    try {
      let response;
      let discussionId: string | undefined;
      let inlinePosition: Record<string, any> | undefined;

      if (isMultiLine || isSingleLine) {
        // Get the latest commit SHA for this MR
        const mr = await client.MergeRequests.show(projectId, mrId);
        const sha = mr.sha || mr.diff_refs?.head_sha;
        const diffs = await client.MergeRequests.allDiffs(projectId, mrId);
        const changedFile = validateDiffPosition(
          params,
          diffs as MergeRequestDiff[],
        );

        if (!sha) {
          throw new Error("Could not determine commit SHA for code comment");
        }

        const baseSha = mr.diff_refs?.base_sha || sha;
        const headSha = mr.diff_refs?.head_sha || sha;
        const startSha = mr.diff_refs?.start_sha || sha;
        const isRight = params.side !== "left";
        const targetLine = isSingleLine ? Number(params.line) : Number(params.end_line);
        const newLine = isRight ? targetLine : undefined;
        const oldLine = !isRight ? targetLine : undefined;

        const position: any = {
          base_sha: baseSha,
          head_sha: headSha,
          start_sha: startSha,
          new_line: newLine,
          old_line: oldLine,
          position_type: "text",
          new_path: changedFile.new_path,
          old_path: changedFile.old_path,
        };

        if (isMultiLine) {
          const start = Number(params.start_line);
          const end = Number(params.end_line);
          const diffLines = getDiffLines(changedFile);
          const side = params.side === "left" ? "left" : "right";
          const filePath = side === "left" ? changedFile.old_path : changedFile.new_path;
          const lineCode = (n: number) =>
            createLineCode(filePath, side, n, diffLines);
          position.line_range = {
            start: {
              line_code: lineCode(start),
              new_line: side === "right" ? start : undefined,
              old_line: side === "left" ? start : undefined,
              type: side === "left" ? "old" : "new",
            },
            end: {
              line_code: lineCode(end),
              new_line: side === "right" ? end : undefined,
              old_line: side === "left" ? end : undefined,
              type: side === "left" ? "old" : "new",
            },
          };
        }

        const discussion = await client.MergeRequestDiscussions.create(
          projectId,
          mrId,
          body,
          { position },
        );
        const validated = validateInlineResponse(
          discussion as Record<string, any>,
          params,
          isMultiLine,
        );
        response = validated.note;
        inlinePosition = validated.position;
        discussionId = String(discussion.id);
      } else {
        // Regular comment
        response = await client.MergeRequestNotes.create(projectId, mrId, body);
      }

      const result = {
        id: response.id,
        mrId: mrId,
        body: response.body,
        author: response.author.username,
        createdAt: response.created_at,
        url: `${getGitLabWebUrl(config, projectId)}/-/merge_requests/${mrId}#note_${response.id}`,
        success: true,
        ...(discussionId && {
          discussionId,
          resolvable: true,
          position: inlinePosition,
        }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw formatGitLabError("create the merge request note", error);
    }
  },
};
