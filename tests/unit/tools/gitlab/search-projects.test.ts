import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { getGitLabClient, initGitLab } from "../../../../src/providers/gitlab.js";
import type { Config } from "../../../../src/core/types.js";
import { gitlabSearchProjectsTool } from "../../../../src/tools/gitlab/search-projects.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";

type RuntimeConfig = { __devtools_config?: Config };
const runtime = global as unknown as RuntimeConfig;
const originalConfig = runtime.__devtools_config;

afterEach(() => {
  runtime.__devtools_config = originalConfig;
});

// The mocks replace only the two gitbeaker resources this tool calls.
type ClientMocks = {
  Projects: { all: Mock };
  Groups: { allProjects: Mock };
};

const setup = (mocks: Partial<ClientMocks>) => {
  const config = {
    providers: {
      gitlab: { url: "https://gitlab.example.com", token: "token" },
    },
  } as unknown as Config;
  runtime.__devtools_config = config;
  initGitLab(config);
  Object.assign(getGitLabClient(), {
    Projects: { all: vi.fn() },
    Groups: { allProjects: vi.fn() },
    ...mocks,
  });
};

const project = {
  id: 7,
  path_with_namespace: "operation/bag",
  name: "bag",
  description: null,
  default_branch: "staging",
  web_url: "https://gitlab.example.com/operation/bag",
  last_activity_at: "2026-11-01T00:00:00Z",
};

describe("gitlab_search_projects", () => {
  it("searches all projects and returns the path to use as project_id", async () => {
    const all = vi.fn().mockResolvedValue([project]);
    const allProjects = vi.fn();
    setup({ Projects: { all }, Groups: { allProjects } });

    const res = await parseToolJson(gitlabSearchProjectsTool, {
      search: " bag ",
    });

    expect(allProjects).not.toHaveBeenCalled();
    // `perPage` alone bounds nothing in @gitbeaker: without `maxPages` it follows every page.
    expect(all.mock.calls[0][0]).toMatchObject({
      search: "bag",
      perPage: 20,
      maxPages: 1,
    });
    expect(res.group).toBe("all");
    expect(res.truncated).toBe(false);
    expect(res.results[0]).toMatchObject({
      id: 7,
      path: "operation/bag",
      defaultBranch: "staging",
    });
  });

  it("searches inside one group, including its subgroups", async () => {
    const all = vi.fn();
    const allProjects = vi.fn().mockResolvedValue([project]);
    setup({ Projects: { all }, Groups: { allProjects } });

    const res = await parseToolJson(gitlabSearchProjectsTool, {
      search: "bag",
      group: "operation",
    });

    expect(all).not.toHaveBeenCalled();
    expect(allProjects.mock.calls[0][0]).toBe("operation");
    expect(allProjects.mock.calls[0][1]).toMatchObject({
      search: "bag",
      includeSubgroups: true,
      maxPages: 1,
    });
    expect(res.group).toBe("operation");
  });

  it("marks a full page as truncated and caps per_page at 100", async () => {
    const all = vi.fn().mockResolvedValue([project, project]);
    setup({ Projects: { all } });

    const res = await parseToolJson(gitlabSearchProjectsTool, {
      search: "bag",
      per_page: 2,
    });
    expect(res.truncated).toBe(true);

    await parseToolJson(gitlabSearchProjectsTool, {
      search: "bag",
      per_page: 500,
    });
    expect(all.mock.calls[1][0].perPage).toBe(100);
  });

  it("rejects an empty search term", async () => {
    setup({});
    await expect(
      gitlabSearchProjectsTool.execute({ search: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
