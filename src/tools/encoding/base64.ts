import { Tool } from "../../core/types.js";

const isValidBase64 = (str: string): boolean => {
  // Trim whitespace
  const trimmed = str.trim();
  // Base64 regex: allowed chars and optional padding up to 2 '='
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  // Check length mod 4 (must be multiple of 4, but we allow some flexibility)
  if (trimmed.length % 4 !== 0) return false;
  return base64Regex.test(trimmed);
};

export const base64EncodeTool: Tool = {
  name: "base64_encode",
  description: "Encode a string to Base64",
  params: {
    text: { type: "string", description: "Text to encode" },
  },
  execute: async (params) => {
    const text = params.text || "";
    const encoded = Buffer.from(text, "utf-8").toString("base64");
    return { content: [{ type: "text", text: encoded }] };
  },
};

export const base64DecodeTool: Tool = {
  name: "base64_decode",
  description: "Decode Base64 to string",
  params: {
    encoded: { type: "string", description: "Base64 string to decode" },
  },
  execute: async (params) => {
    const encoded = (params.encoded || "").trim();
    if (!encoded) {
      return { content: [{ type: "text", text: "" }] };
    }

    // Validate Base64
    if (!isValidBase64(encoded)) {
      throw new Error(
        "Invalid Base64 string: contains illegal characters or bad padding",
      );
    }

    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      return { content: [{ type: "text", text: decoded }] };
    } catch (error: any) {
      throw new Error(`Failed to decode Base64: ${error.message}`);
    }
  },
};
