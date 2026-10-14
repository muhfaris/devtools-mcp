import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabReviewMrTool } from "../../../../src/tools/gitlab/review-mr.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

const mockMr = {
  iid: 42,
  title: "Harden the importer",
  state: "opened",
  author: { username: "dev" },
  web_url: "https://gitlab.example/g/p/-/merge_requests/42",
};

const useChanges = async (changes: any[]) => {
  (global as any).__devtools_config = {
    providers: {
      gitlab: {
        url: "https://gitlab.example",
        token: "token",
        projectId: "g/p",
      },
    },
  };
  const gitlabMod = await import("../../../../src/providers/gitlab.js");
  gitlabMod.initGitLab((global as any).__devtools_config);
  const client = gitlabMod.getGitLabClient();
  (client as any).MergeRequests = {
    show: vi.fn().mockResolvedValue(mockMr),
    showChanges: vi.fn().mockResolvedValue({ changes }),
  };
};

describe("gitlab_review_mr", () => {
  it("lists files whose patch GitLab withheld and never calls them clean", async () => {
    await useChanges([
      {
        old_path: "src/big.ts",
        new_path: "src/big.ts",
        new_file: true,
        too_large: true,
        // GitLab withholds the patch for a file past its size limit.
        diff: "",
      },
      {
        old_path: "src/small.ts",
        new_path: "src/small.ts",
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    const res = await parseToolJson(gitlabReviewMrTool, { mr_id: 42 });

    // The withheld file is marked, not analyzed as an empty (i.e. clean) diff: no
    // counts, no complexity verdict, no suggestions, never "reviewed".
    expect(res.files[0]).toMatchObject({
      file: "src/big.ts",
      additions: null,
      deletions: null,
      reviewed: false,
      diffOmitted: "too_large",
      complexity: null,
      suggestions: [],
    });
    // A patch that came back is reviewed, with counts taken from the patch.
    expect(res.files[1]).toMatchObject({
      file: "src/small.ts",
      additions: 1,
      deletions: 1,
      reviewed: true,
      diffOmitted: null,
    });

    expect(res.filesReviewed).toBe(1);
    expect(res.filesNotReviewed).toEqual([
      { file: "src/big.ts", diffOmitted: "too_large" },
    ]);

    // The summary names the unreviewed file so the agent can fetch and review it, and it
    // is kept out of the reviewed count.
    expect(res.summary).toContain(
      "1 of 2 files were not reviewed: diff omitted by GitLab (too_large)",
    );
    expect(res.summary).toContain("`src/big.ts` (too_large)");
    expect(res.summary).toContain("must not be reported as clean");
    expect(res.summary).toContain("**Files reviewed:** 1 of 2");
  });

  it("keeps omitted files out of the change totals", async () => {
    await useChanges([
      {
        old_path: "src/big.ts",
        new_path: "src/big.ts",
        collapsed: true,
        diff: "",
      },
      {
        old_path: "src/small.ts",
        new_path: "src/small.ts",
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    const res = await parseToolJson(gitlabReviewMrTool, { mr_id: 42 });

    // Only the reviewed file's +1/-1 is counted; the withheld file adds nothing (and is
    // not a zero either — it is simply not a reviewed file).
    expect(res.summary).toContain("- **Additions:** +1");
    expect(res.summary).toContain("- **Deletions:** -1");
    expect(res.summary).toContain("(collapsed)");
  });

  it("says nothing about omissions when every patch came back", async () => {
    await useChanges([
      {
        old_path: "src/a.ts",
        new_path: "src/a.ts",
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    const res = await parseToolJson(gitlabReviewMrTool, { mr_id: 42 });

    expect(res.filesReviewed).toBe(1);
    expect(res.filesNotReviewed).toEqual([]);
    expect(res.summary).not.toContain("Not Reviewed");
    expect(res.summary).toContain("**Files reviewed:** 1 of 1");
  });

  it("flags a new file whose patch is missing even without a flag", async () => {
    await useChanges([
      {
        old_path: "service/tag_status_mapping/service.go",
        new_path: "service/tag_status_mapping/service.go",
        new_file: true,
        // GitLab's new-file marker, which must not read as a mode-only change.
        a_mode: "000000",
        b_mode: "100644",
        diff: "",
      },
    ]);

    const res = await parseToolJson(gitlabReviewMrTool, { mr_id: 42 });

    expect(res.files[0]).toMatchObject({
      reviewed: false,
      additions: null,
      diffOmitted: "limit",
    });
    expect(res.filesNotReviewed).toEqual([
      {
        file: "service/tag_status_mapping/service.go",
        diffOmitted: "limit",
      },
    ]);
    expect(res.summary).toContain("1 of 1 files were not reviewed");
  });
});
