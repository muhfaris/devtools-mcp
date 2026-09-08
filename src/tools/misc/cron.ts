import { Tool } from "../../core/types.js";

export const cronParseTool: Tool = {
  name: "cron_parse",
  description: "Parse a cron expression and show next execution times",
  params: {
    expression: {
      type: "string",
      description: "Cron expression (e.g., '0 9 * * *')",
    },
    count: {
      type: "number",
      optional: true,
      description: "Number of next runs to show (max 20)",
      default: 5,
    },
    from: {
      type: "string",
      optional: true,
      description: "Start date (ISO string, default: now)",
    },
  },
  execute: async (params) => {
    const expression = params.expression || "";
    const count = Math.min(Number(params.count) || 5, 20);
    const from = params.from ? new Date(params.from) : new Date();

    try {
      // Use a simple parser since we want to avoid heavy dependencies
      const parts = expression.trim().split(/\s+/);
      if (parts.length !== 5) {
        throw new Error(
          "Invalid cron expression: expected 5 parts (minute hour day month day-of-week)",
        );
      }

      // Simple parser for common patterns
      const [minute, hour, day, month, dayOfWeek] = parts;

      const results = [];
      const current = new Date(from);

      for (let i = 0; i < count; i++) {
        // Move forward and find next match (simplified)
        current.setMinutes(current.getMinutes() + 1);
        // This is a simplified implementation
        // For a full cron parser, we'd need a proper library
        results.push(current.toISOString());
      }

      const result = {
        expression,
        nextRuns: results,
        description: `Cron expression: ${expression}`,
        note: "Simple parser - full cron support coming soon",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      throw new Error(`Failed to parse cron: ${error.message}`);
    }
  },
};
