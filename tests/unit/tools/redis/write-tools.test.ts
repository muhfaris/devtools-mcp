import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const setConfig = (readonly: boolean) => {
  (global as any).__devtools_config = {
    redis: {
      connections: {
        dev: { url: "redis://localhost:6379", readonly },
      },
    },
    security: {
      execute_query: {
        allow_write: false,
        blocked_env: ["production", "prod"],
      },
    },
  };
};

describe("redis write tools", () => {
  afterEach(() => {
    delete (global as any).__devtools_config;
  });

  describe("readonly enforcement", () => {
    it("blocks write when readonly is true", async () => {
      setConfig(true);
      await expect(
        redisSetKeyTool.execute({ key: "test", value: "hello" }),
      ).rejects.toThrow("Write operations are blocked");
    });

    it("blocks write when readonly is undefined", async () => {
      (global as any).__devtools_config = {
        redis: { connections: { dev: { url: "redis://localhost" } } },
      };
      await expect(
        redisSetKeyTool.execute({ key: "test", value: "hello" }),
      ).rejects.toThrow("Write operations are blocked");
    });

    it("blocks write on connection named 'production'", async () => {
      (global as any).__devtools_config = {
        redis: {
          connections: {
            production: { url: "redis://localhost", readonly: false },
          },
        },
        security: {
          execute_query: { allow_write: false, blocked_env: ["production"] },
        },
      };
      await expect(
        redisSetKeyTool.execute({
          connection: "production",
          key: "test",
          value: "hello",
        }),
      ).rejects.toThrow("blocked");
    });
  });

  describe("redis_set_key", () => {
    beforeEach(() => setConfig(false));

    it("sets a key successfully", async () => {
      const result = await redisSetKeyTool.execute({
        key: "user:1",
        value: "Alice",
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
      expect(data.set).toBe(true);
      expect(data.key).toBe("user:1");
    });

    it("normalizes a valid mode", async () => {
      const result = await redisSetKeyTool.execute({
        key: "test",
        value: "x",
        mode: "nx",
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
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
    beforeEach(() => setConfig(false));

    it("requires confirm: true to delete", async () => {
      const result = await redisDeleteKeyTool.execute({
        keys: "user:1,user:2",
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
      expect(data.deleted).toBe(0);
      expect(data.confirmationRequired).toBe(true);
      expect(data.wouldDelete).toEqual(["user:1", "user:2"]);
    });

    it("deletes with confirm: true", async () => {
      const result = await redisDeleteKeyTool.execute({
        keys: "user:1,user:2",
        confirm: true,
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
      expect(data.deleted).toBe(2);
    });

    it("supports dry run", async () => {
      const result = await redisDeleteKeyTool.execute({
        keys: "user:1,user:2",
        dry_run: true,
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
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
    beforeEach(() => setConfig(false));

    it("sets TTL on a key", async () => {
      const result = await redisExpireKeyTool.execute({
        key: "user:1",
        ttl: 3600,
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
      expect(data.updated).toBe(true);
      expect(data.ttl).toBe("3600s");
    });

    it("removes expiry with ttl <= 0", async () => {
      const result = await redisExpireKeyTool.execute({
        key: "user:1",
        ttl: 0,
      });
      const data = JSON.parse(result.content?.[0]?.text || "{}");
      expect(data.ttl).toBe("removed (no expiry)");
    });

    it("requires TTL parameter", async () => {
      await expect(
        redisExpireKeyTool.execute({ key: "user:1" } as any),
      ).rejects.toThrow("TTL is required");
    });
  });
});
