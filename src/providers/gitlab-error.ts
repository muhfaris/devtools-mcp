import { ToolError } from "../core/errors.js";

export const formatGitLabError = (operation: string, error: any): ToolError => {
  if (error instanceof ToolError) return error;

  const status =
    error?.status || error?.response?.status || error?.cause?.status;
  const description =
    error?.description ||
    error?.message ||
    error?.response?.data?.message ||
    "Unknown error";

  let message = `GitLab could not ${operation}.`;
  let action =
    "Report the GitLab failure to the user; do not switch to local Git or retry automatically.";
  let code = "GITLAB_REQUEST_FAILED";
  let retryable = false;

  if (status === 401 || status === 403) {
    code = "GITLAB_TOKEN_REQUIRED";
    message = `GitLab authentication failed (${status}: ${description}).`;
    action =
      "Check if your GitLab personal access token is valid and has `api` scope via gitlab_set_config, then retry.";
    retryable = true;
  } else if (status === 404) {
    message = `GitLab resource not found (404: ${description}). Check if project path/ID or MR ID exists and your token has access.`;
    action =
      "Verify the project path/ID and MR ID or check if your token has read access to this repository, then retry.";
    retryable = true;
  } else if (status) {
    message = `GitLab request failed with HTTP ${status}: ${description}`;
  } else if (description && description !== "Unknown error") {
    message = `GitLab could not ${operation}: ${description}`;
  }

  return new ToolError(code, message, action, retryable, { cause: error });
};
