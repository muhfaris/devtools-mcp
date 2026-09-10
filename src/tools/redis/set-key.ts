import { Tool } from "../../core/types.js";
import { withRedisWrite } from "../../providers/redis-helper.js";

export const redisSetKeyTool: Tool = {
  name: "redis_set_key",
  description:
    "Set a string value in Redis (requires connection with readonly: false)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    key: {
      type: "string",
      description: "Redis key to set",
    },
    value: {
      type: "string",
      description: "Value to store",
    },
    ttl: {
      type: "number",
      optional: true,
      description: "Time-to-live in seconds (optional, no expiry if omitted)",
    },
    mode: {
      type: "string",
      optional: true,
      description: 'Set mode: "NX" (only if not exists), "XX" (only if exists)',
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const key = params.key;
    if (!key) throw new Error("Key is required");
    if (params.value === undefined) throw new Error("Value is required");

    const mode = params.mode ? String(params.mode).toUpperCase() : undefined;
    if (mode && mode !== "NX" && mode !== "XX") {
      throw new Error('Mode must be "NX" or "XX"');
    }

    const ttl = params.ttl ? Number(params.ttl) : undefined;
    if (ttl !== undefined && (ttl <= 0 || !Number.isFinite(ttl))) {
      throw new Error("TTL must be a positive number of seconds");
    }

    return withRedisWrite(config, params.connection, async (provider, name) => {
      const result = await provider.setKey(key, String(params.value), {
        ttl,
        mode,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connection: name,
                key,
                set: result.ok,
                ttl: ttl ? `${ttl}s` : "no expiry",
                mode: mode || "none",
                reason: result.reason,
              },
              null,
              2,
            ),
          },
        ],
      };
    });
  },
};
