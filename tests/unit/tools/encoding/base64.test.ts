import { describe, it, expect } from "vitest";
import {
  base64EncodeTool,
  base64DecodeTool,
} from "../../../../src/tools/encoding/base64.js";

describe("base64_encode", () => {
  it("should encode a string to Base64", async () => {
    const result = await base64EncodeTool.execute({ text: "Hello World" });
    expect(result.content?.[0]?.text).toBe("SGVsbG8gV29ybGQ=");
  });

  it("should handle empty string", async () => {
    const result = await base64EncodeTool.execute({ text: "" });
    expect(result.content?.[0]?.text).toBe("");
  });

  it("should handle special characters", async () => {
    const result = await base64EncodeTool.execute({ text: "Héllo 世界" });
    const encoded = result.content?.[0]?.text;
    expect(encoded).toBeTruthy();

    const decoded = Buffer.from(encoded!, "base64").toString("utf-8");
    expect(decoded).toBe("Héllo 世界");
  });
});

describe("base64_decode", () => {
  it("should decode Base64 to string", async () => {
    const result = await base64DecodeTool.execute({
      encoded: "SGVsbG8gV29ybGQ=",
    });
    expect(result.content?.[0]?.text).toBe("Hello World");
  });

  it("should throw error on invalid Base64", async () => {
    await expect(
      base64DecodeTool.execute({ encoded: "invalid!!!" }),
    ).rejects.toThrow("Invalid Base64 string"); // Updated to match new error message
  });

  it("should handle empty encoded string", async () => {
    const result = await base64DecodeTool.execute({ encoded: "" });
    expect(result.content?.[0]?.text).toBe("");
  });
});
