import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGitHub,
  getGitHubClient,
  githubApiBase,
  normalizeRepo,
  parseGitHubUrl,
  resolvePrId,
  resolveRepo,
} from "../../../src/providers/github.js";
import { GitHubRequestError } from "../../../src/providers/github-error.js";
import { githubSetConfigTool } from "../../../src/tools/github/set-config.js";
import { ToolError } from "../../../src/core/errors.js";
import {
  githubProviderConfig,
  headerOf,
  mockFetch,
  useGitHubConfig,
} from "../../helpers/github-test-helper.js";

const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
  clearGitHub();
});

describe("githubApiBase", () => {
  it("maps github.com to the API host and everything else to /api/v3", () => {
    expect(githubApiBase(undefined)).toBe("https://api.github.com");
    expect(githubApiBase("https://github.com")).toBe("https://api.github.com");
    expect(githubApiBase("https://github.com/")).toBe(
      "https://api.github.com",
    );
    // GitHub Enterprise Server serves the same API from the same host.
    expect(githubApiBase("https://ghe.corp.example/")).toBe(
      "https://ghe.corp.example/api/v3",
    );
  });
});

describe("parseGitHubUrl", () => {
  it("parses pull request URLs, including a sub-page", () => {
    expect(parseGitHubUrl("https://github.com/acme/widget/pull/42")).toEqual({
      host: "https://github.com",
      repo: "acme/widget",
      prId: 42,
    });
    expect(
      parseGitHubUrl("https://github.com/acme/widget/pull/42/files"),
    ).toEqual({ host: "https://github.com", repo: "acme/widget", prId: 42 });
  });

  it("parses repository URLs with or without a sub-page", () => {
    expect(parseGitHubUrl("https://github.com/acme/widget")).toEqual({
      host: "https://github.com",
      repo: "acme/widget",
    });
    expect(
      parseGitHubUrl("https://github.com/acme/widget/tree/main/src"),
    ).toEqual({ host: "https://github.com", repo: "acme/widget" });
  });

  it("returns nothing for a value that is not a URL", () => {
    expect(parseGitHubUrl("acme/widget")).toEqual({});
  });
});

describe("normalizeRepo", () => {
  it("accepts the shapes users paste", () => {
    expect(normalizeRepo("acme/widget")).toBe("acme/widget");
    expect(normalizeRepo(" /acme/widget/ ")).toBe("acme/widget");
    expect(normalizeRepo("https://github.com/acme/widget")).toBe(
      "acme/widget",
    );
    expect(normalizeRepo("git@github.com:acme/widget.git")).toBe(
      "acme/widget",
    );
  });

  it("rejects anything that is not owner/name", () => {
    expect(normalizeRepo("widget")).toBeNull();
    expect(normalizeRepo("a/b/c")).toBeNull();
    expect(normalizeRepo("")).toBeNull();
  });
});

describe("resolveRepo", () => {
  it("prefers the pull request URL, then the parameter, then the config", () => {
    const config = githubProviderConfig({ repo: "config/repo" });
    expect(
      resolveRepo({ pr_url: "https://github.com/from/url/pull/1" }, config),
    ).toBe("from/url");
    expect(resolveRepo({ repo: "from/param" }, config)).toBe("from/param");
    expect(resolveRepo({}, config)).toBe("config/repo");
  });

  it("names what to provide when nothing resolves a repository", () => {
    expect(() => resolveRepo({}, githubProviderConfig({ repo: "" }))).toThrow(
      expect.objectContaining({
        code: "GITHUB_REPO_REQUIRED",
        parameter: "repo",
        configKey: "providers.github.repo",
      }),
    );
  });
});

describe("resolvePrId", () => {
  it("reads the number from a URL or from pr_id", () => {
    expect(
      resolvePrId({ pr_url: "https://github.com/acme/widget/pull/7" }),
    ).toBe(7);
    expect(resolvePrId({ pr_id: 8 })).toBe(8);
    expect(resolvePrId({ pull_number: "9" })).toBe(9);
  });

  it("rejects a pr_id that disagrees with the URL", () => {
    expect(() =>
      resolvePrId({
        pr_id: 1,
        pr_url: "https://github.com/acme/widget/pull/2",
      }),
    ).toThrow(expect.objectContaining({ code: "GITHUB_PR_ID_MISMATCH" }));
  });

  it.each([0, -1, 1.5, "invalid"])(
    "rejects an invalid explicit pr_id %s",
    (prId) => {
      expect(() => resolvePrId({ pr_id: prId })).toThrow(
        expect.objectContaining({ code: "GITHUB_PR_ID_INVALID" }),
      );
    },
  );

  it("requires a number when neither source has one", () => {
    expect(() => resolvePrId({})).toThrow(
      expect.objectContaining({ code: "GITHUB_PR_ID_REQUIRED", retryable: true }),
    );
  });
});

