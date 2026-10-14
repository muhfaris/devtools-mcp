import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { redisSetKeyTool } from "../../../../src/tools/redis/set-key.js";
import { redisDeleteKeyTool } from "../../../../src/tools/redis/delete-key.js";
import { redisExpireKeyTool } from "../../../../src/tools/redis/expire-key.js";

vi.mock("../../../../src/providers/redis.js", () => ({
  RedisProvider: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    setKey: vi.fn().mockResolvedValue({ ok: true }),
    deleteKeys: vi
      .fn()
      .mockResolvedValue({ deleted: 2, existing: ["user:1", "user:2"] }),
    expireKey: vi.fn().mockResolvedValue({ ok: true, applied: true }),
    exists: vi.fn().mockResolvedValue(true),
  })),
}));

const useConfig = (value: unknown) => {
  (global as any).__devtools_config = value;
};

const devConnection = { url: "redis://localhost:6379" };

/** Writes are denied by default, so the functional suites opt in explicitly. */
const grantWrites = () =>
  useConfig(
    configWithSharedGrant({
      providers: { redis: { connections: { dev: devConnection } } },
    }),
  );

const configWithSharedGrant = (value: Record<string, unknown>) => ({
  security: { allow_write: true, blocked_env: [] },
  ...value,
});

const parseText = (result: {
  content?: { text?: string }[];
}): Record<string, any> => JSON.parse(result.content?.[0]?.text || "{}");

