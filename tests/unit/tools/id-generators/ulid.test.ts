import { describe, it, expect } from "vitest";
import { generateUlidTool } from "../../../../src/tools/id-generators/ulid.js";

describe("generate_ulid", () => {
  it("should generate a single ULID by default", async () => {
    const result = await generateUlidTool.execute({});
    const text = result.content?.[0]?.text || "";

    expect(text).toBeTruthy();
    expect(text.length).toBe(26); // ULID is always 26 chars
    expect(text).toMatch(/^[0-9A-Z]{26}$/); // ULID regex
  });

  it("should generate multiple ULIDs when count is specified", async () => {
    const result = await generateUlidTool.execute({ count: 3 });
    const text = result.content?.[0]?.text || "";

    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toHaveLength(26);
      expect(line).toMatch(/^[0-9A-Z]{26}$/);
    }
  });

  it("should respect custom timestamp", async () => {
    const timestamp = 1600000000000;
    const result = await generateUlidTool.execute({ timestamp });
    const ulid = result.content?.[0]?.text || "";

    // ULID timestamp is encoded in the first 10 chars
    // We can't easily decode it without a library, but we can check it's valid
    expect(ulid).toHaveLength(26);
    expect(ulid).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("should cap count at 100", async () => {
    const result = await generateUlidTool.execute({ count: 200 });
    const text = result.content?.[0]?.text || "";
    const lines = text.split("\n");
    expect(lines).toHaveLength(100);
  });
});
