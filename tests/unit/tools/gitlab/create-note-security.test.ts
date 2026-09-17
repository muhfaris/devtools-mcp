import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabCreateNoteTool } from "../../../../src/tools/gitlab/create-note.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

const originalConfig = (global as any).__devtools_config;

const gitlabConfig = (gitlab: Record<string, unknown>) => ({
  providers: {
    gitlab: {
      url: "https://gitlab.com",
      token: "token",
      ...gitlab,
    },
  },
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("gitlab_create_note security", () => {
  it("blocks writes when providers.gitlab.security.allow_write is false", async () => {
    (global as any).__devtools_config = gitlabConfig({
      projectId: 100,
      security: { allow_write: false },
    });

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({
      code: "GITLAB_WRITE_DISABLED",
      configKey: "providers.gitlab.security.allow_write",
      retryable: true,
    });
  });

  it("blocks projects matching a configured blocked_env entry", async () => {
    (global as any).__devtools_config = gitlabConfig({
      projectId: "group/production-app",
      security: { blocked_env: ["production"] },
    });

    await expect(
      gitlabCreateNoteTool.execute({ mr_id: 12, body: "Review" }),
    ).rejects.toMatchObject({
      code: "GITLAB_ENVIRONMENT_BLOCKED",
      configKey: "providers.gitlab.security.blocked_env",
      retryable: false,
    });
  });

  it.each(["prod", "production"])(
    "does not inherit the legacy default blocked list (project containing %s)",
    async (term) => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: 900,
        body: "Review",
        author: { username: "tester" },
        created_at: "2026-09-09T00:00:00Z",
      });

      (global as any).__devtools_config = gitlabConfig({
        projectId: `group/${term}-catalog`,
      });

      const gitlabMod = await import("../../../../src/providers/gitlab.js");
      gitlabMod.initGitLab((global as any).__devtools_config);
      const client = gitlabMod.getGitLabClient();
      (client as any).MergeRequestNotes = { create: mockCreate };

      const res = await parseToolJson(gitlabCreateNoteTool, {
        mr_id: 12,
        body: "Review",
      });

      expect(mockCreate).toHaveBeenCalledWith(`group/${term}-catalog`, 12, "Review");
      expect(res.success).toBe(true);
    },
  );

  it("remains writable when no security block is configured", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 901,
      body: "LGTM",
      author: { username: "tester" },
      created_at: "2026-09-09T00:00:00Z",
    });

    (global as any).__devtools_config = gitlabConfig({ projectId: 100 });

    const gitlabMod = await import("../../../../src/providers/gitlab.js");
    gitlabMod.initGitLab((global as any).__devtools_config);
    const client = gitlabMod.getGitLabClient();
    (client as any).MergeRequestNotes = { create: mockCreate };

    await parseToolJson(gitlabCreateNoteTool, { mr_id: 12, body: "LGTM" });

    expect(mockCreate).toHaveBeenCalledOnce();
  });
});
