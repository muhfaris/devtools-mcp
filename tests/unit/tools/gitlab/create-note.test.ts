import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCreateNoteTool } from "../../../../src/tools/gitlab/create-note.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import { ToolError } from "../../../../src/core/errors.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_create_note", () => {
  it("uses custom host and per-call project_id for note URLs", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 555,
      body: "LGTM",
      author: { username: "tester" },
      created_at: "2026-09-09T00:00:00Z",
    });

    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.example.org",
        token: "token",
        projectId: 100,
      },
    };

    // Mock client
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequestNotes = { create: mockCreate };

    const res = await parseToolJson(gitlabCreateNoteTool, {
      project_id: 200,
      mr_id: 12,
      body: "LGTM",
    });

    expect(mockCreate).toHaveBeenCalledWith(200, 12, "LGTM");
    expect(res.url).toBe("https://gitlab.example.org/200/-/merge_requests/12#note_555");
  });

  it("throws INVALID_ARGUMENT when body is empty", async () => {
    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "token",
        projectId: 100,
      },
    };

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "   " }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      parameter: "body",
    });
  });

  it("rejects conflicting mr_id and mr_url before creating a note", async () => {
    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.example.com",
        token: "token",
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    const mockCreate = vi.fn();
    (client as any).MergeRequestNotes = { create: mockCreate };

    await expect(
      gitlabCreateNoteTool.execute({
        project_id: "group/project",
        mr_id: 123940,
        mr_url:
          "https://gitlab.example.com/group/project/-/merge_requests/1239",
        body: "Review comment",
      }),
    ).rejects.toMatchObject({
      code: "GITLAB_MR_ID_MISMATCH",
      parameter: "mr_id",
      retryable: false,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    [{ line: 10 }, "path"],
    [{ path: "src/app.ts" }, "line"],
    [{ path: "src/app.ts", line: 0 }, "line"],
    [{ path: "src/app.ts", start_line: 10 }, "end_line"],
    [{ path: "src/app.ts", end_line: 12 }, "start_line"],
    [{ path: "src/app.ts", line: 10, start_line: 10, end_line: 12 }, "line"],
    [{ path: "src/app.ts", start_line: 12, end_line: 10 }, "start_line"],
    [{ path: "src/app.ts", line: 10, side: "center" }, "side"],
  ])("rejects invalid inline arguments %o", async (inlineParams, parameter) => {
    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "token",
        projectId: 100,
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    const mockCreate = vi.fn();
    (client as any).MergeRequestNotes = { create: mockCreate };

    await expect(
      gitlabCreateNoteTool.execute({
        mr_id: 12,
        body: "Review comment",
        ...inlineParams,
      }),
    ).rejects.toMatchObject({
      code: "GITLAB_INLINE_POSITION_INVALID",
      parameter,
      retryable: false,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("posts a multi-line code comment when an omitted line is serialized as zero", async () => {
    const mockNoteCreate = vi.fn();
    const mockDiscussionCreate = vi.fn().mockImplementation(
      (_projectId, _mrId, body, options) => Promise.resolve({
        id: "discussion-777",
        notes: [{
          id: 777,
          body,
          author: { username: "tester" },
          created_at: "2026-09-09T00:00:00Z",
          resolvable: true,
          position: options.position,
        }],
      }),
    );

    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "token",
        projectId: 100,
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "abc123",
        diff_refs: {
          base_sha: "base",
          head_sha: "head",
          start_sha: "start",
        },
      }),
      allDiffs: vi.fn().mockResolvedValue([
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -8,9 +8,9 @@\n context\n-old\n+new\n context\n context\n context\n context\n context\n context\n context",
        },
      ]),
    };
    (client as any).MergeRequestNotes = { create: mockNoteCreate };
    (client as any).MergeRequestDiscussions = {
      create: mockDiscussionCreate,
    };

    const res = await parseToolJson(gitlabCreateNoteTool, {
      project_id: 200,
      mr_id: 12,
      body: "Multi-line review",
      path: "src/app.ts",
      line: 0,
      start_line: 10,
      end_line: 15,
      side: "right",
    });

    const [, , , options] = mockDiscussionCreate.mock.calls[0];
    expect(options.position.new_line).toBe(15);
    expect(options.position.line_range).toMatchObject({
      start: { new_line: 10, old_line: undefined, type: "new" },
      end: { new_line: 15, old_line: undefined, type: "new" },
    });
    expect(options.position.new_path).toBe("src/app.ts");
    expect(mockNoteCreate).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      id: 777,
      discussionId: "discussion-777",
      resolvable: true,
      position: { new_path: "src/app.ts" },
    });
    expect(res.url).toContain("#note_777");
  });

  it("posts a single-line code comment when start_line and end_line are serialized as zero", async () => {
    const mockDiscussionCreate = vi.fn().mockImplementation(
      (_projectId, _mrId, body, options) => Promise.resolve({
        id: "discussion-778",
        notes: [{
          id: 778,
          body,
          author: { username: "tester" },
          created_at: "2026-09-09T00:00:00Z",
          resolvable: true,
          position: options.position,
        }],
      }),
    );
    (global as any).__devtools_config = {
      gitlab: {
        url: "https://gitlab.com",
        token: "token",
        projectId: 100,
      },
    };

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "abc123",
        diff_refs: {
          base_sha: "base",
          head_sha: "head",
          start_sha: "start",
        },
      }),
      allDiffs: vi.fn().mockResolvedValue([
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -8,9 +8,9 @@\n context\n-old\n+new\n context\n context\n context\n context\n context\n context\n context",
        },
      ]),
    };
    (client as any).MergeRequestDiscussions = {
      create: mockDiscussionCreate,
    };

    const res = await parseToolJson(gitlabCreateNoteTool, {
      project_id: 200,
      mr_id: 12,
      body: "Single-line review with zero range",
      path: "src/app.ts",
      line: 9,
      start_line: 0,
      end_line: 0,
      side: "right",
    });

    const [, , , options] = mockDiscussionCreate.mock.calls[0];
    expect(options.position.new_line).toBe(9);
    expect(options.position.line_range).toBeUndefined();
    expect(res).toMatchObject({
      id: 778,
      discussionId: "discussion-778",
      resolvable: true,
    });
  });

  it.each([
    ["missing changed path", { path: "src/missing.ts", line: 10, side: "right" }, "path"],
    ["invalid right-side line", { path: "src/app.ts", line: 20, side: "right" }, "line"],
    ["invalid left-side line", { path: "src/app.ts", line: 10, side: "left" }, "line"],
    ["invalid range line", { path: "src/app.ts", start_line: 10, end_line: 12, side: "right" }, "end_line"],
  ])("rejects %s before creating a note", async (_name, inlineParams, parameter) => {
    (global as any).__devtools_config = {
      gitlab: { url: "https://gitlab.com", token: "token", projectId: 100 },
    };
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    const mockCreate = vi.fn();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "head",
        diff_refs: { base_sha: "base", head_sha: "head", start_sha: "start" },
      }),
      allDiffs: vi.fn().mockResolvedValue([
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -20,3 +8,3 @@\n context\n-old\n+new\n context",
        },
      ]),
    };
    (client as any).MergeRequestNotes = { create: mockCreate };

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review", ...inlineParams }),
    ).rejects.toMatchObject({
      code: "GITLAB_INLINE_POSITION_NOT_FOUND",
      parameter,
      retryable: false,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    [{ path: "src/app.ts", line: 8, side: "right" }],
    [{ path: "src/app.ts", line: 20, side: "left" }],
  ])("accepts a context line on either diff side", async (inlineParams) => {
    const mockCreate = vi.fn().mockImplementation(
      (_projectId, _mrId, body, options) => Promise.resolve({
        id: "discussion-778",
        notes: [{
          id: 778,
          body,
          author: { username: "tester" },
          created_at: "2026-09-09T00:00:00Z",
          resolvable: true,
          position: options.position,
        }],
      }),
    );
    (global as any).__devtools_config = {
      gitlab: { url: "https://gitlab.com", token: "token", projectId: 100 },
    };
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "head",
        diff_refs: { base_sha: "base", head_sha: "head", start_sha: "start" },
      }),
      allDiffs: vi.fn().mockResolvedValue([
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -20,3 +8,3 @@\n context\n-old\n+new\n context",
        },
      ]),
    };
    (client as any).MergeRequestDiscussions = { create: mockCreate };

    await parseToolJson(gitlabCreateNoteTool, {
      mr_id: 12,
      body: "Context review",
      ...inlineParams,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it.each([
    ["line === start_line === end_line (10, 10, 10)", { line: 10, start_line: 10, end_line: 10 }, 10, false],
    ["start_line === end_line without line (10, 10)", { start_line: 10, end_line: 10 }, 10, false],
    ["line with redundant single start_line (10, 10)", { line: 10, start_line: 10 }, 10, false],
    ["line with redundant single end_line (10, 10)", { line: 10, end_line: 10 }, 10, false],
  ])("accepts redundant position parameters: %s", async (_desc, params, expectedTargetLine, isRange) => {
    const mockCreate = vi.fn().mockImplementation(
      (_projectId, _mrId, body, options) => Promise.resolve({
        id: "discussion-888",
        notes: [{
          id: 888,
          body,
          author: { username: "tester" },
          created_at: "2026-09-09T00:00:00Z",
          resolvable: true,
          position: options.position,
        }],
      }),
    );
    (global as any).__devtools_config = {
      gitlab: { url: "https://gitlab.com", token: "token", projectId: 100 },
    };
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "head",
        diff_refs: { base_sha: "base", head_sha: "head", start_sha: "start" },
      }),
      allDiffs: vi.fn().mockResolvedValue([
        {
          old_path: "src/app.ts",
          new_path: "src/app.ts",
          diff: "@@ -8,9 +8,9 @@\n context\n-old\n+new\n context\n context\n context\n context\n context\n context\n context",
        },
      ]),
    };
    (client as any).MergeRequestDiscussions = { create: mockCreate };

    const res = await parseToolJson(gitlabCreateNoteTool, {
      mr_id: 12,
      body: "Test comment",
      path: "src/app.ts",
      side: "right",
      ...params,
    });

    const [, , , options] = mockCreate.mock.calls[0];
    expect(options.position.new_line).toBe(expectedTargetLine);
    if (isRange) {
      expect(options.position.line_range).toBeDefined();
    } else {
      expect(options.position.line_range).toBeUndefined();
    }
    expect(res).toMatchObject({
      id: 888,
      discussionId: "discussion-888",
      resolvable: true,
    });
  });

  it("rejects an inline response without position metadata", async () => {
    (global as any).__devtools_config = {
      gitlab: { url: "https://gitlab.com", token: "token", projectId: 100 },
    };
    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequests = {
      show: vi.fn().mockResolvedValue({
        sha: "head",
        diff_refs: { base_sha: "base", head_sha: "head", start_sha: "start" },
      }),
      allDiffs: vi.fn().mockResolvedValue([{
        old_path: "src/app.ts",
        new_path: "src/app.ts",
        diff: "@@ -20,3 +8,3 @@\n context\n-old\n+new\n context",
      }]),
    };
    (client as any).MergeRequestDiscussions = {
      create: vi.fn().mockResolvedValue({
        id: "discussion-779",
        notes: [{
          id: 779,
          body: "Review",
          author: { username: "tester" },
          created_at: "2026-09-09T00:00:00Z",
          resolvable: false,
        }],
      }),
    };

    await expect(gitlabCreateNoteTool.execute({
      mr_id: 12,
      body: "Review",
      path: "src/app.ts",
      line: 8,
      side: "right",
    })).rejects.toMatchObject({
      code: "GITLAB_INLINE_POSITION_MISSING",
      retryable: false,
    });
  });
});
