import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/core/registry.js";
import type { Tool, ToolParams } from "../../../src/core/types.js";

describe("ToolRegistry", () => {
  it("should register a tool", () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      name: "test_tool",
      description: "A test tool",
      execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
    };

    registry.register(tool);
    expect(registry.get("test_tool")).toBe(tool);
  });

  it("should throw error when registering duplicate tool", () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      name: "duplicate",
      description: "Duplicate tool",
      execute: async () => ({ content: [] }),
    };

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(
      'Tool "duplicate" already registered',
    );
  });

  it("should list all registered tools", () => {
    const registry = new ToolRegistry();
    const tool1: Tool = {
      name: "tool1",
      description: "",
      execute: async () => ({ content: [] }),
    };
    const tool2: Tool = {
      name: "tool2",
      description: "",
      execute: async () => ({ content: [] }),
    };

    registry.register(tool1);
    registry.register(tool2);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name)).toEqual(["tool1", "tool2"]);
  });

  it("should execute a registered tool", async () => {
    const registry = new ToolRegistry();
    const mockExecute = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "success" }] });
    const tool: Tool = {
      name: "executor",
      description: "",
      execute: mockExecute,
    };

    registry.register(tool);
    const result = await registry.execute("executor", { foo: "bar" });

    expect(mockExecute).toHaveBeenCalledWith({ foo: "bar" });
    expect(result.content?.[0]?.text).toBe("success");
  });

  it("should throw error when executing unknown tool", async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute("unknown")).rejects.toThrow(
      'Tool "unknown" not found',
    );
  });
});
