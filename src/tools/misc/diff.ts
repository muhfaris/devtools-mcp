import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../../core/types.js";

type DiffOp = {
  type: "equal" | "insert" | "delete";
  line: string;
  oldIndex?: number;
  newIndex?: number;
};

interface HunkLine {
  type: "context" | "insert" | "delete";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

/**
 * Compute the Longest Common Subsequence / Edit Script between two string arrays.
 */
function computeDiff(
  a: string[],
  b: string[],
  ignoreWhitespace: boolean = false,
): DiffOp[] {
  const normalize = (line: string) =>
    ignoreWhitespace ? line.trim().replace(/\s+/g, " ") : line;

  const n = a.length;
  const m = b.length;

  // DP table for LCS
  // Optimize: for memory/speed on reasonable file sizes
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (normalize(a[i]) === normalize(b[j])) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to build edit sequence
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && normalize(a[i - 1]) === normalize(b[j - 1])) {
      ops.push({
        type: "equal",
        line: a[i - 1],
        oldIndex: i,
        newIndex: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({
        type: "insert",
        line: b[j - 1],
        newIndex: j,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({
        type: "delete",
        line: a[i - 1],
        oldIndex: i,
      });
      i--;
    }
  }

  return ops.reverse();
}

/**
 * Group diff operations into hunks with context lines.
 */
function buildHunks(ops: DiffOp[], contextSize: number = 3): Hunk[] {
  const hunks: Hunk[] = [];
  const changeIndices: number[] = [];

  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type !== "equal") {
      changeIndices.push(idx);
    }
  }

  if (changeIndices.length === 0) {
    return [];
  }

  // Group changes that are within 2 * contextSize of each other
  const groups: Array<{ start: number; end: number }> = [];
  let currentGroup = {
    start: Math.max(0, changeIndices[0] - contextSize),
    end: Math.min(ops.length - 1, changeIndices[0] + contextSize),
  };

  for (let k = 1; k < changeIndices.length; k++) {
    const changeIdx = changeIndices[k];
    const groupStart = Math.max(0, changeIdx - contextSize);
    const groupEnd = Math.min(ops.length - 1, changeIdx + contextSize);

    if (groupStart <= currentGroup.end + 1) {
      currentGroup.end = Math.max(currentGroup.end, groupEnd);
    } else {
      groups.push(currentGroup);
      currentGroup = { start: groupStart, end: groupEnd };
    }
  }
  groups.push(currentGroup);

  for (const group of groups) {
    const hunkOps = ops.slice(group.start, group.end + 1);
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;

    const lines: HunkLine[] = [];

    for (const op of hunkOps) {
      if (op.type === "equal") {
        if (oldStart === 0 && op.oldIndex) oldStart = op.oldIndex;
        if (newStart === 0 && op.newIndex) newStart = op.newIndex;
        oldCount++;
        newCount++;
        lines.push({
          type: "context",
          content: op.line,
          oldLineNumber: op.oldIndex,
          newLineNumber: op.newIndex,
        });
      } else if (op.type === "delete") {
        if (oldStart === 0 && op.oldIndex) oldStart = op.oldIndex;
        oldCount++;
        lines.push({
          type: "delete",
          content: op.line,
          oldLineNumber: op.oldIndex,
        });
      } else if (op.type === "insert") {
        if (newStart === 0 && op.newIndex) newStart = op.newIndex;
        newCount++;
        lines.push({
          type: "insert",
          content: op.line,
          newLineNumber: op.newIndex,
        });
      }
    }

    if (oldStart === 0) oldStart = 1;
    if (newStart === 0) newStart = 1;

    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines,
    });
  }

  return hunks;
}

/**
 * Format hunks into standard unified diff format string.
 */
