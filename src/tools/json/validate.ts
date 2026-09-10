import { Tool } from "../../core/types.js";

export const jsonValidateTool: Tool = {
  name: "json_validate",
  description: "Validate JSON syntax and report errors",
  params: {
    json: {
      type: "string",
      description: "JSON string to validate",
    },
  },
  execute: async (params) => {
    const input = params.json || "";
    if (!input.trim()) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ valid: false, error: "Empty input" }, null, 2),
          },
        ],
      };
    }

    try {
      const parsed = JSON.parse(input);
      const result = {
        valid: true,
        type: Array.isArray(parsed) ? "array" : typeof parsed,
        keys: typeof parsed === "object" && parsed !== null ? Object.keys(parsed).length : undefined,
        length: Array.isArray(parsed) ? parsed.length : undefined,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                valid: false,
                error: error.message,
                position: {
                  line: error.stack?.match(/at position (\d+)/)?.[1] || "unknown",
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  },
};
