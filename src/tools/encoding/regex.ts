import { Tool } from "../../core/types.js";

export const regexTestTool: Tool = {
  name: "regex_test",
  description: "Test a regex pattern against a sample string",
  params: {
    pattern: {
      type: "string",
      description: "Regex pattern (e.g., '^[a-z]+$')",
    },
    text: {
      type: "string",
      description: "Sample text to test against",
    },
    flags: {
      type: "string",
      optional: true,
      description: "Regex flags: g, i, m, s, u, y",
    },
  },
  execute: async (params) => {
    const pattern = params.pattern || "";
    const text = params.text || "";

    // Handle case where Commander passes boolean true
    let flags = params.flags || "";
    if (typeof flags === "boolean") {
      flags = "";
    }

    try {
      const regex = new RegExp(pattern, flags);
      const matches = text.match(regex);
      const isMatch = regex.test(text);

      const result = {
        pattern,
        flags: flags || "none",
        text: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
        isMatch,
        matches: matches || [],
        matchCount: matches ? matches.length : 0,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Invalid regex: ${error.message}`);
    }
  },
};
