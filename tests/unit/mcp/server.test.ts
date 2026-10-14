import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createToolInputSchema } from "../../../src/mcp/server.js";
import { executeQueryTool } from "../../../src/tools/database/query.js";
import { gitlabCompareBranchesTool } from "../../../src/tools/gitlab/compare-branches.js";
import { gitlabGetCommitsTool } from "../../../src/tools/gitlab/get-commits.js";
import { gitlabGetMrTool } from "../../../src/tools/gitlab/get-mr.js";

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

describe("what a client can discover about a tool", () => {
  /** The schema `tools/list` sends, which is the whole of the tool's discoverability. */
  const publishedSchema = (params: Record<string, any>) =>
    zodToJsonSchema(z.object(createToolInputSchema(params))) as {
      properties?: Record<
        string,
        { type?: string; default?: unknown; description?: string }
      >;
      required?: string[];
    };

  it("publishes every opt-in switch, with its default", () => {
    const schema = publishedSchema(gitlabCompareBranchesTool.params);

    // A model can only pass a parameter it can see. `include_diff` absent from this list
    // would be a switch no client could ever ask for, however well it is documented in
    // the repository.
    for (const key of [
      "include_diff",
      "full_diff",
      "max_files",
      "include_messages",
    ]) {
      expect(schema.properties?.[key], key).toMatchObject({
        description: expect.any(String),
      });
    }

    expect(schema.properties?.include_diff).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(schema.properties?.include_messages).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(schema.properties?.full_diff).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(schema.properties?.max_files).toMatchObject({
      type: "number",
      default: 25,
    });
  });

  it("keeps every opt-in switch optional", () => {
    // Opt-in means opt-in: a required switch is one the caller must answer, and these are
    // exactly the parameters a caller should be able to leave alone.
    expect(publishedSchema(gitlabCompareBranchesTool.params).required).toEqual([
      "from",
      "to",
    ]);
  });

  it.each([
    ["gitlab_get_commits", gitlabGetCommitsTool],
    ["gitlab_get_mr", gitlabGetMrTool],
    ["gitlab_compare_branches", gitlabCompareBranchesTool],
  ])("publishes include_messages on %s", (_name, tool) => {
    // The same switch on every tool that returns commit bodies, so a caller that learns
    // it once can use it everywhere — and so a tool that returns messages by default is
    // the exception rather than the rule.
    expect(
      publishedSchema(tool.params).properties?.include_messages,
    ).toMatchObject({
      type: "boolean",
      default: false,
      description: expect.any(String),
    });
  });
});
