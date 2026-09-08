import { Tool } from "../../core/types.js";

export const jwtDecodeTool: Tool = {
  name: "jwt_decode",
  description: "Decode a JWT token (header + payload)",
  params: {
    token: { type: "string", description: "JWT token to decode" },
    verify: {
      type: "boolean",
      optional: true,
      description: "Verify signature (requires secret)",
      default: false,
    },
    secret: {
      type: "string",
      optional: true,
      description: "Secret for signature verification",
    },
  },
  execute: async (params) => {
    const token = params.token || "";
    const parts = token.split(".");

    if (parts.length !== 3) {
      throw new Error(
        "Invalid JWT format: expected 3 parts (header.payload.signature)",
      );
    }

    try {
      const header = JSON.parse(
        Buffer.from(parts[0], "base64url").toString("utf-8"),
      );
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf-8"),
      );

      let result = {
        header,
        payload,
        signature: parts[2].substring(0, 20) + "...",
        valid: false,
      };

      // If verify is requested with a secret, do a simple HMAC check
      if (params.verify && params.secret) {
        try {
          const crypto = await import("crypto");
          const hmac = crypto.createHmac("sha256", params.secret);
          hmac.update(`${parts[0]}.${parts[1]}`);
          const expectedSig = hmac.digest("base64url");
          result.valid = parts[2] === expectedSig;
        } catch {
          result.valid = false;
        }
      }

      const text = JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (error: any) {
      throw new Error(`Failed to decode JWT: ${error.message}`);
    }
  },
};
