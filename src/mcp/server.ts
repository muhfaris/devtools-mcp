import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolRegistry } from "../core/registry.js";
import type { ToolParamSchema } from "../core/types.js";
import { stringifyToolError } from "../core/errors.js";
import { z } from "zod";

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const jsonValueSchema = z.union([
  jsonPrimitiveSchema,
  z.array(jsonPrimitiveSchema),
  z.record(jsonPrimitiveSchema),
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
          : jsonValueSchema,
      );
      break;
    case "object":
      schema = z.record(jsonValueSchema);
      break;
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
  const server = new McpServer({ name: "devtools-mcp", version: "0.1.0" });

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
