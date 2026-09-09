import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createToolInputSchema } from "../../../src/mcp/server.js";
import { executeQueryTool } from "../../../src/tools/database/query.js";

describe("MCP tool input schema", () => {
  it("emits an explicitly typed schema for execute_query params", () => {
    const schema = zodToJsonSchema(
      z.object(createToolInputSchema(executeQueryTool.params)),
    ) as {
      properties?: Record<string, { type?: string; items?: unknown }>;
    };

    expect(schema.properties?.params).toMatchObject({
      type: "array",
      items: { anyOf: expect.any(Array) },
    });
  });

  it("maps object parameters to an explicitly typed schema", () => {
    const schema = zodToJsonSchema(
      z.object(
        createToolInputSchema({
          options: { type: "object" },
        }),
      ),
    ) as { properties?: Record<string, { type?: string }> };

    expect(schema.properties?.options?.type).toBe("object");
  });

  it("emits no nested $ref for recursive array/object params", () => {
    const schema = zodToJsonSchema(
      z.object(createToolInputSchema(executeQueryTool.params)),
    ) as { properties?: Record<string, unknown>; $defs?: unknown };

    const json = JSON.stringify(schema);
    // OpenAI rejects $ref pointing to nested paths; ensure none are emitted.
    expect(json).not.toMatch(/#\/properties\//);
  });
});
