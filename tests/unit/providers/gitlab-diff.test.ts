import { describe, expect, it } from "vitest";
import { parseDiffLines } from "../../../src/providers/diff.js";

describe("parseDiffLines", () => {
  it("numbers added, removed, and unchanged lines on both sides", () => {
    const diff = ["@@ -8,3 +8,4 @@", " context", "-old", "+new", "+extra"].join(
      "\n",
    );

    expect(parseDiffLines(diff)).toEqual([
      { old_line: 8, new_line: 8, type: "unchanged", text: "context" },
      { old_line: 9, new_line: null, type: "removed", text: "old" },
      { old_line: null, new_line: 9, type: "added", text: "new" },
      { old_line: null, new_line: 10, type: "added", text: "extra" },
    ]);
  });

  it("restarts numbering at each hunk header", () => {
    const diff = [
      "@@ -1,2 +1,2 @@",
      " a",
      " b",
      "@@ -40,1 +41,1 @@",
      "-c",
      "+d",
    ].join("\n");

    expect(parseDiffLines(diff)).toEqual([
      { old_line: 1, new_line: 1, type: "unchanged", text: "a" },
      { old_line: 2, new_line: 2, type: "unchanged", text: "b" },
      { old_line: 40, new_line: null, type: "removed", text: "c" },
      { old_line: null, new_line: 41, type: "added", text: "d" },
    ]);
  });

  it("keeps numbering aligned once an insertion shifts the two sides apart", () => {
    // The shape that makes a hand-counted range wrong: after the insertions, the same
    // unchanged line is 522 in the old file and 523 in the new one.
    const diff = [
      "@@ -520,5 +520,8 @@",
      " context",
      "-removed",
      "+added one",
      "+added two",
      " context",
      " tail",
    ].join("\n");

    expect(parseDiffLines(diff).filter((line) => line.type === "unchanged")).toEqual([
      { old_line: 520, new_line: 520, type: "unchanged", text: "context" },
      { old_line: 522, new_line: 523, type: "unchanged", text: "context" },
      { old_line: 523, new_line: 524, type: "unchanged", text: "tail" },
    ]);
  });

  it("drops the no-newline marker and anything before the first hunk", () => {
    const diff = [
      "diff --git a/app.ts b/app.ts",
      "index 111..222 100644",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      "\\ No newline at end of file",
    ].join("\n");

    expect(parseDiffLines(diff)).toEqual([
      { old_line: 1, new_line: null, type: "removed", text: "a" },
      { old_line: null, new_line: 1, type: "added", text: "b" },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseDiffLines("")).toEqual([]);
  });
});
