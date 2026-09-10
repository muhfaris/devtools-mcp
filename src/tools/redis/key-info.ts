import { Tool } from "../../core/types.js";
import { withRedis } from "../../providers/redis-helper.js";

export const redisKeyInfoTool: Tool = {
  name: "redis_key_info",
  description: "Get metadata about a Redis key: type, TTL, and memory usage",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    keys: {
      type: "string",
      description: "Comma-separated list of keys to inspect (max 50)",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const keyList = (params.keys || "")
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);

    if (keyList.length === 0) throw new Error("At least one key is required");
    if (keyList.length > 50) throw new Error("Maximum 50 keys per request");

    return withRedis(config, params.connection, async (provider, name) => {
      const results = await Promise.all(
        keyList.map(async (k) => {
          const info = await provider.getKeyInfo(k);
          return {
            key: info.key,
            type: info.type,
            ttl:
              info.ttl === -1
                ? "no expiry"
                : info.ttl === -2
                  ? "does not exist"
                  : `${info.ttl}s`,
            sizeBytes: info.size,
            sizeHuman: humanBytes(info.size),
          };
        }),
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ connection: name, keys: results }, null, 2),
          },
        ],
      };
    });
  },
};

function humanBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
