import { Gitlab } from "@gitbeaker/rest";
import type { Config } from "../core/types.js";

let gitlabClient: Gitlab | null = null;
let projectId: string | number | null = null;

export const initGitLab = (config: Config) => {
  if (!config.gitlab) {
    throw new Error("GitLab configuration missing in devtools.config.yaml");
  }

  const { url, token, projectId: pid } = config.gitlab;

  if (!token) {
    throw new Error(
      "GitLab token is required. Set GITLAB_TOKEN in environment or config.",
    );
  }

  gitlabClient = new Gitlab({
    host: url || "https://gitlab.com",
    token: token,
  });

  projectId = pid;
  return { client: gitlabClient, projectId };
};

export const getGitLabClient = () => {
  if (!gitlabClient) {
    throw new Error("GitLab client not initialized. Call initGitLab() first.");
  }
  return gitlabClient;
};

export const getProjectId = () => {
  if (!projectId) {
    throw new Error("GitLab project ID not set in config.");
  }
  return projectId;
};

export const getGitLabConfig = (config: Config) => {
  if (!config.gitlab) {
    throw new Error("GitLab configuration missing in devtools.config.yaml");
  }
  return config.gitlab;
};
