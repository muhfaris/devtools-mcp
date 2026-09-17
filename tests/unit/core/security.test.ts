import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOCKED_ENVS,
  findBlockedEnvironment,
  inheritsLegacyBlockedEnvs,
  isProviderEnabled,
  resolveAllowWrite,
  resolveBlockedEnvs,
} from "../../../src/core/security.js";
import type { Config } from "../../../src/core/types.js";

const config = (value: unknown): Config => value as Config;

const legacy = (execute_query: Record<string, unknown>) =>
  ({ security: { execute_query } }) as unknown as Config;

describe("isProviderEnabled", () => {
  it("treats an absent providers block as enabled", () => {
    expect(isProviderEnabled(config({}), "redis")).toBe(true);
  });

  it.each(["database", "gitlab", "redis"] as const)(
    "only an explicit false disables %s",
    (provider) => {
      expect(isProviderEnabled(config({ providers: { [provider]: {} } }), provider)).toBe(true);
      expect(
        isProviderEnabled(config({ providers: { [provider]: { enabled: true } } }), provider),
      ).toBe(true);
      expect(
        isProviderEnabled(config({ providers: { [provider]: { enabled: false } } }), provider),
      ).toBe(false);
    },
  );
});

describe("resolveAllowWrite", () => {
  describe("database (grant-style, deny by default)", () => {
    it("denies when nothing is configured", () => {
      expect(resolveAllowWrite(config({}), "database")).toBe(false);
    });

    it("honours the legacy security.execute_query.allow_write alias", () => {
      expect(resolveAllowWrite(legacy({ allow_write: true }), "database")).toBe(true);
    });

    it("lets a provider-scoped value win over the legacy alias", () => {
      const denied = config({
        providers: { database: { security: { allow_write: false } } },
        security: { execute_query: { allow_write: true } },
      });
      expect(resolveAllowWrite(denied, "database")).toBe(false);

      const granted = config({
        providers: { database: { security: { allow_write: true } } },
        security: { execute_query: { allow_write: false } },
      });
      expect(resolveAllowWrite(granted, "database")).toBe(true);
    });

    it("treats a null value as absent, matching ?? semantics", () => {
      const nulled = config({
        providers: { database: { security: { allow_write: null } } },
        security: { execute_query: { allow_write: true } },
      });
      expect(resolveAllowWrite(nulled, "database")).toBe(true);
    });
  });

  describe("gitlab and redis (kill-switch, permissive by default)", () => {
    it.each(["gitlab", "redis"] as const)("permits %s when unset", (provider) => {
      expect(resolveAllowWrite(config({}), provider)).toBe(true);
    });

    it.each(["gitlab", "redis"] as const)(
      "blocks %s only on an explicit false",
      (provider) => {
        expect(
          resolveAllowWrite(config({ providers: { [provider]: { security: { allow_write: false } } } }), provider),
        ).toBe(false);
        expect(
          resolveAllowWrite(config({ providers: { [provider]: { security: { allow_write: true } } } }), provider),
        ).toBe(true);
      },
    );

    it.each(["gitlab", "redis"] as const)(
      "never inherits the database allow_write alias for %s",
      (provider) => {
        expect(resolveAllowWrite(legacy({ allow_write: true }), provider)).toBe(true);
        expect(resolveAllowWrite(legacy({ allow_write: false }), provider)).toBe(true);
      },
    );
  });
});

describe("resolveBlockedEnvs", () => {
  it("falls back to the built-in default", () => {
    expect(resolveBlockedEnvs(config({}), "database")).toEqual(DEFAULT_BLOCKED_ENVS);
    expect(resolveBlockedEnvs(config({}), "redis")).toEqual(DEFAULT_BLOCKED_ENVS);
  });

  it("inherits the legacy shared list", () => {
    expect(resolveBlockedEnvs(legacy({ blocked_env: ["staging"] }), "database")).toEqual([
      "staging",
    ]);
  });

  it("lets a provider-scoped list win, including an empty one", () => {
    const scoped = config({
      providers: { redis: { security: { blocked_env: [] } } },
      security: { execute_query: { blocked_env: ["production"] } },
    });
    expect(resolveBlockedEnvs(scoped, "redis")).toEqual([]);
  });

  it("does not inherit for GitLab", () => {
    expect(inheritsLegacyBlockedEnvs("gitlab")).toBe(false);
    expect(inheritsLegacyBlockedEnvs("database")).toBe(true);
    expect(resolveBlockedEnvs(legacy({ blocked_env: ["production"] }), "gitlab")).toEqual([]);
    expect(resolveBlockedEnvs(config({}), "gitlab")).toEqual([]);
  });

  it("still honours an explicitly configured GitLab list", () => {
    const scoped = config({ providers: { gitlab: { security: { blocked_env: ["prod"] } } } });
    expect(resolveBlockedEnvs(scoped, "gitlab")).toEqual(["prod"]);
  });
});

describe("findBlockedEnvironment", () => {
  it("matches a blocked entry anywhere in the connection name", () => {
    expect(findBlockedEnvironment(config({}), "database", "prod-replica")).toBe("prod");
    expect(findBlockedEnvironment(config({}), "redis", "dev-production")).toBe("production");
    expect(findBlockedEnvironment(config({}), "database", "dev")).toBeUndefined();
  });

  it("matches case-insensitively on both sides", () => {
    const mixed = config({ providers: { redis: { security: { blocked_env: ["Production"] } } } });
    expect(findBlockedEnvironment(mixed, "redis", "my-PRODUCTION-cache")).toBe("Production");
  });

  it("does not block GitLab project paths unless configured", () => {
    expect(
      findBlockedEnvironment(config({}), "gitlab", "group/product-catalog"),
    ).toBeUndefined();

    const scoped = config({
      providers: { gitlab: { security: { blocked_env: ["production"] } } },
    });
    expect(findBlockedEnvironment(scoped, "gitlab", "group/production-app")).toBe(
      "production",
    );
    expect(findBlockedEnvironment(scoped, "gitlab", "group/product-catalog")).toBeUndefined();
  });

  it("handles non-string identifier and entry values without throwing", () => {
    const numeric = config({ providers: { gitlab: { security: { blocked_env: [42] } } } });
    expect(findBlockedEnvironment(numeric, "gitlab", 1420 as unknown as string)).toBe("42");
  });
});
