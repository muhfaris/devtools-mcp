import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGitHub } from "../../../../src/providers/github.js";
import { githubListPrsTool } from "../../../../src/tools/github/list-prs.js";
import { githubGetCommitsTool } from "../../../../src/tools/github/get-commits.js";
import { githubSearchCodeTool } from "../../../../src/tools/github/search-code.js";
import { parseToolJson } from "../../../helpers/tools-test-helper.js";
import {
  mockFetch,
  useGitHubConfig,
} from "../../../helpers/github-test-helper.js";

const originalConfig = (global as any).__devtools_config;

beforeEach(() => {
  clearGitHub();
});

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
  clearGitHub();
});

const listPull = (number: number) => ({
  number,
  title: `PR ${number}`,
  body: "x".repeat(250),
  state: "open",
  draft: false,
  user: { login: "dev" },
  head: { ref: "feat", sha: "s" },
  base: { ref: "main" },
  labels: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  merged_at: null,
  html_url: `https://github.com/acme/widget/pull/${number}`,
});

describe("github_list_prs", () => {
  it("asks for one page and reports a full page as truncated", async () => {
    const net = mockFetch();
    net.enqueue({ body: [listPull(1), listPull(2)] });
    useGitHubConfig();

    const res = await parseToolJson(githubListPrsTool, {
      limit: 2,
      state: "open",
      base: "main",
    });

    const { url } = net.calls[0];
    expect(url.searchParams.get("state")).toBe("open");
    expect(url.searchParams.get("base")).toBe("main");
    expect(url.searchParams.get("per_page")).toBe("2");
    expect(res.truncated).toBe(true);
    expect(res.pullRequests[0].description).toHaveLength(203);
    expect(res.pullRequests[0].webUrl).toContain("/pull/1");
    net.restore();
  });
});

describe("github_get_commits", () => {
  it("returns subjects by default and bodies on request", async () => {
    const net = mockFetch();
    const commit = {
      sha: "abcdef1234567",
      commit: {
        message: "feat: thing\n\nBody text",
        author: { name: "Dev", email: "d@e", date: "2026-10-01T00:00:00Z" },
      },
      author: { login: "dev" },
      html_url: "https://github.com/acme/widget/commit/abcdef1",
    };
    net.enqueue({ body: [commit] });
    useGitHubConfig();

    const trimmed = await parseToolJson(githubGetCommitsTool, {
      ref: "main",
      path: "src",
      limit: 5,
    });
    expect(trimmed.commits[0].title).toBe("feat: thing");
    expect(trimmed.commits[0].message).toBeUndefined();
    expect(net.calls[0].url.searchParams.get("sha")).toBe("main");
    expect(net.calls[0].url.searchParams.get("path")).toBe("src");
    expect(net.calls[0].url.searchParams.get("per_page")).toBe("5");
    net.restore();

    const bodies = mockFetch();
    bodies.enqueue({ body: [commit] });
    const withMessages = await parseToolJson(githubGetCommitsTool, {
      limit: 5,
      include_messages: true,
    });
    expect(withMessages.commits[0].message).toContain("Body text");
    bodies.restore();
  });
});

describe("github_search_code", () => {
  it("scopes the query to the repository and keeps text matches", async () => {
    const net = mockFetch();
    net.enqueue({
      body: {
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            name: "app.ts",
            path: "src/app.ts",
            sha: "s",
            html_url: "https://github.com/acme/widget/blob/main/src/app.ts",
            text_matches: [
              {
                fragment: "export const thing = 1",
                matches: [{ text: "thing", indices: [13, 18] }],
              },
            ],
          },
        ],
      },
    });
    useGitHubConfig();

    const res = await parseToolJson(githubSearchCodeTool, {
      search: "thing",
      per_page: 20,
    });

    expect(net.calls[0].url.searchParams.get("q")).toBe(
      "thing repo:acme/widget",
    );
    expect(res.results[0].matches[0].texts).toEqual(["thing"]);
    expect(res.incompleteResults).toBe(false);
    net.restore();
  });

  it("requires a search term", async () => {
    useGitHubConfig();
    await expect(
      githubSearchCodeTool.execute({ search: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", parameter: "search" });
  });
});
