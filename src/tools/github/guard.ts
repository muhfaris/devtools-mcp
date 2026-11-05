import type { Config } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";
import { isProviderConfigured } from "../../core/provider-config.js";
import {
  findBlockedEnvironment,
  resolveAllowWrite,
} from "../../core/security.js";
import { resolvePrId, resolveRepo } from "../../providers/github.js";

export type RepoTarget = { repo: string; config: Config };
export type PullTarget = RepoTarget & { prId: number };

/**
 * The checks every GitHub tool shares, ordered so the caller gets the cheapest failure
 * first: is GitHub configured, is it switched on. Returns the runtime config the
 * resolution helpers read.
 */
const assertGitHubConfigured = (): Config => {
  const config: Config | undefined = (global as any).__devtools_config;

  if (config?.providers?.github?.enabled === false) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitHub is disabled in configuration.",
      "Enable providers.github.enabled in .devtools/config.yaml, then retry this tool.",
      true,
      { configKey: "providers.github.enabled" },
    );
  }
  if (!isProviderConfigured(config, "github")) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitHub configuration is required.",
      "Configure GitHub with github_set_config, then retry this tool.",
      true,
      { configKey: "providers.github", setupTool: "github_set_config" },
    );
  }

  return config as Config;
};

/** A read target: the provider is configured, and a repository can be resolved. */
export const assertGitHubReadable = (
  params: Record<string, unknown>,
): RepoTarget => {
  const config = assertGitHubConfigured();
  return { repo: resolveRepo(params, config), config };
};

/**
 * The write gate. GitHub has no environment concept, so `blocked_env` is matched against
 * the resolved `owner/name` repo instead — the same rule GitLab applies to a project path.
 */
export const assertGitHubWriteAllowed = (
  params: Record<string, unknown>,
): RepoTarget => {
  const config = assertGitHubConfigured();

  if (!resolveAllowWrite(config, "github")) {
    throw new ToolError(
      "GITHUB_WRITE_DISABLED",
      "GitHub write operations are disabled.",
      "Ask the user to set `providers.github.security.allow_write: true` (or the top-level `security.allow_write`) in .devtools/config.yaml, then retry this tool.",
      true,
      { configKey: "providers.github.security.allow_write" },
    );
  }

  const repo = resolveRepo(params, config);

  const blockedEnv = findBlockedEnvironment(config, "github", repo);
  if (blockedEnv) {
    throw new ToolError(
      "GITHUB_ENVIRONMENT_BLOCKED",
      `GitHub writes are blocked for repository "${repo}" — it matches the blocked_env entry "${blockedEnv}".`,
      "Choose a repository that is not listed in providers.github.security.blocked_env; do not retry against this repository.",
      false,
      { configKey: "providers.github.security.blocked_env" },
    );
  }

  return { repo, config };
};

/** The write guard, plus the pull request the operation applies to. */
export const assertPullWriteAllowed = (
  params: Record<string, unknown>,
): PullTarget => {
  const { repo, config } = assertGitHubWriteAllowed(params);
  return { repo, prId: resolvePrId(params), config };
};

/** A required text argument has to carry something besides whitespace. */
export const requireText = (
  params: Record<string, unknown>,
  name: string,
): string => {
  const raw = params[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `${name} is required.`,
      `Provide a non-empty ${name}, then retry this tool.`,
      true,
      { parameter: name },
    );
  }
  return value;
};
