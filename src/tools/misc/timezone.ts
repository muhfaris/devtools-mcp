import { Tool } from "../../core/types.js";

export const timezoneConvertTool: Tool = {
  name: "timezone_convert",
  description: "Convert a timestamp between timezones",
  params: {
    timestamp: {
      type: "string",
      optional: true,
      description: "Timestamp (ISO string or Unix ms). Default: now",
    },
    from: {
      type: "string",
      optional: true,
      description: 'Source timezone (e.g., "America/New_York", default: local)',
    },
    to: {
      type: "string",
      description: 'Target timezone (e.g., "Asia/Jakarta", "UTC")',
    },
  },
  execute: async (params) => {
    const toTz = params.to || "UTC";
    const fromTz = params.from || "local";

    try {
      // Dynamic import for Intl to avoid Node version issues
      const date = params.timestamp ? new Date(params.timestamp) : new Date();

      if (isNaN(date.getTime())) {
        throw new Error("Invalid timestamp format. Use ISO string or Unix ms.");
      }

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: toTz,
        dateStyle: "full",
        timeStyle: "long",
      });

      const result = {
        original: date.toISOString(),
        from: fromTz,
        to: toTz,
        converted: formatter.format(date),
        iso: date.toISOString(),
        utc: date.toUTCString(),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Timezone conversion failed: ${error.message}`);
    }
  },
};
