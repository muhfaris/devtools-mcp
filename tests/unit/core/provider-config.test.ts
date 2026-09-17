import { describe, expect, it } from "vitest";
import {
  getProviderConfig,
  isProviderConfigured,
} from "../../../src/core/provider-config.js";
import type { Config } from "../../../src/core/types.js";

const config = (value: unknown): Config => value as Config;

/**
 * The shape that used to be read. Kept verbatim, untyped, to prove it no longer is:
 * the removal of the top-level keys is only real if these are ignored.
 */
const legacyShaped = () =>
  config({
    database: {
      default_engine: "postgresql",
      connections: { dev: { dsn: "postgresql://localhost/dev" } },
    },
    gitlab: { url: "https://gitlab.com", token: "token", projectId: 1 },
    redis: { connections: { dev: { url: "redis://localhost" } } },
  });

describe("getProviderConfig", () => {
  it.each(["database", "gitlab", "redis"] as const)(
    "returns the providers.%s block",
    (provider) => {
      const block = { marker: provider };
      expect(
        getProviderConfig(config({ providers: { [provider]: block } }), provider),
      ).toBe(block);
    },
  );

  it("returns undefined when the provider has no block", () => {
    expect(getProviderConfig(config({}), "redis")).toBeUndefined();
    expect(getProviderConfig(undefined, "redis")).toBeUndefined();
  });

  it("does not read a top-level provider key", () => {
    expect(getProviderConfig(legacyShaped(), "database")).toBeUndefined();
    expect(getProviderConfig(legacyShaped(), "gitlab")).toBeUndefined();
    expect(getProviderConfig(legacyShaped(), "redis")).toBeUndefined();
  });
});

describe("isProviderConfigured", () => {
  it("is true only when a providers block exists", () => {
    expect(isProviderConfigured(config({ providers: { gitlab: {} } }), "gitlab")).toBe(
      true,
    );
    expect(isProviderConfigured(config({}), "gitlab")).toBe(false);
  });

  it("counts a disabled provider as configured, unlike isProviderEnabled", () => {
    expect(
      isProviderConfigured(config({ providers: { redis: { enabled: false } } }), "redis"),
    ).toBe(true);
  });

  it("is false for every legacy top-level key", () => {
    expect(isProviderConfigured(legacyShaped(), "database")).toBe(false);
    expect(isProviderConfigured(legacyShaped(), "gitlab")).toBe(false);
    expect(isProviderConfigured(legacyShaped(), "redis")).toBe(false);
  });
});
