import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolRegistry } from "../core/registry.js";
import { z } from "zod";

export const startMcpServer = async (registry: ToolRegistry) => {
  const server = new McpServer({ name: "devtools-mcp", version: "0.1.0" });

  for (const tool of registry.list()) {
    const schema: Record<string, any> = {};
    if (tool.params) {
      for (const [key, param] of Object.entries(tool.params)) {
        let zodType: any;
        switch (param.type) {
          case "string": zodType = z.string(); break;
          case "number": zodType = z.number(); break;
          case "boolean": zodType = z.boolean(); break;
          default: zodType = z.any();
        }
        if (param.optional) zodType = zodType.optional();
        schema[key] = zodType;
      }
    }

    server.tool(tool.name, tool.description || "", schema, async (params: any) => {
      try {
        const result = await registry.execute(tool.name, params);
        return { content: result.content || [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
};
