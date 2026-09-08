import { describe, it, expect } from "vitest";
import { hashGenerateTool } from "../../../../src/tools/encoding/hash.js";

describe("hash_generate", () => {
  it("should generate SHA256 hash by default", async () => {
    const result = await hashGenerateTool.execute({ text: "hello" });
    const data = JSON.parse(result.content?.[0]?.text || "{}");

    expect(data.algorithm).toBe("sha256");
    expect(data.hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(data.length).toBe(64);
  });

  it("should generate MD5 hash", async () => {
    const result = await hashGenerateTool.execute({
      text: "hello",
      algorithm: "md5",
    });
    const data = JSON.parse(result.content?.[0]?.text || "{}");

    expect(data.algorithm).toBe("md5");
    expect(data.hash).toBe("5d41402abc4b2a76b9719d911017c592");
    expect(data.length).toBe(32);
  });

  it("should generate SHA1 hash", async () => {
    const result = await hashGenerateTool.execute({
      text: "hello",
      algorithm: "sha1",
    });
    const data = JSON.parse(result.content?.[0]?.text || "{}");

    expect(data.algorithm).toBe("sha1");
    expect(data.hash).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    expect(data.length).toBe(40);
  });

  it("should handle boolean algorithm by using default", async () => {
    const result = await hashGenerateTool.execute({
      text: "hello",
      algorithm: true,
    });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.algorithm).toBe("sha256");
  });

  it("should throw error on unsupported algorithm", async () => {
    await expect(
      hashGenerateTool.execute({ text: "hello", algorithm: "unsupported" }),
    ).rejects.toThrow("Unsupported algorithm: unsupported");
  });
});
