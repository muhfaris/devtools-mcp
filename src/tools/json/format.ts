import { Tool } from "../../core/types.js";

export const jsonFormatTool: Tool = {
  name: "json_format",
  description: "Pretty-print JSON with customizable indentation",
  params: {
    json: {
      type: "string",
      description: "JSON string to format",
    },
    indent: {
      type: "number",
      optional: true,
      description: "Number of spaces for indentation (default: 2)",
      default: 2,
    },
  },
  execute: async (params) => {
    const input = params.json || "";
    const indent = Math.min(Number(params.indent) || 2, 8);

    if (!input.trim()) {
      throw new Error("JSON input is required");
    }

    try {
      const parsed = JSON.parse(input);
      const formatted = JSON.stringify(parsed, null, indent);
      return { content: [{ type: "text", text: formatted }] };
    } catch (error: any) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
  },
};
