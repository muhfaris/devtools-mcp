import { afterEach, describe, expect, it } from "vitest";
import {
  generateIdTool,
  resolveIdFormat,
} from "../../../../src/tools/id-generators/id.js";
import { runTool } from "../../../helpers/tools-test-helper.js";
import { ToolError } from "../../../../src/core/errors.js";
import type { Config } from "../../../../src/core/types.js";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const config = (value: unknown): Config => value as Config;
const originalConfig = (global as any).__devtools_config;

afterEach(() => {
  (global as any).__devtools_config = originalConfig;
});

describe("resolveIdFormat", () => {
  it("defaults to ulid when unconfigured", () => {
    expect(resolveIdFormat(undefined)).toBe("ulid");
    expect(resolveIdFormat(config({}))).toBe("ulid");
    expect(resolveIdFormat(config({ id_generator: {} }))).toBe("ulid");
  });

  it("reads id_generator.default", () => {
    expect(resolveIdFormat(config({ id_generator: { default: "uuid" } }))).toBe("uuid");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(resolveIdFormat(config({ id_generator: { default: " UUID " } }))).toBe("uuid");
  });

  it("lets an explicit override win over the configured value", () => {
    const configured = config({ id_generator: { default: "uuid" } });
    expect(resolveIdFormat(configured, "ulid")).toBe("ulid");
  });

  it("rejects an unsupported format instead of silently falling back", () => {
    expect(() => resolveIdFormat(config({ id_generator: { default: "nanoid" } }))).toThrow(
      ToolError,
    );
    expect(() =>
      resolveIdFormat(config({ id_generator: { default: "nanoid" } })),
    ).toThrow(/Unsupported identifier format/);
  });
});

describe("generate_id", () => {
  it("generates a ULID by default", async () => {
    (global as any).__devtools_config = {};
    const output = await runTool(generateIdTool, {});
    expect(output).toMatch(ULID_PATTERN);
  });

  it("honours id_generator.default", async () => {
    (global as any).__devtools_config = { id_generator: { default: "uuid" } };
    const output = await runTool(generateIdTool, {});
    expect(output).toMatch(UUID_PATTERN);
  });

  it("lets the format parameter override the configuration", async () => {
    (global as any).__devtools_config = { id_generator: { default: "uuid" } };
    const output = await runTool(generateIdTool, { format: "ulid" });
    expect(output).toMatch(ULID_PATTERN);
  });

  it("generates the requested count on separate lines", async () => {
    (global as any).__devtools_config = {};
    const output = await runTool(generateIdTool, { count: 3 });
    const ids = output.split("\n");
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => ULID_PATTERN.test(id))).toBe(true);
  });

  it("caps the count at 100", async () => {
    (global as any).__devtools_config = {};
    const output = await runTool(generateIdTool, { count: 500 });
    expect(output.split("\n")).toHaveLength(100);
  });

  it("rejects an invalid configured format", async () => {
    (global as any).__devtools_config = { id_generator: { default: "nope" } };
    await expect(generateIdTool.execute({})).rejects.toMatchObject({
      code: "INVALID_ID_FORMAT",
      configKey: "id_generator.default",
      retryable: true,
    });
  });
});
