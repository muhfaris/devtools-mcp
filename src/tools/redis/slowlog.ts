import { Tool } from "../../core/types.js";
import { withRedis } from "../../providers/redis-helper.js";

export const redisSlowlogTool: Tool = {
  name: "redis_slowlog",
  description:
    "Get the slow query log from Redis (requires slowlog-log-slower-than to be configured)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    count: {
      type: "number",
      optional: true,
      description: "Number of entries to return (default: 10, max: 128)",
      default: 10,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const count = Math.min(Number(params.count) || 10, 128);

    return withRedis(config, params.connection, async (provider, name) => {
      const entries = await provider.slowlog(count);

      const formatted = entries.map((entry: any) => {
        // ioredis SLOWLOG entry format: [id, timestamp, microseconds, command, client, clientName]
        const [id, timestamp, microseconds, command] = entry;
        return {
          id,
          timestamp: new Date(Number(timestamp) * 1000).toISOString(),
          durationMs: (Number(microseconds) / 1000).toFixed(2),
          command: Array.isArray(command) ? command.join(" ") : command,
        };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connection: name,
                entriesFound: formatted.length,
                note:
                  formatted.length === 0
                    ? "No slow queries. Set slowlog-log-slower-than in redis.conf to enable."
                    : undefined,
                slowlog: formatted,
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
