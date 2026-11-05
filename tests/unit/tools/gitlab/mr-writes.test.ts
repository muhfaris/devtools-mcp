import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCreateMrTool } from "../../../../src/tools/gitlab/create-mr.js";
import { gitlabUpdateMrTool } from "../../../../src/tools/gitlab/update-mr.js";
import { getGitLabClient, initGitLab } from "../../../../src/providers/gitlab.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

const gitlabProvider = (gitlab: Record<string, unknown>) => ({
  providers: { gitlab: { url: "https://gitlab.com", token: "token", ...gitlab } },
});

const granted = { projectId: 100, security: { allow_write: true } };

const existingMr = {
  iid: 12,
  title: "old title",
  description: "old description",
  state: "opened",
  merge_status: "can_be_merged",
  source_branch: "fix/thing",
  target_branch: "main",
  web_url: "https://gitlab.com/group/repo/-/merge_requests/12",
};

const stubMergeRequests = async () => {
  const mockCreate = vi.fn().mockResolvedValue({
    ...existingMr,
    iid: 77,
    title: "new mr",
    draft: false,
    author: { username: "tester" },
    web_url: "https://gitlab.com/group/repo/-/merge_requests/77",
  });
  const mockShow = vi.fn().mockResolvedValue(existingMr);
  const mockEdit = vi.fn().mockImplementation(async (_p, _id, edit) => ({
    ...existingMr,
    title: edit.title ?? existingMr.title,
    description: edit.description ?? existingMr.description,
    target_branch: edit.targetBranch ?? existingMr.target_branch,
  }));

  initGitLab((global as any).__devtools_config);
  (getGitLabClient() as any).MergeRequests = {
    create: mockCreate,
    show: mockShow,
    edit: mockEdit,
  };

  return { mockCreate, mockShow, mockEdit };
};

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_create_mr", () => {
  it("opens the merge request and reports where to find it", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockCreate } = await stubMergeRequests();

    const res = await parseToolJson(gitlabCreateMrTool, {
      source_branch: "fix/thing",
      target_branch: "release/1",
      title: "new mr",
      description: "why",
    });

    expect(mockCreate).toHaveBeenCalledWith(100, "fix/thing", "release/1", "new mr", {
      description: "why",
      removeSourceBranch: false,
    });
    expect(res).toMatchObject({
      iid: 77,
      webUrl: "https://gitlab.com/group/repo/-/merge_requests/77",
      success: true,
    });
  });

  it("leaves the description out when none is given", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockCreate } = await stubMergeRequests();

    await gitlabCreateMrTool.execute({
      source_branch: "fix/thing",
      target_branch: "main",
      title: "t",
    });

    expect(mockCreate.mock.calls[0][4]).toEqual({ removeSourceBranch: false });
  });

  it("denies writes when nothing grants them", async () => {
    (global as any).__devtools_config = gitlabProvider({ projectId: 100 });

    await expect(
      gitlabCreateMrTool.execute({
        source_branch: "a",
        target_branch: "b",
        title: "t",
      }),
    ).rejects.toMatchObject({
      code: "GITLAB_WRITE_DISABLED",
      configKey: "providers.gitlab.security.allow_write",
    });
  });

  it("blocks a project matching a blocked_env entry", async () => {
    (global as any).__devtools_config = gitlabProvider({
      projectId: "group/production-app",
      security: { allow_write: true, blocked_env: ["production"] },
    });

    await expect(
      gitlabCreateMrTool.execute({
        source_branch: "a",
        target_branch: "b",
        title: "t",
      }),
    ).rejects.toMatchObject({ code: "GITLAB_ENVIRONMENT_BLOCKED" });
  });

  it("rejects a blank required argument and an identical source and target", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockCreate } = await stubMergeRequests();

    await expect(
      gitlabCreateMrTool.execute({ source_branch: "a", target_branch: "b", title: "  " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "title" });
    await expect(
      gitlabCreateMrTool.execute({ source_branch: "a", target_branch: "a", title: "t" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "target_branch" });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("gitlab_update_mr", () => {
  it("retargets without touching the title or description", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockEdit } = await stubMergeRequests();

    const res = await parseToolJson(gitlabUpdateMrTool, {
      mr_id: 12,
      target_branch: "release/1",
    });

    expect(mockEdit).toHaveBeenCalledWith(100, 12, { targetBranch: "release/1" });
    expect(res.changed).toEqual({
      targetBranch: { from: "main", to: "release/1" },
    });
    expect(res.success).toBe(true);
  });

  it("clears the description when an empty one is passed", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockEdit } = await stubMergeRequests();

    await gitlabUpdateMrTool.execute({ mr_id: 12, description: "" });

    expect(mockEdit).toHaveBeenCalledWith(100, 12, { description: "" });
  });

  it("reads the MR id from mr_url", async () => {
    (global as any).__devtools_config = gitlabProvider({ security: { allow_write: true } });
    const { mockEdit } = await stubMergeRequests();

    await gitlabUpdateMrTool.execute({
      mr_url: "https://gitlab.com/group/repo/-/merge_requests/12",
      title: "renamed",
    });

    expect(mockEdit).toHaveBeenCalledWith("group/repo", 12, { title: "renamed" });
  });

  it("refuses a call that changes nothing, and an empty title or target", async () => {
    (global as any).__devtools_config = gitlabProvider(granted);
    const { mockEdit } = await stubMergeRequests();

    await expect(gitlabUpdateMrTool.execute({ mr_id: 12 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      gitlabUpdateMrTool.execute({ mr_id: 12, title: " " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "title" });
    await expect(
      gitlabUpdateMrTool.execute({ mr_id: 12, target_branch: "" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "target_branch" });
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("denies writes when nothing grants them", async () => {
    (global as any).__devtools_config = gitlabProvider({ projectId: 100 });

    await expect(
      gitlabUpdateMrTool.execute({ mr_id: 12, title: "t" }),
    ).rejects.toMatchObject({ code: "GITLAB_WRITE_DISABLED" });
  });
});
