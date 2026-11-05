/**
 * Reading unified-diff patch strings.
 *
 * Both GitLab and GitHub hand back a patch with hunk headers rather than numbered lines,
 * so anything that wants to talk about "line 428 of the new file" has to walk the patch
 * and count — which is how a caller ends up quoting a line that is not the one it meant.
 * This turns that walk into data. It also answers the question that follows from a patch:
 * how many lines it changed.
 */

export type DiffLineType = "added" | "removed" | "unchanged";

export type DiffLine = {
  /** Line number in the old file, or `null` when the line does not exist there. */
  old_line: number | null;
  /** Line number in the new file, or `null` when the line does not exist there. */
  new_line: number | null;
  type: DiffLineType;
  /** The line's content, without its leading `+`, `-` or space marker. */
  text: string;
};

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` — the counts are optional. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Number every line of a patch.
 *
 * Hunk headers are consumed to seed the numbering and are not emitted: they are not lines
 * of either file, so giving them an entry would invent lines that cannot be commented on.
 * That means the result is a line index, not a rendering of the patch — pair it with the
 * raw `diff` when the patch itself is what matters.
 */
export const parseDiffLines = (diff: string): DiffLine[] => {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const row of diff.split("\n")) {
    const header = row.match(HUNK_HEADER);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }

    // Text before the first hunk (a `diff --git` preamble, say) carries no numbering.
    if (!inHunk) continue;

    // "\ No newline at end of file" annotates the previous line and numbers nothing.
    if (row.startsWith("\\")) continue;

    if (row.startsWith("+")) {
      lines.push({
        old_line: null,
        new_line: newLine++,
        type: "added",
        text: row.slice(1),
      });
    } else if (row.startsWith("-")) {
      lines.push({
        old_line: oldLine++,
        new_line: null,
        type: "removed",
        text: row.slice(1),
      });
    } else if (row.startsWith(" ")) {
      lines.push({
        old_line: oldLine,
        new_line: newLine,
        type: "unchanged",
        text: row.slice(1),
      });
      oldLine++;
      newLine++;
    }
  }

  return lines;
};

/**
 * Added or removed lines in a patch.
 *
 * Everything before the first hunk header is the `diff --git` / `---` / `+++` preamble,
 * which names files rather than changing them: counting it would add two to every file.
 */
export const countChangedLines = (
  patch: string | null | undefined,
  marker: "+" | "-",
): number => {
  if (!patch) return 0;
  const lines = patch.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  if (firstHunk === -1) return 0;
  return lines.slice(firstHunk + 1).filter((line) => line.startsWith(marker))
    .length;
};
