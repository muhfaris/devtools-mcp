import { Tool } from "../../core/types.js";
import { randomBytes } from "crypto";

export const secretGenerateTool: Tool = {
  name: "secret_generate",
  description: "Generate a secure random secret (password, API key, etc.)",
  params: {
    length: {
      type: "number",
      optional: true,
      description: "Length of the secret in bytes (default: 32)",
    },
    format: {
      type: "string",
      optional: true,
      description: "Output format: hex, base64, base64url",
    },
    count: {
      type: "number",
      optional: true,
      description: "Number of secrets to generate (max 10)",
    },
  },
  execute: async (params) => {
    const length = Math.max(8, Math.min(128, Number(params.length) || 32));
    const count = Math.min(Number(params.count) || 1, 10);

    // Handle case where Commander passes boolean true
    let format = params.format || "hex";
    if (typeof format === "boolean") {
      format = "hex";
    }

    const supported = ["hex", "base64", "base64url"];
    if (!supported.includes(format)) {
      throw new Error(
        `Unsupported format: ${format}. Supported: ${supported.join(", ")}`,
      );
    }

    const secrets = [];
    for (let i = 0; i < count; i++) {
      const bytes = randomBytes(length);
      let secret: string;
      switch (format) {
        case "hex":
          secret = bytes.toString("hex");
          break;
        case "base64":
          secret = bytes.toString("base64");
          break;
        case "base64url":
          secret = bytes.toString("base64url");
          break;
        default:
          secret = bytes.toString("hex");
      }
      secrets.push(secret);
    }

    const text = count === 1 ? secrets[0] : secrets.join("\n");
    return { content: [{ type: "text", text }] };
  },
};
