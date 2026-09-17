import type { Config } from "./types.js";

/** Providers that carry a `security` block. */
export type SecurityProvider = "database" | "gitlab" | "redis";

/** Built-in blocked list, used when neither the provider nor the legacy key sets one. */
export const DEFAULT_BLOCKED_ENVS = ["production", "prod"];

/** Nullish semantics: a bare YAML key parses to `null`, which `??` treats as absent. */
const defined = <T>(value: T | null | undefined): T | undefined =>
  value === undefined || value === null ? undefined : value;

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
 * Write gate. Two semantics coexist, and the difference is deliberate.
 *
 * - `database` is **grant-style**: writes are denied unless `allow_write: true`.
 *   Its original home was the shared `security.execute_query` block, which is still
 *   honoured as an alias because that block describes this same provider.
 * - `gitlab` and `redis` are **kill-switch style**: only an explicit `false` blocks.
 *   Both were writable before this key existed (`readonly: false` on a Redis
 *   connection, a GitLab token), so denying by default would break every existing
 *   configuration. A permissive key must never inherit from another provider, so
 *   `security.execute_query.allow_write` is deliberately not consulted for them.
 */
export const resolveAllowWrite = (
  config: Config,
  provider: SecurityProvider,
): boolean => {
  const scoped = defined(providerConfig(config, provider)?.security?.allow_write);
  if (scoped !== undefined) return scoped;

  if (provider === "database") {
    return config.security?.execute_query?.allow_write ?? false;
  }

  return true;
};

/**
 * Whether a provider inherits the shared/legacy `blocked_env` list.
 *
 * GitLab opts out: it matches `blocked_env` against project paths, where a default of
 * `["production", "prod"]` would silently block any project whose path merely contains
 * "prod". Every other provider matches connection names, where those defaults are the
 * long-standing behaviour.
 */
export const inheritsLegacyBlockedEnvs = (
  provider: SecurityProvider,
): boolean => provider !== "gitlab";

/**
 * Blocked environment names.
 *
 * `blocked_env` is restrictive, so inheriting it can only ever block more: the
 * provider-scoped list wins, then the legacy shared block, then the built-in default.
 * Providers that do not inherit (see `inheritsLegacyBlockedEnvs`) resolve to `[]`
 * unless they declare their own list.
 */
export const resolveBlockedEnvs = (
  config: Config,
  provider: SecurityProvider,
): string[] => {
  const scoped = defined(providerConfig(config, provider)?.security?.blocked_env);
  if (scoped !== undefined) return scoped;
  if (!inheritsLegacyBlockedEnvs(provider)) return [];
  return config.security?.execute_query?.blocked_env ?? DEFAULT_BLOCKED_ENVS;
};

/**
 * Match an identifier against the blocked list, case-insensitively on both sides.
 * Returns the offending entry as a string, or `undefined` when the identifier is
 * allowed. Entries are stringified because the parsed YAML is unvalidated.
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
