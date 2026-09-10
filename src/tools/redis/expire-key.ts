import { Tool } from "../../core/types.js";
import { withRedisWrite } from "../../providers/redis-helper.js";

export const redisExpireKeyTool: Tool = {
  name: "redis_expire_key",
  description:
    "Set, update, or remove the TTL of a Redis key (requires connection with readonly: false)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    key: {
      type: "string",
      description: "Redis key to modify",
    },
    ttl: {
      type: "number",
      description:
        "Time-to-live in seconds. Use 0 or negative to remove expiry (PERSIST).",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const key = params.key;
    if (!key) throw new Error("Key is required");
    if (params.ttl === undefined)
      throw new Error("TTL is required (use 0 to remove expiry)");

    const ttl = Number(params.ttl);
    if (!Number.isFinite(ttl)) throw new Error("TTL must be a number");

    return withRedisWrite(config, params.connection, async (provider, name) => {
      const result = await provider.expireKey(key, ttl);

      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connection: name,
                  key,
                  updated: false,
                  reason: "Key does not exist",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connection: name,
                key,
                updated: result.applied,
                ttl: ttl <= 0 ? "removed (no expiry)" : `${ttl}s`,
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
