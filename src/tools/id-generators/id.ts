import { ulid } from "ulid";
import { v4 as uuidv4 } from "uuid";
import { Config, Tool } from "../../core/types.js";
import { ToolError } from "../../core/errors.js";

export const SUPPORTED_ID_FORMATS = ["ulid", "uuid"] as const;
export type IdFormat = (typeof SUPPORTED_ID_FORMATS)[number];

/**
 * Resolve the identifier format from an explicit override, then
 * `id_generator.default`, then the built-in `ulid`.
 *
 * Unknown values fail loudly rather than silently falling back, so a typo in the
 * config is reported instead of quietly producing the wrong identifier type.
 */
export const resolveIdFormat = (
  config: Config | undefined,
  override?: unknown,
): IdFormat => {
  const requested = override ?? config?.id_generator?.default;
  if (requested === undefined || requested === null || requested === "") {
    return "ulid";
  }

  const normalized = String(requested).trim().toLowerCase();
  if ((SUPPORTED_ID_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as IdFormat;
  }

  throw new ToolError(
    "INVALID_ID_FORMAT",
    `Unsupported identifier format "${String(requested)}".`,
    'Set id_generator.default to "ulid" or "uuid" in .devtools/config.yaml, or pass format explicitly, then retry this tool.',
    true,
    { configKey: "id_generator.default" },
  );
};

export const generateIdTool: Tool = {
  name: "generate_id",
  description:
    "Generate identifiers in the format configured by id_generator.default",
  params: {
    count: {
      type: "number",
      optional: true,
      description: "Number of identifiers (max 100)",
      default: 1,
    },
    format: {
      type: "string",
      optional: true,
      description: 'Override the configured format: "ulid" | "uuid"',
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config as Config | undefined;
    const format = resolveIdFormat(config, params.format);
    const count = Math.min(Number(params.count) || 1, 100);
    const ids = Array.from({ length: count }, () =>
      format === "uuid" ? uuidv4() : ulid(),
    );
    return { content: [{ type: "text", text: ids.join("\n") }] };
  },
};
