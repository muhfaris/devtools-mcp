import { describe, it, expect } from "vitest";
import { jsonToTypesTool } from "../../../../src/tools/json/to-types.js";

const run = async (params: Record<string, any>) =>
  (await jsonToTypesTool.execute(params)).content?.[0]?.text || "";

describe("json_to_types", () => {
  it("should generate a TypeScript interface for a simple object", async () => {
    const out = await run({
      json: `{"name":"John","age":30}`,
    });
    expect(out).toContain("interface Root");
    expect(out).toContain("name: string");
    expect(out).toContain("age: number");
  });

  it("should generate a Go struct by default naming", async () => {
    const out = await run({
      json: `{"id":1,"active":true}`,
      targetLanguage: "go",
    });
    expect(out).toContain("type Root struct");
    expect(out).toContain("Id float64");
    expect(out).toContain("Active bool");
  });

  it("should generate a Python pydantic model", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "python",
    });
    expect(out).toContain("class Root(BaseModel)");
    expect(out).toContain("name: str");
  });

  it("should generate a PHP class", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "php",
    });
    expect(out).toContain("class Root");
    expect(out).toContain("public readonly string $name");
  });

  it("should generate a Rust struct", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "rust",
    });
    expect(out).toContain("struct Root");
    expect(out).toContain("name: String");
  });

  it("should generate a Kotlin data class", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "kotlin",
    });
    expect(out).toContain("data class Root(");
    expect(out).toContain("val name: String");
  });

  it("should generate a C# record", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "csharp",
    });
    expect(out).toContain("public record Root");
    expect(out).toContain("[property: JsonPropertyName(\"name\")] string name");
  });

  it("should generate a Zod schema", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "zod",
    });
    expect(out).toContain("RootSchema");
    expect(out).toContain("z.object");
  });

  it("should generate JSON Schema", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      targetLanguage: "json_schema",
    });
    expect(out).toContain('"type": "object"');
  });

  it("should extract a named type for nested object arrays", async () => {
    const out = await run({
      json: `{"items":[{"sku":"a","qty":2}]}`,
      targetLanguage: "typescript",
    });
    expect(out).toContain("interface RootItems");
    expect(out).toContain("items: RootItems[]");
  });

  it("should respect rootName param", async () => {
    const out = await run({
      json: `{"name":"John"}`,
      rootName: "User",
    });
    expect(out).toContain("interface User");
  });

  it("should read JSON from a file path", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = path.join(os.tmpdir(), `to-types-${Date.now()}.json`);
    fs.writeFileSync(tmp, `{"name":"John"}`);
    try {
      const out = await run({ filePath: tmp, targetLanguage: "typescript" });
      expect(out).toContain("name: string");
    } finally {
      fs.rmSync(tmp);
    }
  });

  it("should detect optional fields", async () => {
    const out = await run({
      json: `[{"a":1},{"a":1,"b":2}]`,
      targetLanguage: "typescript",
    });
    expect(out).toContain("b?: number");
  });
});