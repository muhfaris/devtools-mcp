/**
 * Deciding whether a GitLab patch is usable.
 *
 * The line parsing and counting helpers are shared with GitHub and live in `diff.ts`;
 * this file holds only what is GitLab's own: the flags it uses to say that it withheld a
 * patch, and the rule for reading them.
 */

export type {
  DiffLine,
  DiffLineType,
} from "./diff.js";

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
