import { describe, expect, it } from "vitest";
import { formatGitLabError } from "../../../src/providers/gitlab-error.js";
import { ToolError } from "../../../src/core/errors.js";

describe("formatGitLabError", () => {
  it("formats 401 unauthorized errors with token configuration action", () => {
    const err = formatGitLabError("get the merge request", {
      status: 401,
      description: "Unauthorized",
    });

    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("GITLAB_TOKEN_REQUIRED");
    expect(err.message).toContain("401: Unauthorized");
    expect(err.retryable).toBe(true);
  });

  it("formats 404 not found errors with clear resource guidance", () => {
    const err = formatGitLabError("get the merge request", {
      status: 404,
      description: "404 Project Not Found",
    });

    expect(err.code).toBe("GITLAB_REQUEST_FAILED");
    expect(err.message).toContain("404: 404 Project Not Found");
    expect(err.action).toContain("Verify the project path/ID and MR ID");
    expect(err.retryable).toBe(true);
  });
});
