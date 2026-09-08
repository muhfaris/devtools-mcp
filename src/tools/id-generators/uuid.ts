import { v4 as uuidv4 } from "uuid";
import { Tool } from "../../core/types.js";

export const generateUuidTool: Tool = {
  name: "generate_uuid",
  description: "Generate a UUID v4",
  params: {
    count: {
      type: "number",
      optional: true,
      description: "Number of UUIDs (max 100)",
      default: 1,
    },
  },
  execute: async (params) => {
    const count = Math.min(Number(params.count) || 1, 100);
    const ids = Array.from({ length: count }, () => uuidv4());
    return { content: [{ type: "text", text: ids.join("\n") }] };
  },
};
