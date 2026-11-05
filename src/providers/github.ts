import { ToolError } from "../core/errors.js";
import type { Config } from "../core/types.js";
import { getProviderConfig } from "../core/provider-config.js";
import { GitHubRequestError } from "./github-error.js";

const DEFAULT_HOST = "https://github.com";
const DEFAULT_API = "https://api.github.com";
/** A call that never answers would hold the tool open; GitHub is not a local socket. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The REST base for a configured web host.
 *
 * `url` names the host the user browses, the same way GitLab's does, and the API location
 * is derived from it: github.com serves its API from `api.github.com`, while GitHub
 * Enterprise Server serves it from `/api/v3` on the same host. Making the caller write the
 * API URL would put that knowledge in every config file.
 */
export const githubApiBase = (url: string | undefined): string => {
  const host = (url || DEFAULT_HOST).replace(/\/+$/, "");
  if (host === DEFAULT_HOST || host === "https://www.github.com")
    return DEFAULT_API;
  return `${host}/api/v3`;
};

export type GitHubQuery = Record<string, string | number | boolean | undefined>;

export type GitHubRequest = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Path below the API base, beginning with `/`. */
  path: string;
  query?: GitHubQuery;
  body?: unknown;
  /** Media type, for endpoints that answer differently per `Accept`. */
  accept?: string;
};

/** One page helper: GitHub's ceiling is 100, and more than one page is never fetched. */
export const pageSize = (limit: unknown, fallback = 20): number =>
  Math.max(1, Math.min(Math.trunc(Number(limit)) || fallback, 100));

/** A full page is a truncation: GitHub fills it only when more items exist. */
export const pageIsFull = (returned: number, perPage: number): boolean =>
  returned >= perPage;

const errorEntryText = (entry: unknown): string => {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "message" in entry) {
    return typeof entry.message === "string" ? entry.message : "";
  }
  return "";
};

const messageFrom = (text: string, status: number): string => {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; errors?: unknown };
    const message =
      typeof parsed.message === "string" ? parsed.message : undefined;
    const errors = Array.isArray(parsed.errors)
      ? parsed.errors.map(errorEntryText).filter(Boolean).join("; ")
      : "";
    if (message && errors) return `${message} (${errors})`;
    if (message) return message;
  } catch {
    // Not JSON (a proxy error page, say); the text itself is the description.
  }
  return text.slice(0, 500) || `HTTP ${status}`;
};

const resetFrom = (header: string | null): string | undefined => {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
};

/** A REST client for one host and token. One `request` call, one HTTP call. */
export class GitHubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private urlFor(path: string, query: GitHubQuery = {}): URL {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${suffix}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request<T = unknown>(request: GitHubRequest): Promise<T> {
    const { response, text } = await this.send(request);

    // 204 is a successful delete: there is no body to parse.
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch (error: unknown) {
      throw new GitHubRequestError(
        response.status,
        "the response was not valid JSON",
        { cause: error },
      );
    }
  }

  /** For an endpoint that answers with a file body rather than JSON. */
  async requestText(request: GitHubRequest): Promise<string> {
    const { text } = await this.send(request);
    return text;
  }

