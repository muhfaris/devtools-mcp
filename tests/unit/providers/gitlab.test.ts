import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGitLab,
  getGitLabWebUrl,
  initGitLab,
  parseGitLabUrl,
  resolveMrId,
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
});
