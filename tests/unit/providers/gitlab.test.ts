import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGitLab,
  getGitLabWebUrl,
  initGitLab,
  resolveProjectId,
} from "../../../src/providers/gitlab.js";
import { ToolError } from "../../../src/core/errors.js";

describe("providers/gitlab", () => {
  beforeEach(() => {
    clearGitLab();
  });

  afterEach(() => {
    clearGitLab();
  });

  it("throws GITLAB_TOKEN_REQUIRED if token is missing in config", () => {
    expect(() =>
      initGitLab({
        gitlab: { url: "https://gitlab.com", projectId: 1, token: "" },
      }),
    ).toThrowError(ToolError);

    try {
      initGitLab({
        gitlab: { url: "https://gitlab.com", projectId: 1, token: "" },
      });
    } catch (err: any) {
      expect(err.code).toBe("GITLAB_TOKEN_REQUIRED");
      expect(err.configKey).toBe("gitlab.token");
      expect(err.setupTool).toBe("gitlab_set_config");
    }
  });

  it("throws GITLAB_PROJECT_ID_REQUIRED with instructions not to switch to local git", () => {
    const config = {
      gitlab: { url: "https://gitlab.com", token: "glpat-xxx", projectId: "" },
    };

    expect(() => resolveProjectId({}, config as any)).toThrowError(ToolError);

    try {
      resolveProjectId({}, config as any);
    } catch (err: any) {
      expect(err.code).toBe("GITLAB_PROJECT_ID_REQUIRED");
      expect(err.parameter).toBe("project_id");
      expect(err.action).toContain(
        "Ask the user for the numeric GitLab project ID",
      );
      expect(err.action).toContain("Do not switch to local Git.");
      expect(err.retryable).toBe(true);
    }
  });

  it("resolves project_id from per-call params over config", () => {
    const config = {
      gitlab: { url: "https://gitlab.com", token: "glpat-xxx", projectId: 100 },
    };
    expect(resolveProjectId({ project_id: 200 }, config as any)).toBe(200);
    expect(resolveProjectId({}, config as any)).toBe(100);
  });

  it("constructs correct web URLs respecting custom hosts", () => {
    const config = {
      gitlab: {
        url: "https://my-gitlab.internal.com/",
        token: "xxx",
        projectId: 42,
      },
    };
    expect(getGitLabWebUrl(config as any, 42)).toBe(
      "https://my-gitlab.internal.com/42",
    );
  });
});
