import type { Config, ProvidersConfig } from "./types.js";

/**
 * The providers that live under `providers.*`. One union for the whole codebase:
 * the security gates resolve writes by it and the tools use it to find their config.
 */
export type ProviderName = "database" | "gitlab" | "redis";

/**
 * The single place that knows where a provider's config lives.
 *
 * The shape is `providers.<name>` and nowhere else. A top-level `database` / `gitlab`
 * / `redis` block is not a legacy spelling, it is simply not read.
 */
export const getProviderConfig = <P extends ProviderName>(
  config: Config | undefined,
  provider: P,
): ProvidersConfig[P] => config?.providers?.[provider];

/**
 * Whether a provider has a config block at all — distinct from `enabled: false`, which
 * means configured but switched off.
 */
export const isProviderConfigured = (
  config: Config | undefined,
  provider: ProviderName,
): boolean => getProviderConfig(config, provider) !== undefined;
