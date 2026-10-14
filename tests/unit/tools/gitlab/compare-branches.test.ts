import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCompareBranchesTool } from "../../../../src/tools/gitlab/compare-branches.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_compare_branches", () => {
  const mockComparison = {
    commits: [
      {
        id: "c1",
        short_id: "c1s",
        title: "feat: change A",
        message: "feat: change A\n\nWhy: because B",
        author_name: "Dev",
        authored_date: "2026-09-09T00:00:00Z",
      },
    ],
    diffs: [
      {
        new_path: "src/service.go",
        old_path: "src/service.go",
        new_file: false,
        deleted_file: false,
        renamed_file: false,
        diff: [
          "diff --git a/src/service.go b/src/service.go",
          "index 111..222 100644",
          "--- a/src/service.go",
          "+++ b/src/service.go",
          "@@ -1,3 +1,4 @@",
          " package service",
          "-// old comment",
          "+// new comment",
          "+func Added() {}",
          " return nil",
        ].join("\n"),
      },
    ],
  };

  const useProject = () => {
    (global as any).__devtools_config = {
      providers: {
        gitlab: {
          url: "https://gitlab.example.com",
          token: "token",
          projectId: "group/project",
        },
      },
    };
  };

  const client = async () => {
    useProject();
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).Repositories = {
      compare: vi.fn().mockResolvedValue(mockComparison),
    };
    // Conflict detection (default on) reads the merge_status of an existing MR for the
    // pair; by default there is none, so the answer is "unknown".
    (client as any).MergeRequests = { all: vi.fn().mockResolvedValue([]) };
    return client as any;
  };

  it("answers with the commits and a per-file change list, and no patch text", async () => {
    const gitlab = await client();

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
    });

    expect(gitlab.Repositories.compare).toHaveBeenCalledWith(
      "group/project",
      "main",
      "feat/my-branch",
      { straight: false },
    );
    expect(res.commitsCount).toBe(1);
    expect(res.filesCount).toBe(1);
    expect(res.diffIncluded).toBe(false);
    expect(res.diffs).toBeUndefined();
    // Counted from the patch, without the `---`/`+++` preamble inflating the totals.
    expect(res.files[0]).toMatchObject({
      file: "src/service.go",
      additions: 2,
      deletions: 1,
      // The patch came back, so the counts are real and no omission is recorded.
      diffOmitted: null,
    });
    expect(res.diffOmittedCount).toBe(0);
    expect(res.statsComplete).toBe(true);
    // The finding this replaces: the patches were part of the response whether or not
    // anyone wanted them, so a large comparison was some 200k characters of context.
    expect(JSON.stringify(res)).not.toContain("package service");
  });

  it("marks a patch GitLab withheld instead of reporting a false 0", async () => {
    const gitlab = await client();
    gitlab.Repositories.compare.mockResolvedValue({
      commits: [],
      diffs: [
        {
          new_path: "src/big.go",
          old_path: "src/big.go",
          new_file: true,
          deleted_file: false,
          renamed_file: false,
          too_large: true,
          // GitLab drops the patch text for a file past its size limit.
          diff: "",
        },
        {
          new_path: "src/image.png",
          old_path: "src/image.png",
          diff: "",
        },
        {
          new_path: "src/small.go",
          old_path: "src/small.go",
          diff: ["@@ -1 +1 @@", "-old", "+new"].join("\n"),
        },
      ],
    });

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
    });

    // The reported bug: a +492 new file whose patch was dropped read as 0/0, i.e.
    // "changed but nothing in it". The counts are unknown, so they are null and the
    // reason is named.
    expect(res.files[0]).toMatchObject({
      file: "src/big.go",
      additions: null,
      deletions: null,
      patchChars: null,
      diffOmitted: "too_large",
    });
    expect(res.files[1]).toMatchObject({
      file: "src/image.png",
      additions: null,
      diffOmitted: "limit",
    });
    // A patch that did come back carries its real counts and a null reason.
    expect(res.files[2]).toMatchObject({
      file: "src/small.go",
      additions: 1,
      deletions: 1,
      diffOmitted: null,
    });
    // The list is short by two files, and says so rather than letting a sum pass.
    expect(res.diffOmittedCount).toBe(2);
    expect(res.statsComplete).toBe(false);
  });

  it("keeps 0 for a pure rename, whose empty patch is the truth", async () => {
    const gitlab = await client();
    gitlab.Repositories.compare.mockResolvedValue({
      commits: [],
      diffs: [
        {
          new_path: "src/new.go",
          old_path: "src/old.go",
          new_file: false,
          deleted_file: false,
          renamed_file: true,
          diff: "",
        },
      ],
    });

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
    });

    // Nothing was withheld here: a rename with no content change has no lines to count,
    // so flagging it would be the opposite mistake.
    expect(res.files[0]).toMatchObject({
      additions: 0,
      deletions: 0,
      patchChars: 0,
      diffOmitted: null,
    });
    expect(res.diffOmittedCount).toBe(0);
    expect(res.statsComplete).toBe(true);
  });

  it("flags a new or deleted file whose patch is missing, but not a mode-only change", async () => {
    const gitlab = await client();
    gitlab.Repositories.compare.mockResolvedValue({
      commits: [],
      diffs: [
        {
          // The reported bug: GitLab gives a new file `a_mode: "000000"`, which used to
          // be mistaken for a mode-only change, so the empty patch passed as a true 0/0.
          new_path: "service/tag_status_mapping/service.go",
          old_path: "service/tag_status_mapping/service.go",
          new_file: true,
          deleted_file: false,
          renamed_file: false,
          a_mode: "000000",
          b_mode: "100644",
          diff: "",
        },
        {
          // A deleted file is the mirror image: `b_mode: "000000"`.
          new_path: "src/removed.go",
          old_path: "src/removed.go",
          new_file: false,
          deleted_file: true,
          renamed_file: false,
          a_mode: "100644",
          b_mode: "000000",
          diff: "",
        },
        {
          // A real mode-only change has nothing to count, so 0 stays correct.
          new_path: "scripts/run.sh",
          old_path: "scripts/run.sh",
          new_file: false,
          deleted_file: false,
          renamed_file: false,
          a_mode: "100644",
          b_mode: "100755",
          diff: "",
        },
        {
          // As does a pure rename on a file that still exists.
          new_path: "src/new.go",
          old_path: "src/old.go",
          new_file: false,
          deleted_file: false,
          renamed_file: true,
          diff: "",
        },
      ],
    });

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
    });

    expect(res.files[0]).toMatchObject({
      file: "service/tag_status_mapping/service.go",
      newFile: true,
      additions: null,
      deletions: null,
      diffOmitted: "limit",
    });
    expect(res.files[1]).toMatchObject({
      file: "src/removed.go",
      deletedFile: true,
      additions: null,
      diffOmitted: "limit",
    });
    // Nothing was withheld for these two: their empty patch is the truth.
    expect(res.files[2]).toMatchObject({
      file: "scripts/run.sh",
      additions: 0,
      diffOmitted: null,
    });
    expect(res.files[3]).toMatchObject({
      file: "src/new.go",
      additions: 0,
      diffOmitted: null,
    });
    expect(res.diffOmittedCount).toBe(2);
    expect(res.statsComplete).toBe(false);
  });

  it("leaves out each commit's message unless it is asked for", async () => {
    await client();

    const trimmed = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
    });
    const withMessages = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
      include_messages: true,
    });

    // The subject line is always there; the body is the part nobody triaging reads.
    expect(trimmed.commits[0].title).toBe("feat: change A");
    expect(trimmed.commits[0].message).toBeUndefined();
    expect(withMessages.commits[0].message).toContain("Why: because B");
  });

  it("inlines a patch only when asked, trimmed unless full_diff is set", async () => {
    await client();

    const trimmed = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
      include_diff: true,
    });
    const full = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
      include_diff: true,
      full_diff: true,
    });

    expect(trimmed.diffIncluded).toBe(true);
    expect(trimmed.diffs).toHaveLength(1);
    expect(trimmed.diffs[0].diff).toContain("@@ -1,3 +1,4 @@");
    expect(trimmed.diffs[0].truncated).toBe(false);
    expect(trimmed.diffs[0].diffOmitted).toBeNull();
    expect(full.diffs[0].diff).toContain(" return nil");
  });

  it("caps how many patches are inlined, and says how many it left out", async () => {
    const gitlab = await client();
    const patch = ["@@ -1 +1 @@", "-old", "+new"].join("\n");
    gitlab.Repositories.compare.mockResolvedValue({
      commits: [],
      diffs: Array.from({ length: 4 }, (_, index) => ({
        new_path: `src/file-${index}.ts`,
        old_path: `src/file-${index}.ts`,
        diff: patch,
      })),
    });

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/my-branch",
      include_diff: true,
      max_files: 2,
    });

    expect(res.diffs).toHaveLength(2);
    expect(res.diffsOmitted).toBe(2);
    // The list is what answers "what changed": it is never the thing that gets capped.
    expect(res.files).toHaveLength(4);
  });

  it("reports conflicts from an existing MR's merge_status when the branches conflict", async () => {
    const gitlab = await client();
    gitlab.MergeRequests.all.mockResolvedValue([
      {
        iid: 7,
        title: "Manticore search list",
        web_url: "https://git.example/g/p/-/merge_requests/7",
        merge_status: "cannot_be_merged",
      },
    ]);

    const res = await parseToolJson(gitlabCompareBranchesTool, {
      from: "staging",
      to: "feat/manticore-search-list",
    });

    expect(gitlab.MergeRequests.all).toHaveBeenCalledWith({
      projectId: "group/project",
      sourceBranch: "feat/manticore-search-list",
      targetBranch: "staging",
    });
    expect(res.mergeStatus).toBe("conflicts");
    expect(res.mergeStatusSource).toBe("existing_merge_request");
    expect(res.mr).toMatchObject({ iid: 7, title: "Manticore search list" });
  });

  it("marks a clean pair from an existing MR, and reads no conflicts as unknown", async () => {
    const gitlab = await client();

    gitlab.MergeRequests.all.mockResolvedValue([
      { iid: 8, title: "clean", web_url: "u", merge_status: "can_be_merged" },
    ]);
    const clean = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/ok",
    });
    expect(clean.mergeStatus).toBe("no_conflicts");

    // Which is the honest answer: GitLab's compare endpoint says nothing about
    // conflicts, so with no MR to read there is nothing to assert.
    gitlab.MergeRequests.all.mockResolvedValue([]);
    const noMr = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/no-mr",
    });
    expect(noMr.mergeStatus).toBe("unknown");
    expect(noMr.mergeStatusSource).toBe("not_available");
  });

  it("answers unknown when the MR status call fails, and skips the call when asked", async () => {
    const gitlab = await client();

    gitlab.MergeRequests.all.mockRejectedValue(new Error("boom"));
    const failed = await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/x",
    });
    expect(failed.mergeStatus).toBe("unknown");
    expect(failed.mergeStatusSource).toBe("not_available");

    gitlab.MergeRequests.all.mockClear();
    await parseToolJson(gitlabCompareBranchesTool, {
      from: "main",
      to: "feat/x",
      detect_conflicts: false,
    });
    expect(gitlab.MergeRequests.all).not.toHaveBeenCalled();
  });
});
