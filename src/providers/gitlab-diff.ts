/**
 * Reading GitLab `diff` strings.
 *
 * GitLab hands back a patch with hunk headers rather than numbered lines, so anything that
 * wants to talk about "line 428 of the new file" has to walk the patch and count — which is
 * how a caller ends up quoting a line that is not the one it meant. This turns that walk
 * into data. It also answers the two questions that follow from a patch: how many lines it
 * changed, and whether GitLab sent it at all.
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
 * Number every line of a patch, the way GitLab does.
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
 * Why GitLab withheld a file's patch from a compare- or MR-changes response. `too_large`
 * and `collapsed` are GitLab's own flags; `limit` is the un-flagged case where the patch
 * simply is not there.
 */
export type DiffOmissionReason = "too_large" | "collapsed" | "limit";

/** The parts of a GitLab diff entry that decide whether its patch is usable. */
export type GitLabDiffEntry = {
  diff?: string | null;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  a_mode?: string;
  b_mode?: string;
  too_large?: boolean;
  collapsed?: boolean;
};

/**
 * Added or removed lines in a patch.
 *
 * GitLab's diff endpoints carry the patch, not per-file counts, so the counts are taken
 * from the patch. Everything before the first hunk header is the `diff --git` / `---` /
 * `+++` preamble, which names files rather than changing them: counting it would add two
 * to every file.
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

/**
 * Why GitLab withheld a file's patch, or `null` when the patch is present and its line
 * counts can be trusted.
 *
 * Past its response budget GitLab stops shipping the patch: `too_large` and `collapsed`
 * say so with a flag, and a patch can also come back empty with no flag at all. Counting
 * that empty string reports 0, which is how a 492-line new file reads as "changed but
 * empty". `limit` names the un-flagged case — nothing here can tell it apart from a
 * binary file, but "counts unknown" is the honest answer for both.
 *
 * A created or deleted file has content by definition, so an empty patch for one is a
 * withheld patch, never a true 0. This is decided before the mode-only rule below: GitLab
 * reports a new file's `a_mode` (and a deleted file's `b_mode`) as `"000000"`, which is
 * not equal to the other side and would otherwise read as an ordinary mode-only change —
 * hiding the omission behind a false 0.
 *
 * A pure rename and a mode-only change on a file that still exists really do have nothing
 * to count, so their empty patch is left alone: 0 is the true answer, not a withheld one.
 */
export const diffOmissionReason = (
  file: GitLabDiffEntry,
): DiffOmissionReason | null => {
  if (file.too_large === true) return "too_large";
  if (file.collapsed === true) return "collapsed";
  if (file.diff) return null;
  if (file.new_file === true || file.deleted_file === true) return "limit";
  if (file.renamed_file === true) return null;
  if (file.a_mode && file.b_mode && file.a_mode !== file.b_mode) return null;
  return "limit";
};
