import type { Config } from "./types.js";
import { getProviderConfig, type ProviderName } from "./provider-config.js";

/** Built-in blocked list, used when no `blocked_env` is configured anywhere. */
export const DEFAULT_BLOCKED_ENVS = ["production", "prod"];

/** Effective write policy for one provider. */
export type ResolvedSecurity = {
  allow_write: boolean;
  blocked_env: string[];
};

/**
 * A provider is enabled unless explicitly disabled, so `enabled: true` is redundant
 * and a missing key is permissive.
 */
export const isProviderEnabled = (
  config: Config,
  provider: ProviderName,
): boolean => getProviderConfig(config, provider)?.enabled !== false;

/**
 * Write gate. One meaning for every provider: a **grant**, denied by default, so a
 * missing or misspelled block fails closed.
 *
 * A provider-scoped block overrides the shared top-level one, which lets a policy be
 * set once and narrowed for a single provider where it differs.
 */
export const resolveAllowWrite = (
  config: Config,
  provider: ProviderName,
): boolean =>
  getProviderConfig(config, provider)?.security?.allow_write ??
  config.security?.allow_write ??
  false;

/**
 * Identifiers that may not write. Restrictive, so every level is consulted: the
 * provider block, the shared block, then the built-in default.
 *
 * The identifier is the connection name for `database` and `redis`, and the resolved
 * project path or ID for `gitlab`, the resolved `owner/name` repo for `github`.
 */
export const resolveBlockedEnvs = (
  config: Config,
  provider: ProviderName,
): string[] =>
  getProviderConfig(config, provider)?.security?.blocked_env ??
  config.security?.blocked_env ??
  DEFAULT_BLOCKED_ENVS;

/** The resolved policy for one provider, shared by the write gates and `show_config`. */
export const resolveSecurity = (
  config: Config,
  provider: ProviderName,
): ResolvedSecurity => ({
  allow_write: resolveAllowWrite(config, provider),
  blocked_env: resolveBlockedEnvs(config, provider),
});

/** One rule that can refuse a write on a single connection. */
export type WriteDenyReason =
  | "provider_disabled"
  | "connection_readonly"
  | "environment_blocked"
  | "no_grant";

/**
 * The effective write capability of one connection, and every rule that denies it.
 *
 * One resolver, used by the write gates and by `show_config`, because two descriptions of
 * the same policy drift apart: the gate would refuse a statement the config view called
 * permitted (or worse, allow one it called refused), and the reader would have no way to
 * tell which of the two was lying.
 */
export type ConnectionWritePolicy = {
  can_write: boolean;
  /** Every applicable deny, most specific first. Empty when `can_write`. */
  denied_by: WriteDenyReason[];
  /** What decided it: the connection name, or the `blocked_env` entry that matched. */
  detail?: string;
};

export const resolveConnectionWrite = (
  config: Config,
  provider: ProviderName,
  identifier: string,
  readonlyConnection: boolean | undefined,
): ConnectionWritePolicy => {
  const denied_by: WriteDenyReason[] = [];
  let detail: string | undefined;

  // An explicit per-connection `readonly: true` is the stated intent, so it heads the
  // list: it is the reason a reader is most likely to have forgotten about.
  if (readonlyConnection === true) {
    denied_by.push("connection_readonly");
    detail = String(identifier);
  }

  const blocked = findBlockedEnvironment(config, provider, identifier);
  if (blocked !== undefined) {
    denied_by.push("environment_blocked");
    detail = detail ?? blocked;
  }

  if (!resolveAllowWrite(config, provider)) denied_by.push("no_grant");
  if (!isProviderEnabled(config, provider)) denied_by.push("provider_disabled");

  return denied_by.length === 0
    ? { can_write: true, denied_by }
    : { can_write: false, denied_by, detail };
};

/**
 * Match an identifier against the provider's blocked list, case-insensitively on both
 * sides. Returns the offending entry as a string, or `undefined` when it is allowed.
 * Entries are stringified because the parsed YAML is unvalidated.
 */
export const findBlockedEnvironment = (
  config: Config,
  provider: ProviderName,
  identifier: string,
): string | undefined => {
  const haystack = String(identifier).toLowerCase();
  const match = resolveBlockedEnvs(config, provider).find((entry) =>
    haystack.includes(String(entry).toLowerCase()),
  );
  return match === undefined ? undefined : String(match);
};
