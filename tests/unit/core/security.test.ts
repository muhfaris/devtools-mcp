import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOCKED_ENVS,
  findBlockedEnvironment,
  isProviderEnabled,
  resolveAllowWrite,
  resolveBlockedEnvs,
  resolveSecurity,
} from "../../../src/core/security.js";
import type { Config } from "../../../src/core/types.js";

const config = (value: unknown): Config => value as Config;

const PROVIDERS = ["database", "gitlab", "redis"] as const;

const providerScoped = (provider: string, security: Record<string, unknown>) =>
  config({ providers: { [provider]: { security } } });

describe("isProviderEnabled", () => {
  it("treats an absent providers block as enabled", () => {
    expect(isProviderEnabled(config({}), "redis")).toBe(true);
  });

  it.each(PROVIDERS)("only an explicit false disables %s", (provider) => {
    expect(isProviderEnabled(config({ providers: { [provider]: {} } }), provider)).toBe(true);
    expect(
      isProviderEnabled(config({ providers: { [provider]: { enabled: true } } }), provider),
    ).toBe(true);
    expect(
      isProviderEnabled(config({ providers: { [provider]: { enabled: false } } }), provider),
    ).toBe(false);
  });
});

describe("resolveAllowWrite", () => {
  it.each(PROVIDERS)("denies %s when nothing is configured", (provider) => {
    expect(resolveAllowWrite(config({}), provider)).toBe(false);
  });

  it.each(PROVIDERS)("grants %s from the provider-scoped block", (provider) => {
    expect(
      resolveAllowWrite(providerScoped(provider, { allow_write: true }), provider),
    ).toBe(true);
  });

  it.each(PROVIDERS)("grants %s from the shared block", (provider) => {
    expect(resolveAllowWrite(config({ security: { allow_write: true } }), provider)).toBe(
      true,
    );
  });

  it.each(PROVIDERS)(
    "lets the provider-scoped block override the shared block for %s",
    (provider) => {
      const narrowed = config({
        security: { allow_write: true },
        providers: { [provider]: { security: { allow_write: false } } },
      });
      expect(resolveAllowWrite(narrowed, provider)).toBe(false);

      const widened = config({
        security: { allow_write: false },
        providers: { [provider]: { security: { allow_write: true } } },
      });
      expect(resolveAllowWrite(widened, provider)).toBe(true);
    },
  );

  it.each(PROVIDERS)("treats a null value as absent for %s", (provider) => {
    const nulled = config({
      security: { allow_write: true },
      providers: { [provider]: { security: { allow_write: null } } },
    });
    expect(resolveAllowWrite(nulled, provider)).toBe(true);
  });
});

describe("resolveBlockedEnvs", () => {
  it.each(PROVIDERS)("falls back to the built-in default for %s", (provider) => {
    expect(resolveBlockedEnvs(config({}), provider)).toEqual(DEFAULT_BLOCKED_ENVS);
  });

  it.each(PROVIDERS)("inherits the shared list for %s", (provider) => {
    expect(resolveBlockedEnvs(config({ security: { blocked_env: ["staging"] } }), provider))
      .toEqual(["staging"]);
  });

  it.each(PROVIDERS)(
    "lets a provider-scoped list win, including an empty one, for %s",
    (provider) => {
      const scoped = config({
        security: { blocked_env: ["production"] },
        providers: { [provider]: { security: { blocked_env: [] } } },
      });
      expect(resolveBlockedEnvs(scoped, provider)).toEqual([]);
    },
  );

});

describe("resolveSecurity", () => {
  it.each(PROVIDERS)(
    "agrees with the individual resolvers for %s",
    (provider) => {
      const both = config({
        security: { allow_write: true, blocked_env: ["staging"] },
        providers: { [provider]: { security: { blocked_env: ["canary"] } } },
      });
      expect(resolveSecurity(both, provider)).toEqual({
        allow_write: resolveAllowWrite(both, provider),
        blocked_env: resolveBlockedEnvs(both, provider),
      });
      expect(resolveSecurity(both, provider)).toEqual({
        allow_write: true,
        blocked_env: ["canary"],
      });
    },
  );

  it.each(PROVIDERS)("denies by default for %s", (provider) => {
    expect(resolveSecurity(config({}), provider)).toEqual({
      allow_write: false,
      blocked_env: DEFAULT_BLOCKED_ENVS,
    });
  });
});

describe("findBlockedEnvironment", () => {
  it("matches a blocked entry anywhere in the connection name", () => {
    expect(findBlockedEnvironment(config({}), "database", "prod-replica")).toBe("prod");
    expect(findBlockedEnvironment(config({}), "redis", "dev-production")).toBe(
      "production",
    );
    expect(findBlockedEnvironment(config({}), "database", "dev")).toBeUndefined();
  });

  it("matches case-insensitively on both sides", () => {
    const mixed = providerScoped("redis", { blocked_env: ["Production"] });
    expect(findBlockedEnvironment(mixed, "redis", "my-PRODUCTION-cache")).toBe(
      "Production",
    );
  });

  it("matches GitLab against the project path with the shared default list", () => {
    expect(findBlockedEnvironment(config({}), "gitlab", "group/production-app")).toBe(
      "production",
    );
    expect(findBlockedEnvironment(config({}), "gitlab", "group/product-catalog")).toBe(
      "prod",
    );
    expect(findBlockedEnvironment(config({}), "gitlab", "group/billing")).toBeUndefined();
  });

  it("honours an explicitly configured GitLab list", () => {
    const scoped = providerScoped("gitlab", { blocked_env: ["production"] });
    expect(findBlockedEnvironment(scoped, "gitlab", "group/production-app")).toBe(
      "production",
    );
    expect(findBlockedEnvironment(scoped, "gitlab", "group/product-catalog")).toBeUndefined();
  });

  it("handles non-string identifier and entry values without throwing", () => {
    const numeric = providerScoped("gitlab", { blocked_env: [42] });
    expect(findBlockedEnvironment(numeric, "gitlab", 1420 as unknown as string)).toBe("42");
  });
});

describe("regression: one grant plus blocked_env covers every provider", () => {
  it.each(["database", "redis"] as const)(
    "permits a dev connection and refuses prod-db for %s",
    (provider) => {
      const granted = config({
        security: { allow_write: true, blocked_env: ["prod"] },
      });

      expect(resolveSecurity(granted, provider)).toEqual({
        allow_write: true,
        blocked_env: ["prod"],
      });
      expect(findBlockedEnvironment(granted, provider, "dev")).toBeUndefined();
      expect(findBlockedEnvironment(granted, provider, "prod-db")).toBe("prod");
    },
  );
});
