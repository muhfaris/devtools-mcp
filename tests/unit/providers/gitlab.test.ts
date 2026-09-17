import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGitLab,
  getGitLabClient,
  getGitLabWebUrl,
  initGitLab,
  parseGitLabUrl,
  resolveMrId,
  resolveProjectId,
} from "../../../src/providers/gitlab.js";
import { gitlabSetConfigTool } from "../../../src/tools/gitlab/set-config.js";
import { ToolError } from "../../../src/core/errors.js";

describe("providers/gitlab", () => {
  beforeEach(() => {
    clearGitLab();
  });

  afterEach(() => {
    clearGitLab();
  });

  describe("parseGitLabUrl", () => {
    it("parses merge request URLs with and without /-/ segment", () => {
      const url1 = "https://gitlab.example.com/group/project/-/merge_requests/1227";
      expect(parseGitLabUrl(url1)).toEqual({
        host: "https://gitlab.example.com",
        projectPath: "group/project",
        mrId: 1227,
      });

      const url2 = "https://gitlab.com/group/subgroup/repo/merge_requests/42";
      expect(parseGitLabUrl(url2)).toEqual({
        host: "https://gitlab.com",
        projectPath: "group/subgroup/repo",
        mrId: 42,
      });
    });

    it("parses project repository URLs", () => {
      const url = "https://gitlab.com/group/project/-/tree/main/src";
      expect(parseGitLabUrl(url)).toEqual({
        host: "https://gitlab.com",
        projectPath: "group/project",
      });
    });

    it("returns empty object for non-URL strings", () => {
      expect(parseGitLabUrl("group/project")).toEqual({});
    });
  });

  describe("resolveProjectId", () => {
    it("extracts project path from mr_url parameter", () => {
      const config = { gitlab: { url: "https://gitlab.com", token: "token" } };
      const id = resolveProjectId(
        { mr_url: "https://gitlab.example.com/group/project/-/merge_requests/1227" },
        config as any,
      );
      expect(id).toBe("group/project");
    });

    it("accepts string path with namespace directly in project_id", () => {
      const config = { gitlab: { url: "https://gitlab.com", token: "token" } };
      expect(resolveProjectId({ project_id: "/group/project/" }, config as any)).toBe(
        "group/project",
      );
    });

    it("accepts numeric project ID", () => {
      const config = { gitlab: { url: "https://gitlab.com", token: "token" } };
      expect(resolveProjectId({ project_id: 774 }, config as any)).toBe(774);
    });

    it("throws GITLAB_PROJECT_ID_REQUIRED with helpful URL instructions", () => {
      const config = { gitlab: { url: "https://gitlab.com", token: "token" } };
      expect(() => resolveProjectId({}, config as any)).toThrowError(ToolError);

      try {
        resolveProjectId({}, config as any);
      } catch (err: any) {
        expect(err.code).toBe("GITLAB_PROJECT_ID_REQUIRED");
        expect(err.action).toContain("GitLab MR URL");
      }
    });
  });

  describe("resolveMrId", () => {
    it("extracts mr_id from mr_url parameter", () => {
      expect(
        resolveMrId({ mr_url: "https://gitlab.example.com/group/project/-/merge_requests/1227" }),
      ).toBe(1227);
    });

    it("accepts numeric mr_id parameter", () => {
      expect(resolveMrId({ mr_id: 456 })).toBe(456);
      expect(resolveMrId({ mr_id: "789" })).toBe(789);
    });

    it("rejects an mr_id that conflicts with mr_url", () => {
      expect(() =>
        resolveMrId({
          mr_id: 123940,
          mr_url:
            "https://gitlab.example.com/group/project/-/merge_requests/1239",
        }),
      ).toThrowError(ToolError);

      try {
        resolveMrId({
          mr_id: 123940,
          mr_url:
            "https://gitlab.example.com/group/project/-/merge_requests/1239",
        });
      } catch (err: any) {
        expect(err).toMatchObject({
          code: "GITLAB_MR_ID_MISMATCH",
          parameter: "mr_id",
          retryable: false,
        });
        expect(err.message).toContain("123940");
        expect(err.action).toContain("mr_id: 1239");
      }
    });

    it.each([0, -1, 1.5, "invalid"])(
      "rejects invalid explicit mr_id %s",
      (mrId) => {
        expect(() => resolveMrId({ mr_id: mrId })).toThrowError(
          expect.objectContaining({ code: "GITLAB_MR_ID_INVALID" }),
        );
      },
    );

    it("throws GITLAB_MR_ID_REQUIRED if neither is provided", () => {
      expect(() => resolveMrId({})).toThrowError(ToolError);
      try {
        resolveMrId({});
      } catch (err: any) {
        expect(err.code).toBe("GITLAB_MR_ID_REQUIRED");
        expect(err.action).toContain("mr_url");
      }
    });
  });

  it("constructs correct web URLs respecting custom hosts and slug project IDs", () => {
    const config = { gitlab: { url: "https://gitlab.example.com/", token: "xxx" } };
    expect(getGitLabWebUrl(config as any, "group/project")).toBe(
      "https://gitlab.example.com/group/project",
    );
  });

  describe("client freshness", () => {
    const originalConfig = (global as any).__devtools_config;

    const useConfig = (config: any) => {
      (global as any).__devtools_config = config;
    };

    const providersShape = (gitlab: Record<string, unknown>) => ({
      providers: {
        gitlab: { url: "https://gitlab.com", token: "token-a", ...gitlab },
      },
    });

    afterEach(() => {
      (global as any).__devtools_config = originalConfig;
    });

    it("reuses the cached client when the config is unchanged", () => {
      useConfig(providersShape({}));

      const first = getGitLabClient();
      const second = getGitLabClient();

      expect(second).toBe(first);
    });

    it("rebuilds the client when the token changes", () => {
      useConfig(providersShape({ token: "token-a" }));
      const first = getGitLabClient();

      useConfig(providersShape({ token: "token-b" }));
      const second = getGitLabClient();

      expect(second).not.toBe(first);
    });

    it("rebuilds the client when the url changes", () => {
      useConfig(providersShape({ url: "https://gitlab.com" }));
      const first = getGitLabClient();

      useConfig(providersShape({ url: "https://gitlab.example.com" }));
      const second = getGitLabClient();

      expect(second).not.toBe(first);
    });

    it("reads the legacy top-level config too", () => {
      useConfig({ gitlab: { url: "https://gitlab.com", token: "token-a" } });
      const first = getGitLabClient();

      useConfig({ gitlab: { url: "https://gitlab.com", token: "token-b" } });

      expect(getGitLabClient()).not.toBe(first);
    });

    it("picks up a token supplied at runtime by gitlab_set_config", async () => {
      // Mirrors the real flow: the config holds a placeholder that resolved to an
      // empty string, so the token arrives later through the MCP tool.
      useConfig({ gitlab: { url: "https://gitlab.com", token: "" } });
      expect(() => getGitLabClient()).toThrowError(ToolError);

      await gitlabSetConfigTool.execute({ token: "glpat-from-mcp" });

      const client = getGitLabClient();
      expect(client).toBeTruthy();
      // A second call must not rebuild again — the fingerprint was recorded by
      // gitlab_set_config's own initGitLab call.
      expect(getGitLabClient()).toBe(client);
    });

    it("tears the client down when the config is removed", () => {
      useConfig(providersShape({}));
      expect(getGitLabClient()).toBeTruthy();

      useConfig({});
      expect(() => getGitLabClient()).toThrowError(
        expect.objectContaining({ code: "CONFIG_REQUIRED" }),
      );

      // And a later config is not served by the torn-down client.
      useConfig(providersShape({ token: "token-c" }));
      expect(() => getGitLabClient()).not.toThrow();
    });

    it("clears the client when the provider is disabled, then rebuilds on re-enable", () => {
      const enabled = providersShape({ enabled: true });
      useConfig(enabled);
      const first = getGitLabClient();

      useConfig(providersShape({ enabled: false }));
      expect(() => getGitLabClient()).toThrowError(
        expect.objectContaining({ code: "CONFIG_REQUIRED" }),
      );

      useConfig(enabled);
      expect(getGitLabClient()).not.toBe(first);
    });
  });
});
