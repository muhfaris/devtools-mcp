import { describe, it, expect } from "vitest";
import { semverBumpTool } from "../../../../src/tools/misc/semver.js";

describe("semver_bump", () => {
  it("should bump patch version", async () => {
    const result = await semverBumpTool.execute({
      version: "1.2.3",
      bump: "patch",
    });
    expect(result.content?.[0]?.text).toBe("1.2.4");
  });

  it("should bump minor version", async () => {
    const result = await semverBumpTool.execute({
      version: "1.2.3",
      bump: "minor",
    });
    expect(result.content?.[0]?.text).toBe("1.3.0");
  });

  it("should bump major version", async () => {
    const result = await semverBumpTool.execute({
      version: "1.2.3",
      bump: "major",
    });
    expect(result.content?.[0]?.text).toBe("2.0.0");
  });

  it("should bump prerelease from non-prerelease", async () => {
    const result = await semverBumpTool.execute({
      version: "1.2.3",
      bump: "prealpha",
    });
    expect(result.content?.[0]?.text).toBe("1.2.3-alpha.0");
  });

  it("should increment prerelease version", async () => {
    const result = await semverBumpTool.execute({
      version: "1.2.3-alpha.0",
      bump: "prealpha",
    });
    expect(result.content?.[0]?.text).toBe("1.2.3-alpha.1");
  });

  it("should throw error on invalid version format", async () => {
    await expect(
      semverBumpTool.execute({ version: "invalid", bump: "patch" }),
    ).rejects.toThrow("Invalid version format");
  });

  it("should throw error on invalid bump type", async () => {
    await expect(
      semverBumpTool.execute({ version: "1.2.3", bump: "invalid" }),
    ).rejects.toThrow("Invalid bump type");
  });
});
