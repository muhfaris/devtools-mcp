import { Tool } from "../../core/types.js";
import { withRedis } from "../../providers/redis-helper.js";

export const redisGetKeyTool: Tool = {
  name: "redis_get_key",
  description:
    "Get the value of a Redis key (auto-detects type: string, list, set, hash, zset, stream)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    key: {
      type: "string",
      description: "Redis key to retrieve",
    },
    limit: {
      type: "number",
      optional: true,
      description: "Maximum items to return for collections (default: 100)",
      default: 100,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const key = params.key;
    if (!key) throw new Error("Key is required");
    const limit = Math.min(Number(params.limit) || 100, 1000);

    return withRedis(config, params.connection, async (provider, name) => {
      const info = await provider.getKeyInfo(key);
      const value = await provider.getKeyValue(key, limit);

      const result = {
        connection: name,
        key,
        type: value.type,
        ttl:
          info.ttl === -1
            ? "no expiry"
            : info.ttl === -2
              ? "key does not exist"
              : `${info.ttl}s`,
        sizeBytes: info.size,
        value: value.value,
        truncated: value.truncated || false,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    });
  },
};
