import { describe, it, expect } from "vitest";
import { slugifyTool } from "../../../../src/tools/misc/slugify.js";

describe("slugify", () => {
  it("should convert text to slug", async () => {
    const result = await slugifyTool.execute({ text: "Hello World!" });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.slug).toBe("hello-world");
  });

  it("should handle special characters", async () => {
    const result = await slugifyTool.execute({
      text: "Héllo Wörld! 100% Awesome",
    });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.slug).toBe("hello-world-100-awesome");
  });

  it("should respect custom separator", async () => {
    const result = await slugifyTool.execute({
      text: "Hello World",
      separator: "_",
    });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.slug).toBe("hello_world");
  });

  it("should preserve case when lowercase is false", async () => {
    const result = await slugifyTool.execute({
      text: "Hello World",
      lowercase: false,
    });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.slug).toBe("Hello-World");
  });
});
