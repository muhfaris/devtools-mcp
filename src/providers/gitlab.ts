import { Gitlab } from "@gitbeaker/rest";
import { ToolError } from "../core/errors.js";
import type { Config } from "../core/types.js";

let gitlabClient: Gitlab | null = null;
let projectId: string | number | null = null;

export const initGitLab = (config: Config) => {
  if (!config.gitlab) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab configuration is required.",
      "Configure GitLab with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "gitlab", setupTool: "gitlab_set_config" },
    );
  }

  const { url, token, projectId: pid } = config.gitlab;
  if (!token) {
    throw new ToolError(
      "GITLAB_TOKEN_REQUIRED",
      "A GitLab access token is required.",
      "Ask the user to configure a GitLab access token with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "gitlab.token", setupTool: "gitlab_set_config" },
    );
  }

  gitlabClient = new Gitlab({ host: url || "https://gitlab.com", token });
  projectId = pid;
  return { client: gitlabClient, projectId };
};

export const clearGitLab = () => {
  gitlabClient = null;
  projectId = null;
};

export const getGitLabClient = () => {
  if (!gitlabClient) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab is not initialized.",
      "Configure GitLab with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "gitlab", setupTool: "gitlab_set_config" },
    );
  }
  return gitlabClient;
};

export const getProjectId = () => {
  if (!projectId) {
    throw createProjectIdRequiredError();
  }
  return projectId;
};

const createProjectIdRequiredError = () =>
  new ToolError(
    "GITLAB_PROJECT_ID_REQUIRED",
    "GitLab project ID is required.",
    "Ask the user for the numeric GitLab project ID, then retry this tool with project_id. Do not switch to local Git.",
    true,
    { parameter: "project_id", configKey: "gitlab.projectId" },
  );

export const resolveProjectId = (
  params: Record<string, unknown>,
  config: Config,
) => {
  const id = params.project_id ?? config.gitlab?.projectId;
  if (!id) throw createProjectIdRequiredError();
  return id as string | number;
};

export const getGitLabConfig = (config: Config) => {
  if (!config.gitlab) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab configuration is required.",
      "Configure GitLab with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "gitlab", setupTool: "gitlab_set_config" },
    );
  }
  return config.gitlab;
};

export const getGitLabWebUrl = (
  config: Config,
  resolvedProjectId: string | number,
) => {
  const host = (config.gitlab?.url || "https://gitlab.com").replace(/\/$/, "");
  return `${host}/${resolvedProjectId}`;
};
