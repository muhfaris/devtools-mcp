import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redisInfoTool } from "../../../../src/tools/redis/info.js";
import { redisListKeysTool } from "../../../../src/tools/redis/list-keys.js";
import { redisGetKeyTool } from "../../../../src/tools/redis/get-key.js";
import { RedisProvider } from "../../../../src/providers/redis.js";

vi.mock("../../../../src/providers/redis.js", () => {
  const mockClient = {
    ping: vi.fn().mockResolvedValue("PONG"),
    info: vi
      .fn()
      .mockResolvedValue("redis_version:7.0.0\nused_memory:1048576\n"),
    scan: vi.fn().mockResolvedValue(["0", ["user:1", "user:2"]]),
    type: vi.fn().mockResolvedValue("string"),
    ttl: vi.fn().mockResolvedValue(3600),
    get: vi.fn().mockResolvedValue("hello"),
    dbsize: vi.fn().mockResolvedValue(42),
    call: vi.fn().mockResolvedValue("128"),
    quit: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn(),
  };

  return {
    RedisProvider: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      info: vi
        .fn()
        .mockResolvedValue({ redis_version: "7.0.0", used_memory: "1048576" }),
      listKeys: vi.fn().mockResolvedValue(["user:1", "user:2"]),
      getKeyInfo: vi
        .fn()
        .mockResolvedValue({
          key: "user:1",
          type: "string",
          ttl: 3600,
          size: 128,
        }),
      getKeyValue: vi
        .fn()
        .mockResolvedValue({ key: "user:1", type: "string", value: "hello" }),
      dbSize: vi.fn().mockResolvedValue(42),
      slowlog: vi.fn().mockResolvedValue([]),
    })),
  };
});

describe("redis tools", () => {
  beforeEach(() => {
    (global as any).__devtools_config = {
      providers: {
        redis: {
          connections: {
            dev: { url: "redis://localhost:6379", readonly: true },
          },
        },
      },
    };
  });

  afterEach(() => {
    delete (global as any).__devtools_config;
  });

  it("redis_info returns server info", async () => {
    const result = await redisInfoTool.execute({});
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.connection).toBe("dev");
    expect(data.info.redis_version).toBe("7.0.0");
  });

  it("redis_list_keys returns keys", async () => {
    const result = await redisListKeysTool.execute({ pattern: "user:*" });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.keysFound).toBe(2);
    expect(data.keys).toEqual(["user:1", "user:2"]);
  });

  it("redis_get_key returns value", async () => {
    const result = await redisGetKeyTool.execute({ key: "user:1" });
    const data = JSON.parse(result.content?.[0]?.text || "{}");
    expect(data.type).toBe("string");
    expect(data.value).toBe("hello");
  });

  it("throws when Redis not configured", async () => {
    (global as any).__devtools_config = {};
    await expect(redisInfoTool.execute({})).rejects.toThrow(
      "No Redis connections configured",
    );
  });
});
