import { Tool } from "../../core/types.js";
import { createHash } from "crypto";

export const hashGenerateTool: Tool = {
  name: "hash_generate",
  description: "Generate a hash (MD5, SHA1, SHA256, SHA512) from a string",
  params: {
    text: {
      type: "string",
      description: "Text to hash",
    },
    algorithm: {
      type: "string",
      optional: true,
      description: "Hash algorithm: md5, sha1, sha256, sha512",
    },
  },
  execute: async (params) => {
    const text = params.text || "";
    let algorithm = params.algorithm || "sha256";

    // Handle case where Commander passes boolean true
    if (typeof algorithm === "boolean") {
      algorithm = "sha256";
    }

    const supported = ["md5", "sha1", "sha256", "sha512"];
    if (!supported.includes(algorithm)) {
      throw new Error(
        `Unsupported algorithm: ${algorithm}. Supported: ${supported.join(", ")}`,
      );
    }

    const hash = createHash(algorithm).update(text).digest("hex");
    const result = {
      algorithm,
      input: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      hash,
      length: hash.length,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
