import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCreateNoteTool } from "../../../../src/tools/gitlab/create-note.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

const gitlabProvider = (gitlab: Record<string, unknown>) => ({
  providers: { gitlab: { url: "https://gitlab.com", token: "token", ...gitlab } },
});

const stubCreateNote = async () => {
  const mockCreate = vi.fn().mockResolvedValue({
    id: 901,
    body: "LGTM",
    author: { username: "tester" },
    created_at: "2026-09-09T00:00:00Z",
  });

  const gitlabMod = await import("../../../../src/providers/gitlab.js");
  gitlabMod.initGitLab((global as any).__devtools_config);
  const client = gitlabMod.getGitLabClient();
  (client as any).MergeRequestNotes = { create: mockCreate };
  return mockCreate;
};

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_create_note security", () => {
  it("denies writes when nothing grants them", async () => {
    (global as any).__devtools_config = gitlabProvider({ projectId: 100 });

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({
      code: "GITLAB_WRITE_DISABLED",
      configKey: "providers.gitlab.security.allow_write",
      retryable: true,
    });
  });

  it("grants writes from the provider-scoped block", async () => {
    (global as any).__devtools_config = gitlabProvider({
      projectId: 100,
      security: { allow_write: true },
    });

    const mockCreate = await stubCreateNote();
    await parseToolJson(gitlabCreateNoteTool, { mr_id: 12, body: "LGTM" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("grants writes from the shared block", async () => {
    (global as any).__devtools_config = {
      security: { allow_write: true },
      ...gitlabProvider({ projectId: 100 }),
    };

    const mockCreate = await stubCreateNote();
    await parseToolJson(gitlabCreateNoteTool, { mr_id: 12, body: "LGTM" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("lets the provider-scoped block deny while the shared block grants", async () => {
    (global as any).__devtools_config = {
      security: { allow_write: true },
      ...gitlabProvider({ projectId: 100, security: { allow_write: false } }),
    };

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({ code: "GITLAB_WRITE_DISABLED" });
  });

  it("blocks projects matching a configured blocked_env entry", async () => {
    (global as any).__devtools_config = gitlabProvider({
      projectId: "group/production-app",
      security: { allow_write: true, blocked_env: ["production"] },
    });

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({
      code: "GITLAB_ENVIRONMENT_BLOCKED",
      configKey: "providers.gitlab.security.blocked_env",
      retryable: false,
    });
  });

  it("inherits the shared blocked_env list", async () => {
    (global as any).__devtools_config = {
      security: { allow_write: true, blocked_env: ["production"] },
      ...gitlabProvider({ projectId: "group/production-app" }),
    };

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({ code: "GITLAB_ENVIRONMENT_BLOCKED" });
  });

  it("blocks a project path matching the built-in default list", async () => {
    (global as any).__devtools_config = gitlabProvider({
      projectId: "group/product-catalog",
      security: { allow_write: true },
    });

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({ code: "GITLAB_ENVIRONMENT_BLOCKED" });
  });

  it("permits a project path that matches nothing", async () => {
    (global as any).__devtools_config = gitlabProvider({
      projectId: "group/billing",
      security: { allow_write: true },
    });

    const mockCreate = await stubCreateNote();
    const res = await parseToolJson(gitlabCreateNoteTool, { mr_id: 12, body: "LGTM" });
    expect(mockCreate).toHaveBeenCalledWith("group/billing", 12, "LGTM");
    expect(res.success).toBe(true);
  });
});
