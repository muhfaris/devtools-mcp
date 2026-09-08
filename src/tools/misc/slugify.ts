import { Tool } from "../../core/types.js";

export const slugifyTool: Tool = {
  name: "slugify",
  description: "Convert a string to a URL-safe slug",
  params: {
    text: { type: "string", description: "Text to convert to slug" },
    separator: {
      type: "string",
      optional: true,
      description: 'Separator character (default: "-")',
      default: "-",
    },
    lowercase: {
      type: "boolean",
      optional: true,
      description: "Convert to lowercase (default: true)",
      default: true,
    },
  },
  execute: async (params) => {
    let text = params.text || "";
    const separator = params.separator || "-";
    const lowercase = params.lowercase !== false;

    // Remove special characters, trim, replace spaces
    let slug = text
      .normalize("NFKD") // Normalize unicode
      .replace(/[^\w\s-]/g, "") // Remove special chars
      .trim()
      .replace(/\s+/g, separator) // Replace spaces with separator
      .replace(/-+/g, separator) // Replace multiple separators
      .replace(/^-+|-+$/g, ""); // Trim separators from ends

    if (lowercase) {
      slug = slug.toLowerCase();
    }

    const result = {
      original: text,
      slug,
      separator,
      lowercase,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};
