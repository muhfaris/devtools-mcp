import { describe, it, expect } from "vitest";
import { generateUuidTool } from "../../../../src/tools/id-generators/uuid.js";

describe("generate_uuid", () => {
  it("should generate a single UUID v4 by default", async () => {
    const result = await generateUuidTool.execute({});
    const uuid = result.content?.[0]?.text || "";

    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("should generate multiple UUIDs", async () => {
    const result = await generateUuidTool.execute({ count: 3 });
    const lines = result.content?.[0]?.text?.split("\n") || [];

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("should cap count at 100", async () => {
    const result = await generateUuidTool.execute({ count: 200 });
    const lines = result.content?.[0]?.text?.split("\n") || [];
    expect(lines).toHaveLength(100);
  });
});