  private async send(
    request: GitHubRequest,
  ): Promise<{ response: Response; text: string }> {
    let response: Response;
    try {
      response = await fetch(this.urlFor(request.path, request.query), {
        method: request.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: request.accept ?? "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "devtools-mcp",
          ...(request.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      throw new GitHubRequestError(
        0,
        timedOut
          ? `the request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : "the network request failed",
        { cause: error },
      );
    }

    const text = await response.text();

    if (!response.ok) {
      throw new GitHubRequestError(
        response.status,
        messageFrom(text, response.status),
        {
          rateLimited: response.headers.get("x-ratelimit-remaining") === "0",
          resetAt: resetFrom(response.headers.get("x-ratelimit-reset")),
        },
      );
    }

    return { response, text };
  }
}

let githubClient: GitHubClient | null = null;
/**
 * Identity of the configuration `githubClient` was built from, so a token or host changed
 * by live reload — or by `github_set_config` — takes effect without a restart.
 */
let clientFingerprint: string | null = null;

const githubConfig = (config: Config | undefined) =>
  getProviderConfig(config, "github");

const fingerprintOf = (
  github: { url?: string; token?: string } | undefined,
): string | null =>
  github ? [github.url ?? "", github.token ?? ""].join("\u0000") : null;

export type ParsedGitHubUrl = {
  host?: string;
  repo?: string;
  prId?: number;
};

/** `https://github.com/owner/repo/pull/123` → host, `owner/repo`, 123. */
export const parseGitHubUrl = (input: string): ParsedGitHubUrl => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return {};
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.origin;
    const pathname = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

    const prMatch = pathname.match(
      /^([^/]+\/[^/]+)\/pull\/(\d+)(?:[\/?#].*)?$/,
    );
    if (prMatch) {
      return { host, repo: prMatch[1], prId: Number(prMatch[2]) };
    }

    const repoMatch = pathname.match(
      /^([^/]+\/[^/]+)(?:\/(?:tree|blob|issues|commits|pulls)\/.*)?$/,
    );
    if (repoMatch) {
      return { host, repo: repoMatch[1] };
    }

    return { host };
  } catch {
    return {};
  }
};

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/name`, or `null` when the value is not that shape. */
export const normalizeRepo = (value: string): string | null => {
  let candidate = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (candidate.includes("://")) {
    candidate = parseGitHubUrl(candidate).repo ?? candidate;
  }
  // A clone URL (`git@github.com:owner/repo.git`) is a common paste; keep the pair.
  candidate = candidate.replace(/^.*@[^:]+:/, "").replace(/\.git$/, "");
  return REPO_PATTERN.test(candidate) ? candidate : null;
};

const createRepoRequiredError = () =>
  new ToolError(
    "GITHUB_REPO_REQUIRED",
    "A GitHub repository is required.",
    "Ask the user for the pull request URL (e.g. https://github.com/owner/repo/pull/123) or the repository as owner/name, then retry with pr_url or repo. Do not switch to a local git checkout.",
    true,
    { parameter: "repo", configKey: "providers.github.repo" },
  );

export const resolveRepo = (
  params: Record<string, unknown>,
  config: Config,
): string => {
  const rawUrl =
    typeof params.pr_url === "string"
      ? params.pr_url
      : typeof params.url === "string"
        ? params.url
        : undefined;
  if (rawUrl) {
    const parsed = parseGitHubUrl(rawUrl);
    if (parsed.repo) return parsed.repo;
  }

  const explicit = params.repo ?? params.project_id;
  for (const candidate of [explicit, githubConfig(config)?.repo]) {
    if (typeof candidate === "string" && candidate.trim()) {
      const normalized = normalizeRepo(candidate);
      if (normalized) return normalized;
    }
  }

  throw createRepoRequiredError();
};

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

export const resolvePrId = (params: Record<string, unknown>): number => {
  const rawExplicit = params.pr_id ?? params.pull_number ?? params.pr_number;
  const hasExplicit =
    rawExplicit !== undefined && rawExplicit !== null && rawExplicit !== "";
  const explicit = hasExplicit ? Number(rawExplicit) : undefined;

  const rawUrl =
    typeof params.pr_url === "string"
      ? params.pr_url
      : typeof params.url === "string"
        ? params.url
        : undefined;
  const urlPrId = rawUrl ? parseGitHubUrl(rawUrl).prId : undefined;

  if (explicit !== undefined && isPositiveInteger(explicit)) {
    if (urlPrId !== undefined && explicit !== urlPrId) {
      throw new ToolError(
        "GITHUB_PR_ID_MISMATCH",
        `pr_id ${explicit} does not match pull request ${urlPrId} in pr_url.`,
        `Retry with pr_id: ${urlPrId}, or omit pr_id and rely on pr_url.`,
        false,
        { parameter: "pr_id" },
      );
    }
    return explicit;
  }

  if (hasExplicit) {
    throw new ToolError(
      "GITHUB_PR_ID_INVALID",
      "pr_id must be a positive integer.",
      "Provide a positive integer pull request number, or omit pr_id and provide a full pr_url.",
      false,
      { parameter: "pr_id" },
    );
  }

  if (urlPrId) return urlPrId;

  throw new ToolError(
    "GITHUB_PR_ID_REQUIRED",
    "A pull request number is required.",
    "Ask the user for the pull request URL or number, then retry with pr_url or pr_id.",
    true,
    { parameter: "pr_id" },
  );
};

export const initGitHub = (config: Config) => {
  const github = githubConfig(config);
  if (!github) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitHub configuration is required.",
      "Configure GitHub with github_set_config, then retry this tool.",
      true,
      { configKey: "providers.github", setupTool: "github_set_config" },
    );
  }

  if (!github.token) {
    throw new ToolError(
      "GITHUB_TOKEN_REQUIRED",
      "A GitHub access token is required.",
      "Ask the user to configure a GitHub personal access token with github_set_config, then retry this tool.",
      true,
      { configKey: "providers.github.token", setupTool: "github_set_config" },
    );
  }

  githubClient = new GitHubClient(githubApiBase(github.url), github.token);
  clientFingerprint = fingerprintOf(github);
  return githubClient;
};

export const clearGitHub = () => {
  githubClient = null;
  clientFingerprint = null;
};

export const getGitHubClient = (): GitHubClient => {
  const config: Config | undefined = (global as any).__devtools_config;

  if (config?.providers?.github?.enabled === false) {
    clearGitHub();
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitHub is disabled in configuration.",
      "Enable providers.github.enabled in .devtools/config.yaml, then retry this tool.",
      true,
      { configKey: "providers.github.enabled" },
    );
  }

  // A long-running server can outlive its config: a reloaded file or a token supplied by
  // github_set_config must be used, not the client built from the previous values.
  if (githubClient && fingerprintOf(githubConfig(config)) !== clientFingerprint) {
    clearGitHub();
  }

  if (!githubClient) {
    initGitHub(config ?? {});
  }

  return githubClient!;
};

export const getGitHubConfig = (config: Config) => {
  const github = githubConfig(config);
  if (!github) {
    throw new ToolError(
      "CONFIG_REQUIRED",
      "GitHub configuration is required.",
      "Configure GitHub with github_set_config, then retry this tool.",
      true,
      { configKey: "providers.github", setupTool: "github_set_config" },
    );
  }
  return github;
};

export const getGitHubWebUrl = (config: Config, repo: string): string => {
  const host = (githubConfig(config)?.url || DEFAULT_HOST).replace(/\/+$/, "");
  return `${host}/${repo}`;
};
