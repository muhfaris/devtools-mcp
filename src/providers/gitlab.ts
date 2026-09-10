import { Gitlab } from "@gitbeaker/rest";
import { ToolError } from "../core/errors.js";
import type { Config } from "../core/types.js";

let gitlabClient: Gitlab | null = null;
let projectId: string | number | null = null;

export type ParsedGitLabUrl = {
  host?: string;
  projectPath?: string;
  mrId?: number;
};

export const parseGitLabUrl = (input: string): ParsedGitLabUrl => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return {};
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.origin;
    const pathname = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

    // Match MR URL: <path>/-/merge_requests/<mr_id> or <path>/merge_requests/<mr_id>
    const mrMatch = pathname.match(
      /^(.*?)(?:\/-\/|\/)merge_requests\/(\d+)(?:[\/?#].*)?$/,
    );
    if (mrMatch) {
      return {
        host,
        projectPath: mrMatch[1],
        mrId: Number(mrMatch[2]),
      };
    }

    // Match general project URL: <path> (omitting tree/blob/issues if present)
    const projectMatch = pathname.match(
      /^(.*?)(?:\/-\/(?:tree|blob|issues|commits).*)?$/,
    );
    if (projectMatch && projectMatch[1]) {
      return {
        host,
        projectPath: projectMatch[1],
      };
    }

    return { host, projectPath: pathname };
  } catch {
    return {};
  }
};

export const initGitLab = (config: Config) => {
  const gitlab = config.providers?.gitlab ?? config.gitlab;
  if (!gitlab) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab configuration is required.",
      "Configure GitLab with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "gitlab", setupTool: "gitlab_set_config" },
    );
  }

  const { url, token, projectId: pid } = gitlab;
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
    const config = (global as any).__devtools_config;
    if (config?.providers?.gitlab?.enabled === false) {
      throw new ToolError(
        "CONFIG_REQUIRED",
        "GitLab is disabled in configuration.",
        "Enable providers.gitlab.enabled in .devtools/config.yaml, then retry this tool.",
        true,
        { configKey: "providers.gitlab.enabled" },
      );
    }
    initGitLab(config);
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
    "GitLab project identifier is required.",
    "Ask the user for the GitLab MR URL (e.g. https://gitlab.example.com/group/repo/-/merge_requests/123), project path (e.g. group/repo), or numeric project ID, then retry this tool with mr_url or project_id. Do not switch to local Git.",
    true,
    { parameter: "project_id", configKey: "gitlab.projectId" },
  );

export const resolveProjectId = (
  params: Record<string, unknown>,
  config: Config,
): string | number => {
  // Check mr_url or url parameter first
  const rawUrl =
    typeof params.mr_url === "string"
      ? params.mr_url
      : typeof params.url === "string"
        ? params.url
        : undefined;
  if (rawUrl) {
    const parsed = parseGitLabUrl(rawUrl);
    if (parsed.projectPath) return parsed.projectPath;
  }

  const id =
    params.project_id ??
    config.providers?.gitlab?.projectId ??
    config.gitlab?.projectId;
  if (id === undefined || id === null || id === "") {
    throw createProjectIdRequiredError();
  }

  if (typeof id === "string") {
    const trimmed = id.trim();
    if (!trimmed) throw createProjectIdRequiredError();
    // If it's a full URL passed into project_id, parse it
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const parsed = parseGitLabUrl(trimmed);
      if (parsed.projectPath) return parsed.projectPath;
    }
    // Clean leading/trailing slashes
    return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  }

  return id as number;
};

export const resolveMrId = (params: Record<string, unknown>): number => {
  if (
    params.mr_id !== undefined &&
    params.mr_id !== null &&
    params.mr_id !== ""
  ) {
    const num = Number(params.mr_id);
    if (!isNaN(num) && num > 0) return num;
  }

  const rawUrl =
    typeof params.mr_url === "string"
      ? params.mr_url
      : typeof params.url === "string"
        ? params.url
        : undefined;
  if (rawUrl) {
    const parsed = parseGitLabUrl(rawUrl);
    if (parsed.mrId) return parsed.mrId;
  }

  throw new ToolError(
    "GITLAB_MR_ID_REQUIRED",
    "A valid GitLab merge request ID is required.",
    "Ask the user for the numeric merge request IID or the full MR URL, then retry this tool with mr_id or mr_url.",
    true,
    { parameter: "mr_id" },
  );
};

export const getGitLabConfig = (config: Config) => {
  const gitlab = config.providers?.gitlab ?? config.gitlab;
  if (!gitlab) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitLab configuration is required.",
      "Configure GitLab with gitlab_set_config, then retry this tool.",
      true,
      { configKey: "gitlab", setupTool: "gitlab_set_config" },
    );
  }
  return gitlab;
};

export const getGitLabWebUrl = (
  config: Config,
  resolvedProjectId: string | number,
) => {
  const gitlab = config.providers?.gitlab ?? config.gitlab;
  const host = (gitlab?.url || "https://gitlab.com").replace(/\/+$/, "");
  return `${host}/${resolvedProjectId}`;
};