function formatUnifiedDiff(
  headerA: string,
  headerB: string,
  hunks: Hunk[],
): string {
  if (hunks.length === 0) {
    return `--- ${headerA}\n+++ ${headerB}\n(no differences)`;
  }

  const lines: string[] = [`--- ${headerA}`, `+++ ${headerB}`];

  for (const hunk of hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    );
    for (const line of hunk.lines) {
      if (line.type === "context") {
        lines.push(` ${line.content}`);
      } else if (line.type === "delete") {
        lines.push(`-${line.content}`);
      } else if (line.type === "insert") {
        lines.push(`+${line.content}`);
      }
    }
  }

  return lines.join("\n");
}

export const diffTool: Tool = {
  name: "diff",
  description:
    "Compare two text contents or files without git. Supports unified patch format, JSON AST/hunk format, or summary.",
  params: {
    file1: {
      type: "string",
      optional: true,
      description: "Path to the first (original) file",
    },
    file2: {
      type: "string",
      optional: true,
      description: "Path to the second (modified) file",
    },
    text1: {
      type: "string",
      optional: true,
      description: "First (original) raw text content (if not comparing files)",
    },
    text2: {
      type: "string",
      optional: true,
      description: "Second (modified) raw text content (if not comparing files)",
    },
    format: {
      type: "string",
      optional: true,
      description: 'Output format: "unified" (default), "json", or "summary"',
      default: "unified",
    },
    context: {
      type: "number",
      optional: true,
      description: "Number of context lines around differences (default: 3)",
      default: 3,
    },
    ignoreWhitespace: {
      type: "boolean",
      optional: true,
      description: "Ignore leading/trailing whitespace differences (default: false)",
      default: false,
    },
  },
  execute: async (params) => {
    let content1 = "";
    let content2 = "";
    let label1 = "a";
    let label2 = "b";

    if (params.file1) {
      try {
        const resolvedPath1 = path.resolve(params.file1);
        content1 = await fs.readFile(resolvedPath1, "utf-8");
        label1 = params.file1;
      } catch (err: any) {
        throw new Error(`Failed to read file1 (${params.file1}): ${err.message}`);
      }
    } else if (params.text1 !== undefined) {
      content1 = String(params.text1);
      label1 = "text1";
    } else {
      throw new Error("Either 'file1' or 'text1' must be provided as the original source.");
    }

    if (params.file2) {
      try {
        const resolvedPath2 = path.resolve(params.file2);
        content2 = await fs.readFile(resolvedPath2, "utf-8");
        label2 = params.file2;
      } catch (err: any) {
        throw new Error(`Failed to read file2 (${params.file2}): ${err.message}`);
      }
    } else if (params.text2 !== undefined) {
      content2 = String(params.text2);
      label2 = "text2";
    } else {
      throw new Error("Either 'file2' or 'text2' must be provided as the modified source.");
    }

    const lines1 = content1 === "" ? [] : content1.split(/\r?\n/);
    const lines2 = content2 === "" ? [] : content2.split(/\r?\n/);

    const contextSize = typeof params.context === "number" && params.context >= 0 ? params.context : 3;
    const ignoreWhitespace = Boolean(params.ignoreWhitespace);
    const format = params.format || "unified";

    const ops = computeDiff(lines1, lines2, ignoreWhitespace);
    const hunks = buildHunks(ops, contextSize);

    let additions = 0;
    let deletions = 0;
    for (const op of ops) {
      if (op.type === "insert") additions++;
      if (op.type === "delete") deletions++;
    }

    const isIdentical = additions === 0 && deletions === 0;

    if (format === "json") {
      const result = {
        identical: isIdentical,
        original: label1,
        modified: label2,
        stats: {
          additions,
          deletions,
          totalChanges: additions + deletions,
          originalLines: lines1.length,
          modifiedLines: lines2.length,
        },
        hunks,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (format === "summary") {
      const summary = {
        identical: isIdentical,
        original: label1,
        modified: label2,
        additions,
        deletions,
        totalChanges: additions + deletions,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }

    // Default: unified diff format
    const unifiedDiffText = formatUnifiedDiff(label1, label2, hunks);
    return {
      content: [{ type: "text", text: unifiedDiffText }],
    };
  },
};
