import { describe, it, expect } from "vitest";
import {
  jsonMinifyTool,
  jsonFormatTool,
  jsonValidateTool,
} from "../../../../src/tools/json/index.js";

describe("json_minify", () => {
  it("should minify valid JSON", async () => {
    const result = await jsonMinifyTool.execute({
      json: `{ "name": "John", "age": 30 }`,
    });
    const output = result.content?.[0]?.text || "";
    expect(output).toBe('{"name":"John","age":30}');
  });

  it("should throw error on invalid JSON", async () => {
    await expect(
      jsonMinifyTool.execute({ json: "{ invalid }" }),
    ).rejects.toThrow("Invalid JSON");
  });

  it("should handle arrays", async () => {
    const result = await jsonMinifyTool.execute({ json: `[1, 2, 3]` });
    expect(result.content?.[0]?.text).toBe("[1,2,3]");
  });
});

describe("json_format", () => {
  it("should format JSON with default indent", async () => {
    const result = await jsonFormatTool.execute({
      json: `{"name":"John","age":30}`,
    });
    const output = result.content?.[0]?.text || "";
    expect(output).toBe(`{\n  "name": "John",\n  "age": 30\n}`);
  });

  it("should respect custom indent", async () => {
    const result = await jsonFormatTool.execute({
      json: `{"name":"John","age":30}`,
      indent: 4,
    });
    const output = result.content?.[0]?.text || "";
    expect(output).toBe(`{\n    "name": "John",\n    "age": 30\n}`);
  });

  it("should throw error on invalid JSON", async () => {
    await expect(
      jsonFormatTool.execute({ json: "{ invalid }" }),
    ).rejects.toThrow("Invalid JSON");
  });
});

describe("json_validate", () => {
  it("should validate valid JSON", async () => {
    const result = await jsonValidateTool.execute({ json: `{"name":"John"}` });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.type).toBe("object");
    expect(parsed.keys).toBe(1);
  });

  it("should validate valid array", async () => {
    const result = await jsonValidateTool.execute({ json: `[1,2,3]` });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.type).toBe("array");
    expect(parsed.length).toBe(3);
  });

  it("should report invalid JSON", async () => {
    const result = await jsonValidateTool.execute({ json: `{ invalid }` });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it("should handle empty input", async () => {
    const result = await jsonValidateTool.execute({ json: "" });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBe("Empty input");
  });
});

describe("json_minify", () => {
  it("should minify valid JSON", async () => {
    const result = await jsonMinifyTool.execute({
      json: `{ "name": "John", "age": 30 }`,
    });
    const output = result.content?.[0]?.text || "";
    expect(output).toBe('{"name":"John","age":30}');
  });

  it("should throw error on invalid JSON", async () => {
    await expect(
      jsonMinifyTool.execute({ json: "{ invalid }" }),
    ).rejects.toThrow("Invalid JSON");
  });

  it("should handle arrays", async () => {
    const result = await jsonMinifyTool.execute({ json: `[1, 2, 3]` });
    expect(result.content?.[0]?.text).toBe("[1,2,3]");
  });
});

describe("json_format", () => {
  it("should format JSON with default indent", async () => {
    const result = await jsonFormatTool.execute({
      json: `{"name":"John","age":30}`,
    });
    const output = result.content?.[0]?.text || "";
    expect(output).toBe(`{\n  "name": "John",\n  "age": 30\n}`);
  });

  it("should respect custom indent", async () => {
    const result = await jsonFormatTool.execute({
      json: `{"name":"John","age":30}`,
      indent: 4,
    });
    const output = result.content?.[0]?.text || "";
    expect(output).toBe(`{\n    "name": "John",\n    "age": 30\n}`);
  });

  it("should throw error on invalid JSON", async () => {
    await expect(
      jsonFormatTool.execute({ json: "{ invalid }" }),
    ).rejects.toThrow("Invalid JSON");
  });
});

describe("json_validate", () => {
  it("should validate valid JSON", async () => {
    const result = await jsonValidateTool.execute({ json: `{"name":"John"}` });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.type).toBe("object");
    expect(parsed.keys).toBe(1);
  });

  it("should validate valid array", async () => {
    const result = await jsonValidateTool.execute({ json: `[1,2,3]` });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(true);
    expect(parsed.type).toBe("array");
    expect(parsed.length).toBe(3);
  });

  it("should report invalid JSON", async () => {
    const result = await jsonValidateTool.execute({ json: `{ invalid }` });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it("should handle empty input", async () => {
    const result = await jsonValidateTool.execute({ json: "" });
    const output = result.content?.[0]?.text || "";
    const parsed = JSON.parse(output);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBe("Empty input");
  });
});
