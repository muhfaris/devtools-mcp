import { Tool } from "../../core/types.js";
import { withRedis } from "../../providers/redis-helper.js";

export const redisListKeysTool: Tool = {
  name: "redis_list_keys",
  description:
    "List Redis keys matching a pattern (uses SCAN, safe for production)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    pattern: {
      type: "string",
      optional: true,
      description: 'Glob pattern (e.g., "user:*", "*session*"). Default: "*"',
      default: "*",
    },
    limit: {
      type: "number",
      optional: true,
      description: "Maximum keys to return (default: 100, max: 1000)",
      default: 100,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const pattern = params.pattern || "*";
    const limit = Math.min(Number(params.limit) || 100, 1000);

    return withRedis(config, params.connection, async (provider, name) => {
      const keys = await provider.listKeys(pattern, limit);
      const dbSize = await provider.dbSize();

      const result = {
        connection: name,
        pattern,
        keysFound: keys.length,
        totalKeysInDb: dbSize,
        truncated: keys.length === limit,
        keys,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    });
  },
};