describe("GitHubClient", () => {
  it("sends the documented headers and one page of query parameters", async () => {
    const net = mockFetch();
    net.enqueue({ body: [] });
    (global as any).__devtools_config = githubProviderConfig();

    const client = getGitHubClient();
    await client.request({
      path: "/repos/acme/widget/pulls",
      query: { state: "open", per_page: 5, page: undefined },
    });

    const [{ url, init }] = net.calls;
    expect(url.toString()).toBe(
      "https://api.github.com/repos/acme/widget/pulls?state=open&per_page=5",
    );
    expect(headerOf(init, "authorization")).toBe("Bearer ghp_test");
    expect(headerOf(init, "x-github-api-version")).toBe("2022-11-28");
    net.restore();
  });

  it("returns raw text for a media type that is not JSON", async () => {
    const net = mockFetch();
    net.enqueue({ text: "line one\nline two" });
    useGitHubConfig();

    const text = await getGitHubClient().requestText({
      path: "/repos/acme/widget/contents/a.txt",
      accept: "application/vnd.github.raw",
    });

    expect(text).toBe("line one\nline two");
    expect(headerOf(net.calls[0].init, "accept")).toBe(
      "application/vnd.github.raw",
    );
    net.restore();
  });

  it("keeps a token out of the error and reports the status", async () => {
    const net = mockFetch();
    net.enqueue({ status: 404, body: { message: "Not Found" } });
    useGitHubConfig();

    await expect(
      getGitHubClient().request({ path: "/repos/acme/widget/pulls/1" }),
    ).rejects.toMatchObject({ status: 404, description: "Not Found" });
    net.restore();
  });

  it("marks a rate-limited 403 so the formatter can tell it apart", async () => {
    const net = mockFetch();
    net.enqueue({
      status: 403,
      body: { message: "API rate limit exceeded" },
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1767225600",
      },
    });
    useGitHubConfig();

    await expect(
      getGitHubClient().request({ path: "/repos/acme/widget" }),
    ).rejects.toMatchObject({
      status: 403,
      rateLimited: true,
      resetAt: "2026-01-01T00:00:00.000Z",
    });
    net.restore();
  });
});

describe("client freshness", () => {
  it("reuses the client while url and token are unchanged", () => {
    (global as any).__devtools_config = githubProviderConfig();
    const first = getGitHubClient();
    expect(getGitHubClient()).toBe(first);
  });

  it("rebuilds when the token changes, and tears down when removed", () => {
    (global as any).__devtools_config = githubProviderConfig();
    const first = getGitHubClient();

    (global as any).__devtools_config = githubProviderConfig({ token: "other" });
    expect(getGitHubClient()).not.toBe(first);

    (global as any).__devtools_config = {
      providers: { github: { url: "https://github.com", repo: "a/b" } },
    };
    expect(() => getGitHubClient()).toThrow(
      expect.objectContaining({ code: "GITHUB_TOKEN_REQUIRED" }),
    );
  });

  it("picks up a token supplied by github_set_config", async () => {
    (global as any).__devtools_config = {
      providers: { github: { url: "https://github.com", repo: "a/b", token: "" } },
    };
    expect(() => getGitHubClient()).toThrow(ToolError);

    await githubSetConfigTool.execute({ token: "ghp_from_mcp" });

    const client = getGitHubClient();
    expect(client).toBeTruthy();
    expect(getGitHubClient()).toBe(client);
  });

  it("refuses a disabled provider", () => {
    (global as any).__devtools_config = githubProviderConfig({ enabled: false });
    expect(() => getGitHubClient()).toThrow(
      expect.objectContaining({ code: "CONFIG_REQUIRED" }),
    );
  });
});

it("GitHubRequestError keeps the fields the formatter reads", () => {
  const error = new GitHubRequestError(500, "boom", { rateLimited: true });
  expect(error.status).toBe(500);
  expect(error.description).toBe("boom");
  expect(error.rateLimited).toBe(true);
});
