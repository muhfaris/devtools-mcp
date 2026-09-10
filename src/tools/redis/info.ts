import { Tool } from "../../core/types.js";
import { withRedis } from "../../providers/redis-helper.js";

export const redisInfoTool: Tool = {
  name: "redis_info",
  description:
    "Get Redis server information (memory, clients, stats, replication, keyspace)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    section: {
      type: "string",
      optional: true,
      description:
        "Info section: server, clients, memory, persistence, stats, replication, cpu, keyspace",
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    return withRedis(config, params.connection, async (provider, name) => {
      const info = await provider.info(params.section);
      const result = {
        connection: name,
        section: params.section || "all",
        info,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    });
  },
};
