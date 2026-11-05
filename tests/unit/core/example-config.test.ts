import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { findIgnoredKeys } from "../../../src/core/known-keys.js";

/**
 * The committed example is the only full config in the repository, so it is the file a
 * reader copies. If it names a key nothing reads, it teaches a guard that is not armed —
 * the exact failure `ignored_keys` exists to surface. These tests read the file itself,
 * so the example cannot drift out of step with the parser without failing here.
 */
const EXAMPLE_PATH = fileURLToPath(
  new URL("../../../.devtools/example.config.yaml", import.meta.url),
);
const config = parse(
  readFileSync(EXAMPLE_PATH, "utf-8"),
) as Record<string, unknown>;

const providers = config.providers as Record<string, Record<string, unknown>>;

/** Every string value in the document, with its path, for the secret checks. */
const stringEntries = (
  value: unknown,
  path = "",
): Array<{ path: string; value: string }> => {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      stringEntries(item, `${path}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      stringEntries(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
};

describe(".devtools/example.config.yaml", () => {
  it("only uses keys the server actually reads", () => {
    expect(findIgnoredKeys(config)).toEqual([]);
  });

  it("keeps every provider under providers.", () => {
    for (const key of ["database", "gitlab", "github", "redis"]) {
      expect(config).not.toHaveProperty(key);
    }
    expect(Object.keys(providers).sort()).toEqual([
      "database",
      "github",
      "gitlab",
      "redis",
    ]);
  });

  it("documents the github provider with placeholders, not credentials", () => {
    expect(providers.github).toMatchObject({
      enabled: true,
      url: "https://github.com",
      token: "${GITHUB_TOKEN}",
      repo: "owner/repo",
    });
  });

  it("holds no credential literals", () => {
    for (const { path, value } of stringEntries(config)) {
      expect(value, path).not.toMatch(/^(ghp_|github_pat_|glpat-)/);
      if (/(token|password|secret)/i.test(path)) {
        // A placeholder, a command, or nothing. A literal is a secret in the repo.
        expect(value, path).toMatch(/^(\$\{[^}]+\}|cmd:.*|)$/);
      }
    }
  });
});