describe("redis write tools", () => {
  afterEach(() => {
    delete (global as any).__devtools_config;
  });

  describe("write control", () => {
    it("denies writes when nothing grants them", async () => {
      useConfig({
        providers: { redis: { connections: { dev: devConnection } } },
      });
      await expect(
        redisSetKeyTool.execute({ key: "k", value: "v" }),
      ).rejects.toThrow("Redis writes are disabled");
    });

    it("ignores a top-level redis block", async () => {
      useConfig({ redis: { connections: { dev: devConnection } } });
      // The block is not merely ungranted: it is invisible, so the connection is missing.
      await expect(
        redisSetKeyTool.execute({ key: "k", value: "v" }),
      ).rejects.toThrow("No Redis connections configured");
    });

    it("grants writes from the provider-scoped block", async () => {
      useConfig({
        providers: {
          redis: {
            connections: { dev: devConnection },
            security: { allow_write: true },
          },
        },
      });
      expect(
        parseText(await redisSetKeyTool.execute({ key: "user:1", value: "A" }))
          .set,
      ).toBe(true);
    });

    it("grants writes from the shared block", async () => {
      grantWrites();
      expect(
        parseText(await redisSetKeyTool.execute({ key: "user:1", value: "A" }))
          .set,
      ).toBe(true);
    });

    it("lets the provider-scoped block narrow a shared grant", async () => {
      useConfig({
        security: { allow_write: true },
        providers: {
          redis: {
            connections: { dev: devConnection },
            security: { allow_write: false },
          },
        },
      });
      await expect(
        redisSetKeyTool.execute({ key: "k", value: "v" }),
      ).rejects.toThrow("Redis writes are disabled");
    });

    it("blocks a connection listed in the provider-scoped blocked_env", async () => {
      useConfig({
        providers: {
          redis: {
            connections: { "prod-cache": devConnection },
            security: { allow_write: true, blocked_env: ["prod"] },
          },
        },
      });
      await expect(
        redisSetKeyTool.execute({
          connection: "prod-cache",
          key: "k",
          value: "v",
        }),
      ).rejects.toThrow('matches the blocked_env entry "prod"');
    });

    it("blocks a connection matching the built-in default list", async () => {
      useConfig({
        security: { allow_write: true },
        providers: {
          redis: { connections: { production: devConnection } },
        },
      });
      await expect(
        redisSetKeyTool.execute({
          connection: "production",
          key: "k",
          value: "v",
        }),
      ).rejects.toThrow("blocked");
    });

    it("permits dev while refusing prod-db under one grant", async () => {
      useConfig({
        security: { allow_write: true, blocked_env: ["prod"] },
        providers: {
          redis: {
            connections: { dev: devConnection, "prod-db": devConnection },
          },
        },
      });

      expect(
        parseText(await redisSetKeyTool.execute({ key: "user:1", value: "A" }))
          .set,
      ).toBe(true);
      await expect(
        redisSetKeyTool.execute({
          connection: "prod-db",
          key: "k",
          value: "v",
        }),
      ).rejects.toThrow("blocked");
    });

    it("refuses a connection marked readonly, even under a grant", async () => {
      useConfig(
        configWithSharedGrant({
          providers: {
            redis: {
              connections: { dev: { ...devConnection, readonly: true } },
            },
          },
        }),
      );

      await expect(
        redisSetKeyTool.execute({ key: "k", value: "v" }),
      ).rejects.toThrow('Connection "dev" is readonly: true');
    });

    it("rejects an unknown connection before reaching Redis", async () => {
      grantWrites();
      await expect(
        redisSetKeyTool.execute({ connection: "nope", key: "k", value: "v" }),
      ).rejects.toThrow('Redis connection "nope" not found');
    });
  });

  describe("redis_set_key", () => {
    beforeEach(grantWrites);

    it("sets a key successfully", async () => {
      const data = parseText(
        await redisSetKeyTool.execute({ key: "user:1", value: "Alice" }),
      );
      expect(data.set).toBe(true);
      expect(data.key).toBe("user:1");
    });

    it("normalizes a valid mode", async () => {
      const data = parseText(
        await redisSetKeyTool.execute({ key: "test", value: "x", mode: "nx" }),
      );
      expect(data.mode).toBe("NX");
    });

    it("rejects invalid mode", async () => {
      await expect(
        redisSetKeyTool.execute({ key: "test", value: "x", mode: "invalid" }),
      ).rejects.toThrow('Mode must be "NX" or "XX"');
    });

    it("rejects invalid TTL", async () => {
      await expect(
        redisSetKeyTool.execute({ key: "test", value: "x", ttl: -5 }),
      ).rejects.toThrow("TTL must be a positive number");
    });

    it("requires key and value", async () => {
      await expect(
        redisSetKeyTool.execute({ value: "x" } as any),
      ).rejects.toThrow("Key is required");
      await expect(
        redisSetKeyTool.execute({ key: "k" } as any),
      ).rejects.toThrow("Value is required");
    });
  });

  describe("redis_delete_key", () => {
    beforeEach(grantWrites);

    it("requires confirm: true to delete", async () => {
      const data = parseText(
        await redisDeleteKeyTool.execute({ keys: "user:1,user:2" }),
      );
      expect(data.deleted).toBe(0);
      expect(data.confirmationRequired).toBe(true);
      expect(data.wouldDelete).toEqual(["user:1", "user:2"]);
    });

    it("deletes with confirm: true", async () => {
      const data = parseText(
        await redisDeleteKeyTool.execute({
          keys: "user:1,user:2",
          confirm: true,
        }),
      );
      expect(data.deleted).toBe(2);
    });

    it("supports dry run", async () => {
      const data = parseText(
        await redisDeleteKeyTool.execute({
          keys: "user:1,user:2",
          dry_run: true,
        }),
      );
      expect(data.dryRun).toBe(true);
      expect(data.deleted).toBeUndefined();
    });

    it("enforces max keys", async () => {
      const manyKeys = Array.from({ length: 101 }, (_, i) => `k${i}`).join(",");
      await expect(
        redisDeleteKeyTool.execute({ keys: manyKeys }),
      ).rejects.toThrow("Maximum 100 keys");
    });
  });

  describe("redis_expire_key", () => {
    beforeEach(grantWrites);

    it("sets TTL on a key", async () => {
      const data = parseText(
        await redisExpireKeyTool.execute({ key: "user:1", ttl: 3600 }),
      );
      expect(data.updated).toBe(true);
      expect(data.ttl).toBe("3600s");
    });

    it("removes expiry with ttl <= 0", async () => {
      const data = parseText(
        await redisExpireKeyTool.execute({ key: "user:1", ttl: 0 }),
      );
      expect(data.ttl).toBe("removed (no expiry)");
    });

    it("requires TTL parameter", async () => {
      await expect(
        redisExpireKeyTool.execute({ key: "user:1" } as any),
      ).rejects.toThrow("TTL is required");
    });
  });
});
