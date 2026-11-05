import { ToolError } from "../core/errors.js";

/**
 * A failed GitHub REST call, carrying what the status alone does not say: whether the
 * failure was a rate limit, and when the limit resets.
 */
export class GitHubRequestError extends Error {
  readonly status: number;
  readonly description: string;
  readonly rateLimited: boolean;
  readonly resetAt?: string;

  constructor(
    status: number,
    description: string,
    options: { rateLimited?: boolean; resetAt?: string; cause?: unknown } = {},
  ) {
    super(description, { cause: options.cause });
    this.name = "GitHubRequestError";
    this.status = status;
    this.description = description;
    this.rateLimited = options.rateLimited === true;
    this.resetAt = options.resetAt;
  }
}

type ErrorFacts = {
  status?: number;
  description?: string;
  rateLimited?: boolean;
  resetAt?: string;
};

/** Read the fields the formatter uses, without trusting an arbitrary thrown value. */
const factsOf = (error: unknown): ErrorFacts => {
  if (error instanceof GitHubRequestError) {
    return {
      status: error.status,
      description: error.description,
      rateLimited: error.rateLimited,
      resetAt: error.resetAt,
    };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      status: typeof value.status === "number" ? value.status : undefined,
      description:
        typeof value.description === "string" ? value.description : undefined,
      rateLimited: value.rateLimited === true,
      resetAt: typeof value.resetAt === "string" ? value.resetAt : undefined,
    };
  }
  return {};
};

/**
 * Turn a failed call into the error shape the server promises: a code, what happened, and
 * one action the caller can take.
 *
 * The distinction that matters is 403. GitHub uses it for a rate limit *and* for a token
 * that cannot see the resource, and they need opposite responses — wait, or stop.
 */
export const formatGitHubError = (
  operation: string,
  error: unknown,
): ToolError => {
  if (error instanceof ToolError) return error;

  const { status, description = "Unknown error", rateLimited, resetAt } =
    factsOf(error);

  if (status === 401) {
    return new ToolError(
      "GITHUB_TOKEN_REQUIRED",
      `GitHub authentication failed (401: ${description}).`,
      "Check that the personal access token is valid and not expired, set it with github_set_config, then retry.",
      true,
      {
        configKey: "providers.github.token",
        setupTool: "github_set_config",
        cause: error,
      },
    );
  }

  if (status === 403 && rateLimited) {
    return new ToolError(
      "GITHUB_RATE_LIMITED",
      `GitHub's API rate limit is exhausted${resetAt ? ` until ${resetAt}` : ""} (403: ${description}).`,
      "Wait for the limit to reset, or use a token with a higher limit, then retry. Do not retry immediately.",
      true,
      { cause: error },
    );
  }

  if (status === 403) {
    return new ToolError(
      "GITHUB_FORBIDDEN",
      `GitHub refused the request (403: ${description}).`,
      "Check that the token has access to this repository and the scope the operation needs, then retry.",
      true,
      { configKey: "providers.github.token", cause: error },
    );
  }

  if (status === 404) {
    return new ToolError(
      "GITHUB_NOT_FOUND",
      `GitHub could not find the resource (404: ${description}).`,
      "Verify the repository as `owner/name`, the pull request number, and that the token can read this repository, then retry.",
      true,
      { cause: error },
    );
  }

  if (status === 0) {
    return new ToolError(
      "GITHUB_UNREACHABLE",
      `GitHub could not be reached: ${description}.`,
      "Check network access to the GitHub host and `providers.github.url`, then retry.",
      true,
      { configKey: "providers.github.url", cause: error },
    );
  }

  return new ToolError(
    "GITHUB_REQUEST_FAILED",
    status === undefined
      ? `GitHub could not ${operation}: ${description}.`
      : `GitHub could not ${operation} (HTTP ${status}: ${description}).`,
    "Report the GitHub failure to the user; do not retry automatically.",
    false,
    { cause: error },
  );
};
