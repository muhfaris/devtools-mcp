import { Tool } from "../../core/types.js";

export const jsonMinifyTool: Tool = {
  name: "json_minify",
  description: "Minify/compact JSON by removing unnecessary whitespace",
  params: {
    json: {
      type: "string",
      description: "JSON string to minify",
    },
  },
  execute: async (params) => {
    const input = params.json || "";
    if (!input.trim()) {
      throw new Error("JSON input is required");
    }

    try {
      const parsed = JSON.parse(input);
      const minified = JSON.stringify(parsed);
      return { content: [{ type: "text", text: minified }] };
    } catch (error: any) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
  },
};
