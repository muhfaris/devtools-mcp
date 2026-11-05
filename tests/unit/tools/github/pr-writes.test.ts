import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGitHub } from "../../../../src/providers/github.js";
import { githubCreatePrTool } from "../../../../src/tools/github/create-pr.js";
import { githubUpdatePrTool } from "../../../../src/tools/github/update-pr.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import {
  mockFetch,
  useGitHubConfig,
} from "../../../helpers/github-test-helper.js";

const originalConfig = (global as any).__devtools_config;

const granted = { security: { allow_write: true } };

const pull = {
  number: 7,
  title: "Add widget",
  body: "Body",
  state: "open",
  draft: false,
  user: { login: "dev" },
  head: { ref: "feat/widget", sha: "s" },
  base: { ref: "main" },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  closed_at: null,
  merged_at: null,
  html_url: "https://github.com/acme/widget/pull/7",
};

beforeEach(() => {
  clearGitHub();
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
  clearGitHub();
});

describe("github_create_pr", () => {
  it("opens a pull request from an existing head branch", async () => {
    const net = mockFetch();
    net.enqueue({ status: 201, body: pull });
    useGitHubConfig(granted);

    const res = await parseToolJson(githubCreatePrTool, {
      head: "feat/widget",
      base: "main",
      title: "Add widget",
      body: "Body",
      draft: true,
    });

    const [{ url, init }] = net.calls;
    expect(url.pathname).toBe("/repos/acme/widget/pulls");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      head: "feat/widget",
      base: "main",
      title: "Add widget",
      body: "Body",
      draft: true,
    });
    expect(res).toMatchObject({ id: 7, success: true });
    net.restore();
  });

  it("refuses head and base being the same branch", async () => {
    useGitHubConfig(granted);
    await expect(
      githubCreatePrTool.execute({
        head: "main",
        base: "main",
        title: "Nope",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "base" });
  });

  it("denies writes when nothing grants them", async () => {
    useGitHubConfig();
    await expect(
      githubCreatePrTool.execute({ head: "a", base: "b", title: "t" }),
    ).rejects.toMatchObject({ code: "GITHUB_WRITE_DISABLED" });
  });
});

describe("github_update_pr", () => {
  it("changes only the fields passed and reports the previous value", async () => {
    const net = mockFetch();
    net.enqueue(
      { body: pull },
      {
        body: {
          ...pull,
          title: "Better title",
          base: { ref: "develop" },
          body: "New body",
        },
      },
    );
    useGitHubConfig(granted);

    const res = await parseToolJson(githubUpdatePrTool, {
      pr_id: 7,
      title: "Better title",
      base: "develop",
      body: "New body",
    });

    const patch = net.calls[1];
    expect(patch.init.method).toBe("PATCH");
    expect(JSON.parse(String(patch.init.body))).toEqual({
      title: "Better title",
      base: "develop",
      body: "New body",
    });
    expect(res.changed).toEqual({
      title: { from: "Add widget", to: "Better title" },
      base: { from: "main", to: "develop" },
      body: { from: "Body", to: "New body" },
    });
    expect(res.success).toBe(true);
    net.restore();
  });

  it("rejects an empty title or base", async () => {
    useGitHubConfig(granted);
    await expect(
      githubUpdatePrTool.execute({ pr_id: 7, title: "  " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "title" });
  });

  it("refuses a call with nothing to change", async () => {
    useGitHubConfig(granted);
    await expect(
      githubUpdatePrTool.execute({ pr_id: 7 }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "base" });
  });

  it("blocks a repository matching a blocked_env entry", async () => {
    useGitHubConfig({ ...granted, repo: "acme/production" });
    await expect(
      githubUpdatePrTool.execute({ pr_id: 7, title: "x" }),
    ).rejects.toMatchObject({ code: "GITHUB_ENVIRONMENT_BLOCKED" });
  });
});
