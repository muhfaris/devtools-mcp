import { Tool } from "../../core/types.js";
import { withRedisWrite } from "../../providers/redis-helper.js";

export const redisDeleteKeyTool: Tool = {
  name: "redis_delete_key",
  description:
    "Delete one or more Redis keys (requires providers.redis.security.allow_write and explicit confirmation)",
  params: {
    connection: {
      type: "string",
      optional: true,
      description: "Connection name from config. Default: first connection.",
    },
    keys: {
      type: "string",
      description: "Comma-separated keys to delete (max 100)",
    },
    confirm: {
      type: "boolean",
      optional: true,
      description: "Must be true to actually delete (safety guard)",
      default: false,
    },
    dry_run: {
      type: "boolean",
      optional: true,
      description: "If true, only report which keys exist without deleting",
      default: false,
    },
  },
  execute: async (params) => {
    const config = (global as any).__devtools_config;
    const keyList = (params.keys || "")
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);

    if (keyList.length === 0) throw new Error("At least one key is required");
    if (keyList.length > 100) throw new Error("Maximum 100 keys per request");

    return withRedisWrite(config, params.connection, async (provider, name) => {
      // Dry run: just report what exists
      if (params.dry_run) {
        const existing: string[] = [];
        const missing: string[] = [];
        for (const k of keyList) {
          (await provider.exists(k)) ? existing.push(k) : missing.push(k);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connection: name,
                  dryRun: true,
                  wouldDelete: existing,
                  notFound: missing,
                  total: existing.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Safety: require confirm: true
      if (params.confirm !== true) {
        // Report what would happen, but don't delete
        const existing: string[] = [];
        for (const k of keyList) {
          if (await provider.exists(k)) existing.push(k);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connection: name,
                  deleted: 0,
                  wouldDelete: existing,
                  confirmationRequired: true,
                  message: `Pass \`confirm: true\` to actually delete ${existing.length} key(s).`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Actually delete
      const result = await provider.deleteKeys(keyList);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connection: name,
                requested: keyList.length,
                deleted: result.deleted,
                keysDeleted: result.existing,
                notFound: keyList.filter((k) => !result.existing.includes(k)),
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
