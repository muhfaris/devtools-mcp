import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolRegistry } from "../core/registry.js";
import type { ToolParamSchema } from "../core/types.js";
import { stringifyToolError } from "../core/errors.js";
import { VERSION } from "../core/version.js";
import { z } from "zod";

// Arbitrary JSON value for array/object items. Avoid a recursive union
// (z.lazy): zod-to-json-schema emits nested $ref pointers that OpenAI's
// function-schema validator rejects. Must be created FRESH per param:
// any schema instance reused across tools (shared constant) gets deduped
// into a $ref that may resolve in a DIFFERENT tool's schema, which OpenAI
// rejects ("reference can only point to definitions defined at the top
// level of the schema").
const makeJsonValueSchema = (): z.ZodTypeAny =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ]);

export const createToolParamSchema = (param: ToolParamSchema): z.ZodTypeAny => {
  let schema: z.ZodTypeAny;

  switch (param.type) {
    case "string":
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = z.array(
        param.items && "type" in param.items
          ? createToolParamSchema(param.items as ToolParamSchema)
          : makeJsonValueSchema(),
      );
      break;
    case "object":
      schema = z.record(makeJsonValueSchema());
      break;
    default:
      schema = makeJsonValueSchema();
  }

  if (param.description) schema = schema.describe(param.description);
  if (param.default !== undefined) schema = schema.default(param.default);
  if (param.optional) schema = schema.optional();

  return schema;
};

export const createToolInputSchema = (
  params: Record<string, ToolParamSchema> = {},
): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    Object.entries(params).map(([key, param]) => [
      key,
      createToolParamSchema(param),
    ]),
  );

export const startMcpServer = async (registry: ToolRegistry) => {
  const server = new McpServer({ name: "devtools-mcp", version: VERSION });

  for (const tool of registry.list()) {
    const schema = createToolInputSchema(tool.params);

    server.tool(
      tool.name,
      tool.description || "",
      schema,
      async (params: any): Promise<any> => {
        try {
          const result = await registry.execute(tool.name, params);
          return {
            content: result.content || [
              { type: "text", text: JSON.stringify(result) },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [{ type: "text", text: stringifyToolError(error) }],
            isError: true,
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
};
