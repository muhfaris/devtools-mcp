import type { Config } from "./types.js";

/** Providers that carry a `security` block. */
export type SecurityProvider = "database" | "gitlab" | "redis";

/** Built-in blocked list, used when no `blocked_env` is configured anywhere. */
export const DEFAULT_BLOCKED_ENVS = ["production", "prod"];

/** Effective write policy for one provider. */
export type ResolvedSecurity = {
  allow_write: boolean;
  blocked_env: string[];
};

const providerConfig = (config: Config, provider: SecurityProvider) => {
  const providers = config.providers;
  if (!providers) return undefined;
  return providers[provider];
};

/**
 * A provider is enabled unless explicitly disabled, so `enabled: true` is redundant
 * and a missing key is permissive.
 */
export const isProviderEnabled = (
  config: Config,
  provider: SecurityProvider,
): boolean => providerConfig(config, provider)?.enabled !== false;

/**
 * Write gate. One meaning for every provider: a **grant**, denied by default, so a
 * missing or misspelled block fails closed.
 *
 * A provider-scoped block overrides the shared top-level one, which lets a policy be
 * set once and narrowed for a single provider where it differs.
 */
export const resolveAllowWrite = (
  config: Config,
  provider: SecurityProvider,
): boolean =>
  providerConfig(config, provider)?.security?.allow_write ??
  config.security?.allow_write ??
  // Deprecated location, honoured for one release.
  config.security?.execute_query?.allow_write ??
  false;

/**
 * Identifiers that may not write. Restrictive, so every level is consulted: the
 * provider block, the shared block, the deprecated alias, then the built-in default.
 *
 * The identifier is the connection name for `database` and `redis`, and the resolved
 * project path or ID for `gitlab`.
 */
export const resolveBlockedEnvs = (
  config: Config,
  provider: SecurityProvider,
): string[] =>
  providerConfig(config, provider)?.security?.blocked_env ??
  config.security?.blocked_env ??
  config.security?.execute_query?.blocked_env ??
  DEFAULT_BLOCKED_ENVS;

/** The resolved policy for one provider, shared by the write gates and `show_config`. */
export const resolveSecurity = (
  config: Config,
  provider: SecurityProvider,
): ResolvedSecurity => ({
  allow_write: resolveAllowWrite(config, provider),
  blocked_env: resolveBlockedEnvs(config, provider),
});

/**
 * Match an identifier against the provider's blocked list, case-insensitively on both
 * sides. Returns the offending entry as a string, or `undefined` when it is allowed.
 * Entries are stringified because the parsed YAML is unvalidated.
 */
export const findBlockedEnvironment = (
  config: Config,
  provider: SecurityProvider,
  identifier: string,
): string | undefined => {
  const haystack = String(identifier).toLowerCase();
  const match = resolveBlockedEnvs(config, provider).find((entry) =>
    haystack.includes(String(entry).toLowerCase()),
  );
  return match === undefined ? undefined : String(match);
};

