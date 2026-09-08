import { ulid } from "ulid";
import { Tool } from "../../core/types.js";

export const generateUlidTool: Tool = {
  name: "generate_ulid",
  description: "Generate a ULID",
  params: {
    count: { type: "number", optional: true, description: "Number of ULIDs (max 100)", default: 1 },
    timestamp: { type: "number", optional: true, description: "Custom timestamp (ms)" }
  },
  execute: async (params) => {
    const count = Math.min(Number(params.count) || 1, 100);
    const ts = params.timestamp ? Number(params.timestamp) : undefined;
    const ids = Array.from({ length: count }, () => ulid(ts));
    return { content: [{ type: "text", text: ids.join("\n") }] };
  }
};
