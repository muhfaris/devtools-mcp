import { describe, expect, it } from "vitest";
import {
  formatGitHubError,
  GitHubRequestError,
} from "../../../src/providers/github-error.js";
import { ToolError } from "../../../src/core/errors.js";

describe("formatGitHubError", () => {
  it("reads a 401 as a missing or expired token", () => {
    const error = formatGitHubError(
      "get the pull request",
      new GitHubRequestError(401, "Bad credentials"),
    );
    expect(error).toMatchObject({
      code: "GITHUB_TOKEN_REQUIRED",
      retryable: true,
      configKey: "providers.github.token",
    });
  });

  it("separates a rate-limited 403 from any other 403", () => {
    const limited = formatGitHubError(
      "list pull requests",
      new GitHubRequestError(403, "API rate limit exceeded", {
        rateLimited: true,
        resetAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(limited.code).toBe("GITHUB_RATE_LIMITED");
    expect(limited.message).toContain("2026-01-01T00:00:00.000Z");
    expect(limited.action).toContain("Wait");

    const forbidden = formatGitHubError(
      "list pull requests",
      new GitHubRequestError(403, "Resource not accessible"),
    );
    expect(forbidden.code).toBe("GITHUB_FORBIDDEN");
    expect(forbidden.action).toContain("token");
  });

  it("names the repository and number for a 404", () => {
    const error = formatGitHubError(
      "get the pull request",
      new GitHubRequestError(404, "Not Found"),
    );
    expect(error.code).toBe("GITHUB_NOT_FOUND");
    expect(error.action).toContain("owner/name");
  });

  it("distinguishes an unreachable host from a rejected request", () => {
    const unreachable = formatGitHubError(
      "get commits",
      new GitHubRequestError(0, "the network request failed"),
    );
    expect(unreachable).toMatchObject({
      code: "GITHUB_UNREACHABLE",
      retryable: true,
    });

    const rejected = formatGitHubError(
      "get commits",
      new GitHubRequestError(500, "Server Error"),
    );
    expect(rejected).toMatchObject({
      code: "GITHUB_REQUEST_FAILED",
      retryable: false,
    });
  });

  it("passes a ToolError through untouched", () => {
    const original = new ToolError("X", "message", "action", false);
    expect(formatGitHubError("anything", original)).toBe(original);
  });

  it("turns a non-Error throw into a generic failure", () => {
    expect(formatGitHubError("anything", "nope")).toMatchObject({
      code: "GITHUB_REQUEST_FAILED",
    });
  });
});
